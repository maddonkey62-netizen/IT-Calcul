import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiffusionInput } from '../calc/diffusion';
import { db, setSetting, SETTING } from './db';
import { deleteRecord, recentRecords, saveFluids, saveRecord } from './records';
import { syncNow } from './sync';

const input: DiffusionInput = {
  volumeMl: 500,
  testPressure: 2.5,
  testPressureUnit: 'bar',
  stabilizationMin: 5,
  measureMin: 5,
  dp: 0.05,
  dpUnit: 'bar',
  patm: 1.01325,
  patmUnit: 'bar',
  tempCorrection: false,
  testTempC: 20,
  refTempC: 20,
};

/** Apps Script(Code.gs) 와 같은 규칙으로 동작하는 가짜 서버 */
function fakeServer() {
  const rows = new Map<string, Record<string, unknown>>();
  let fluids: string[] = ['물'];
  let down = false;
  const calls: unknown[] = [];

  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    if (down) throw new TypeError('Failed to fetch');
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const results = (body.ops ?? []).map((op: any) => {
      if (op.type === 'setFluids') fluids = op.fluids;
      else {
        const prev = rows.get(op.record.id);
        if (!prev || String(prev.updated_at) <= op.record.updated_at) rows.set(op.record.id, op.record);
      }
      return { opId: op.opId, ok: true };
    });
    return new Response(JSON.stringify({ ok: true, results, fluids }), { status: 200 });
  });

  return {
    rows,
    calls,
    fetchMock,
    get fluids() {
      return fluids;
    },
    set fluids(v: string[]) {
      fluids = v;
    },
    setDown(v: boolean) {
      down = v;
    },
  };
}

let server: ReturnType<typeof fakeServer>;

beforeEach(async () => {
  await Promise.all([db.records.clear(), db.outbox.clear(), db.fluids.clear(), db.settings.clear()]);
  server = fakeServer();
  vi.stubGlobal('fetch', server.fetchMock);
});

describe('오프라인 저장과 동기화', () => {
  it('웹앱 URL 이 없어도 기기에는 저장되고 전송 대기로 남는다', async () => {
    const r = await saveRecord({ input, wettingFluid: '물', note: '' });
    expect(await syncNow()).toEqual({ kind: 'not-configured' });
    expect((await db.records.get(r.id))!.syncStatus).toBe('pending');
    expect(await db.outbox.count()).toBe(1);
    expect(server.fetchMock).not.toHaveBeenCalled();
  });

  it('연결되면 Sheets 로 보내고 전송됨으로 바뀐다', async () => {
    await setSetting(SETTING.webAppUrl, 'https://example.test/exec');
    const r = await saveRecord({ input, wettingFluid: '물', note: '첫 시험' });
    expect(await syncNow()).toEqual({ kind: 'done', sent: 1, failed: 0 });
    expect((await db.records.get(r.id))!.syncStatus).toBe('synced');
    expect(await db.outbox.count()).toBe(0);
    const row = server.rows.get(r.id)!;
    expect(row.diffusion_ml_min).toBeCloseTo(4.934616, 6);
    expect(row.note).toBe('첫 시험');
    expect(row.t_test_c).toBe(''); // 보정 OFF 이면 온도는 비워 둔다
  });

  it('보낼 것이 없으면 서버에 접속하지 않는다 (pull 제외)', async () => {
    await setSetting(SETTING.webAppUrl, 'https://example.test/exec');
    await syncNow();
    expect(server.fetchMock).not.toHaveBeenCalled();
    await syncNow({ pull: true });
    expect(server.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('통신 실패 시 지우지 않고 실패로 표시한 뒤 나중에 다시 보낸다', async () => {
    await setSetting(SETTING.webAppUrl, 'https://example.test/exec');
    const r = await saveRecord({ input, wettingFluid: '물', note: '' });

    server.setDown(true);
    const out = await syncNow();
    expect(out.kind).toBe('error');
    expect((await db.records.get(r.id))!.syncStatus).toBe('error');
    const [item] = await db.outbox.toArray();
    expect(item.attempts).toBe(1);
    expect(item.nextAttemptAt).toBeGreaterThan(Date.now());

    server.setDown(false);
    expect(await syncNow()).toEqual({ kind: 'done', sent: 0, failed: 0 }); // 아직 재시도 시간이 아님
    expect(await syncNow({ force: true })).toEqual({ kind: 'done', sent: 1, failed: 0 });
    expect((await db.records.get(r.id))!.syncStatus).toBe('synced');
    expect(server.rows.size).toBe(1);
  });

  it('같은 기록을 수정하면 Sheets 에서도 같은 행이 바뀐다', async () => {
    await setSetting(SETTING.webAppUrl, 'https://example.test/exec');
    const r = await saveRecord({ input, wettingFluid: '물', note: '' });
    await syncNow();
    await new Promise((res) => setTimeout(res, 5));
    const edited = await saveRecord({ input: { ...input, dp: 0.1 }, wettingFluid: '물', note: '수정', editingId: r.id });
    expect(edited.id).toBe(r.id);
    expect(edited.createdAt).toBe(r.createdAt);
    await syncNow();
    expect(server.rows.size).toBe(1);
    expect(server.rows.get(r.id)!.note).toBe('수정');
    expect(server.rows.get(r.id)!.diffusion_ml_min).toBeCloseTo(4.934616 * 2, 5);
  });

  it('삭제하면 목록에서 사라지고 Sheets 에는 삭제됨으로 남는다', async () => {
    await setSetting(SETTING.webAppUrl, 'https://example.test/exec');
    const r = await saveRecord({ input, wettingFluid: '물', note: '' });
    await syncNow();
    await new Promise((res) => setTimeout(res, 5));
    await deleteRecord(r.id);
    expect(await recentRecords()).toHaveLength(0);
    await syncNow();
    expect(server.rows.get(r.id)!.deleted).toBe(true);
    expect(await db.records.get(r.id)).toBeUndefined(); // 전송 후 기기에서 정리
  });

  it('여러 건을 오프라인으로 모았다가 한 번에 보낸다', async () => {
    for (let i = 0; i < 3; i++) await saveRecord({ input, wettingFluid: '물', note: String(i) });
    await setSetting(SETTING.webAppUrl, 'https://example.test/exec');
    expect(await syncNow()).toEqual({ kind: 'done', sent: 3, failed: 0 });
    expect(server.fetchMock).toHaveBeenCalledTimes(1);
    expect(server.rows.size).toBe(3);
  });
});

describe('습윤 용액 목록 공유', () => {
  it('기기에서 바꾼 목록을 서버로 보낸다', async () => {
    await setSetting(SETTING.webAppUrl, 'https://example.test/exec');
    await saveFluids(['물', 'IPA 60/40']);
    await syncNow();
    expect(server.fluids).toEqual(['물', 'IPA 60/40']);
  });

  it('보낼 변경이 없으면 서버 목록을 받아 온다', async () => {
    await setSetting(SETTING.webAppUrl, 'https://example.test/exec');
    server.fluids = ['물', '25% t-BuOH'];
    await syncNow({ pull: true });
    expect((await db.fluids.orderBy('order').toArray()).map((f) => f.name)).toEqual(['물', '25% t-BuOH']);
  });
});
