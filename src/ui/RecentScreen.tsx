import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatMlPerHr, formatMlPerMin } from '../calc/diffusion';
import type { TestRecord } from '../data/db';
import { deleteRecord, recentRecords } from '../data/records';
import { syncNow } from '../data/sync';
import { formatDateTime, useSyncState } from './hooks';

const STATUS = {
  synced: { icon: '✓', label: '전송됨', cls: 'text-emerald-600 dark:text-emerald-400' },
  pending: { icon: '⏳', label: '대기', cls: 'text-blue-600 dark:text-blue-400' },
  error: { icon: '⚠', label: '실패 · 자동 재시도', cls: 'text-red-600 dark:text-red-400' },
} as const;

interface Props {
  onEdit: (r: TestRecord) => void;
  notify: (msg: string) => void;
}

export function RecentScreen({ onEdit, notify }: Props) {
  const records = useLiveQuery(() => recentRecords(50), []);
  const sync = useSyncState();
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const runSync = async () => {
    setSyncing(true);
    const out = await syncNow({ force: true, pull: true });
    setSyncing(false);
    if (out.kind === 'not-configured') notify('설정에서 Google Sheets 웹앱 URL 을 먼저 입력하세요');
    else if (out.kind === 'offline') notify('오프라인입니다. 연결되면 자동으로 보냅니다');
    else if (out.kind === 'error') notify(`전송 실패: ${out.message}`);
    else notify(out.sent ? `${out.sent}건 전송했습니다` : '보낼 기록이 없습니다');
  };

  const remove = async (r: TestRecord) => {
    if (!window.confirm(`${formatDateTime(r.testAt)} 기록을 삭제할까요?\nGoogle Sheets 에는 '삭제됨'으로 표시되어 남습니다.`)) return;
    await deleteRecord(r.id);
    setOpenId(null);
    notify('삭제했습니다');
    void syncNow({ force: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">최근 기록</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            이 기기에서 저장한 최근 50건 · 전체 이력은 Google Sheets
            {sync?.lastSyncAt && <> · 마지막 동기화 {formatDateTime(sync.lastSyncAt)}</>}
          </p>
        </div>
        <button type="button" className="btn-secondary shrink-0" disabled={syncing} onClick={() => void runSync()}>
          {syncing ? '동기화 중…' : '지금 동기화'}
        </button>
      </div>

      {records && records.length === 0 && (
        <div className="card py-10 text-center text-slate-500">아직 저장한 기록이 없습니다</div>
      )}

      <ul className="space-y-2">
        {records?.map((r) => {
          const s = STATUS[r.syncStatus];
          const open = openId === r.id;
          return (
            <li key={r.id} className="card p-0">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : r.id)}
              >
                <span className="w-28 shrink-0 text-sm tabular-nums text-slate-500 dark:text-slate-400">{formatDateTime(r.testAt).slice(5)}</span>
                <span className="flex-1 text-lg font-bold tabular-nums">
                  {formatMlPerMin(r.mlPerMin)} <span className="text-sm font-semibold text-slate-500">mL/min</span>
                </span>
                <span className="hidden truncate text-sm text-slate-500 sm:block">
                  {r.wettingFluid}
                  {r.tempCorrection && ' (보정)'}
                </span>
                <span className={`w-6 text-center text-lg ${s.cls}`} title={s.label} aria-label={s.label}>
                  {s.icon}
                </span>
              </button>
              {open && (
                <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                    <Item k="시험 일시" v={formatDateTime(r.testAt)} />
                    <Item k="V" v={`${r.volumeMl} mL`} />
                    <Item k="시험 압력" v={`${r.testPressure} ${r.testPressureUnit} (g)`} />
                    <Item k="안정화 / 측정" v={`${r.stabilizationMin} / ${r.measureMin} min`} />
                    <Item k="ΔP" v={`${r.dp} ${r.dpUnit}`} />
                    <Item k="대기압" v={`${r.patm} ${r.patmUnit}`} />
                    <Item k="온도 보정" v={r.tempCorrection ? `ON · ${r.testTempC} → ${r.refTempC} °C` : 'OFF'} />
                    <Item k="mL/hr" v={formatMlPerHr(r.mlPerHr)} />
                    <Item k="습윤 용액" v={r.wettingFluid || '—'} />
                    <Item k="비고" v={r.note || '—'} />
                    <Item k="전송" v={r.syncError ? `${s.label} (${r.syncError})` : s.label} />
                  </dl>
                  <div className="mt-3 flex gap-2">
                    <button type="button" className="btn-secondary flex-1" onClick={() => onEdit(r)}>
                      수정
                    </button>
                    <button type="button" className="btn-danger flex-1" onClick={() => void remove(r)}>
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
      <dd className="break-words font-medium">{v}</dd>
    </div>
  );
}
