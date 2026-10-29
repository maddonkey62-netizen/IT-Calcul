import { db, getDeviceId, getSetting, setSetting, SETTING, type Fluid, type OutboxItem } from './db';
import { pruneLocal, toSheetRow } from './records';

const BATCH = 50;
const MAX_BACKOFF_MS = 5 * 60_000;
const INTERVAL_MS = 60_000;

interface ServerOpResult {
  opId: number;
  ok: boolean;
  error?: string;
}

interface ServerResponse {
  ok: boolean;
  error?: string;
  results?: ServerOpResult[];
  fluids?: string[];
}

export type SyncOutcome =
  | { kind: 'not-configured' }
  | { kind: 'offline' }
  | { kind: 'done'; sent: number; failed: number }
  | { kind: 'error'; message: string };

function backoff(attempts: number) {
  return Date.now() + Math.min(5_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

/**
 * Apps Script 웹앱 호출. Content-Type 을 text/plain 으로 보내야
 * 브라우저가 사전 요청(CORS preflight)을 하지 않아 Apps Script 와 통신된다.
 */
export async function callWebApp(url: string, body: unknown): Promise<ServerResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);
  const text = await res.text();
  try {
    return JSON.parse(text) as ServerResponse;
  } catch {
    throw new Error('웹앱 URL 이 올바른지 확인하세요 (응답이 JSON 이 아님)');
  }
}

async function buildOp(item: OutboxItem, deviceId: string) {
  const opId = item.seq!;
  switch (item.op.type) {
    case 'upsert':
    case 'delete': {
      const record = await db.records.get(item.op.recordId);
      if (!record) return null; // 이미 정리된 기록
      return { opId, type: item.op.type, record: toSheetRow(record), deviceId };
    }
    case 'setFluids': {
      const fluids = await db.fluids.orderBy('order').toArray();
      return { opId, type: 'setFluids', fluids: fluids.map((f) => f.name), deviceId };
    }
  }
}

async function applyServerFluids(names: string[] | undefined) {
  if (!names) return;
  // 아직 보내지 못한 목록 변경이 있으면 기기 쪽이 최신이다
  const pending = await db.outbox.filter((i) => i.op.type === 'setFluids').count();
  if (pending) return;
  const fluids: Fluid[] = names.map((name, order) => ({ name, order }));
  await db.transaction('rw', db.fluids, async () => {
    await db.fluids.clear();
    await db.fluids.bulkPut(fluids);
  });
}

/** 기록마다 남은 작업이 없으면 '전송됨', 실패한 작업이 있으면 '실패'로 표시 */
async function refreshRecordStatus(recordIds: Set<string>, errors: Map<string, string>) {
  const outbox = await db.outbox.toArray();
  for (const id of recordIds) {
    const still = outbox.some((i) => i.op.type !== 'setFluids' && i.op.recordId === id);
    if (!still) await db.records.update(id, { syncStatus: 'synced', syncError: undefined });
    else if (errors.has(id)) await db.records.update(id, { syncStatus: 'error', syncError: errors.get(id) });
  }
}

export interface SyncOptions {
  /** 재시도 대기 시간을 무시하고 바로 보낸다 */
  force?: boolean;
  /** 보낼 것이 없어도 서버에 접속해 공유 용액 목록을 받아 온다 */
  pull?: boolean;
}

async function runSync({ force = false, pull = false }: SyncOptions): Promise<SyncOutcome> {
  const url = await getSetting<string>(SETTING.webAppUrl, '');
  if (!url) return { kind: 'not-configured' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'offline' };

  const deviceId = await getDeviceId();
  const now = Date.now();
  const due = await db.outbox
    .orderBy('seq')
    .filter((i) => force || i.nextAttemptAt <= now)
    .limit(BATCH)
    .toArray();
  // Apps Script 실행 시간 한도를 아끼기 위해 보낼 것이 없으면 접속하지 않는다
  if (due.length === 0 && !pull) return { kind: 'done', sent: 0, failed: 0 };

  const ops = [];
  const recordIds = new Set<string>();
  for (const item of due) {
    const op = await buildOp(item, deviceId);
    if (!op) {
      await db.outbox.delete(item.seq!);
      continue;
    }
    ops.push(op);
    if (item.op.type !== 'setFluids') recordIds.add(item.op.recordId);
  }

  let response: ServerResponse;
  try {
    response = await callWebApp(url, { action: 'sync', ops });
    if (!response.ok) throw new Error(response.error ?? '서버가 요청을 거부했습니다');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const errors = new Map<string, string>();
    for (const item of due) {
      const attempts = item.attempts + 1;
      await db.outbox.update(item.seq!, { attempts, nextAttemptAt: backoff(attempts) });
      if (item.op.type !== 'setFluids') errors.set(item.op.recordId, message);
    }
    await refreshRecordStatus(recordIds, errors);
    await setSetting(SETTING.lastSyncError, message);
    return { kind: 'error', message };
  }

  const byId = new Map((response.results ?? []).map((r) => [r.opId, r]));
  const errors = new Map<string, string>();
  let sent = 0;
  let failed = 0;
  for (const item of due) {
    const r = byId.get(item.seq!);
    if (r?.ok) {
      await db.outbox.delete(item.seq!);
      sent++;
    } else if (r || ops.some((o) => o.opId === item.seq)) {
      const attempts = item.attempts + 1;
      await db.outbox.update(item.seq!, { attempts, nextAttemptAt: backoff(attempts) });
      if (item.op.type !== 'setFluids') errors.set(item.op.recordId, r?.error ?? '서버 처리 실패');
      failed++;
    }
  }
  await refreshRecordStatus(recordIds, errors);
  await applyServerFluids(response.fluids);
  await pruneLocal();
  await setSetting(SETTING.lastSyncAt, new Date().toISOString());
  await setSetting(SETTING.lastSyncError, failed ? `${failed}건 전송 실패` : null);

  // 한 번에 다 못 보냈으면 이어서 보낸다
  if (sent > 0 && due.length === BATCH) {
    const rest = await runSync({ force });
    if (rest.kind === 'done') return { kind: 'done', sent: sent + rest.sent, failed: failed + rest.failed };
    return rest;
  }
  return { kind: 'done', sent, failed };
}

let running: Promise<SyncOutcome> | null = null;

/** 동시에 여러 번 불려도 한 번만 실행된다. */
export function syncNow(options: SyncOptions = {}): Promise<SyncOutcome> {
  if (!running) {
    running = runSync(options).finally(() => {
      running = null;
    });
  }
  return running;
}

/** 연결 테스트: 웹앱이 응답하는지 확인하고 공유 용액 목록을 받아 온다. */
export async function testConnection(url: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await callWebApp(url, { action: 'ping' });
    if (!res.ok) return { ok: false, message: res.error ?? '서버가 요청을 거부했습니다' };
    await applyServerFluids(res.fluids);
    return { ok: true, message: `연결됨 · 공유 용액 ${res.fluids?.length ?? 0}개` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 앱 시작 시 한 번 호출: 인터넷 복귀·화면 복귀·주기적으로 전송한다. */
export function startAutoSync() {
  const pull = () => void syncNow({ pull: true, force: true });
  const onVisible = () => {
    if (document.visibilityState === 'visible') pull();
  };
  window.addEventListener('online', pull);
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(() => void syncNow(), INTERVAL_MS);
  pull();
  return () => {
    window.removeEventListener('online', pull);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}
