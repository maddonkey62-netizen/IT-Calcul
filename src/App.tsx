import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { TestRecord } from './data/db';
import { startAutoSync, syncNow } from './data/sync';
import { CalcScreen } from './ui/CalcScreen';
import { useOnline, usePrefs, useSyncState } from './ui/hooks';
import { RecentScreen } from './ui/RecentScreen';
import { SettingsScreen } from './ui/SettingsScreen';

type Tab = 'calc' | 'recent' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'calc', label: '계산', icon: '🧮' },
  { id: 'recent', label: '최근 기록', icon: '🗂' },
  { id: 'settings', label: '설정', icon: '⚙' },
];

export default function App() {
  const prefs = usePrefs();
  const [tab, setTab] = useState<Tab>('calc');
  const [editing, setEditing] = useState<TestRecord | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => startAutoSync(), []);

  const edit = (r: TestRecord) => {
    setEditing(r);
    setTab('calc');
    window.scrollTo({ top: 0 });
  };

  if (!prefs) return null;

  return (
    <div className="min-h-dvh md:flex">
      <nav
        aria-label="메뉴"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur
          dark:border-slate-800 dark:bg-slate-900/95
          md:sticky md:top-0 md:h-dvh md:w-56 md:flex-col md:border-r md:border-t-0 md:p-3 md:pb-3"
      >
        <div className="hidden px-2 pb-6 pt-2 md:block">
          <p className="text-lg font-bold text-blue-700 dark:text-blue-300">Diffusion Rate</p>
          <p className="text-xs text-slate-500">Pressure Decay 계산기</p>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
            className={`flex h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold transition
              md:h-12 md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-xl md:px-3 md:text-base
              ${
                tab === t.id
                  ? 'text-blue-700 dark:text-blue-300 md:bg-blue-50 md:dark:bg-blue-950'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
          >
            <span className="text-xl" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
            <h1 className="truncate text-lg font-bold">{tab === 'calc' ? 'Diffusion Rate 계산' : TABS.find((t) => t.id === tab)!.label}</h1>
            <SyncBadge onClick={() => setTab('recent')} />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 md:pb-10">
          {/* 계산 화면은 탭을 옮겨도 입력 중인 값이 남도록 숨기기만 한다 */}
          <div hidden={tab !== 'calc'}>
            <CalcScreen prefs={prefs} editing={editing} onEditDone={() => setEditing(null)} notify={notify} />
          </div>
          {tab === 'recent' && <RecentScreen onEdit={edit} notify={notify} />}
          {tab === 'settings' && <SettingsScreen prefs={prefs} notify={notify} />}
        </main>
      </div>

      {toast && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg dark:bg-slate-100 dark:text-slate-900 md:bottom-6"
        >
          {toast}
        </div>
      )}
      <UpdatePrompt />
    </div>
  );
}

function SyncBadge({ onClick }: { onClick: () => void }) {
  const online = useOnline();
  const s = useSyncState();
  if (!s) return null;

  let text: string;
  let cls: string;
  if (!s.configured) {
    text = s.pending ? `Sheets 미연결 · ${s.pending}건 보관` : 'Sheets 미연결';
    cls = 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  } else if (!online) {
    text = s.pending ? `오프라인 · ${s.pending}건 대기` : '오프라인';
    cls = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  } else if (s.failed) {
    text = `전송 실패 ${s.failed}건 · 재시도 중`;
    cls = 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
  } else if (s.pending) {
    text = `${s.pending}건 전송 대기`;
    cls = 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300';
  } else {
    text = '✓ 동기화됨';
    cls = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
  }

  return (
    <button
      type="button"
      onClick={() => {
        onClick();
        void syncNow({ force: true, pull: true });
      }}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${cls}`}
    >
      {text}
    </button>
  );
}

function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!offlineReady && !needRefresh) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-4 top-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-blue-200 bg-white p-3 shadow-lg dark:border-blue-900 dark:bg-slate-900"
    >
      <p className="flex-1 text-sm font-semibold">
        {needRefresh ? '새 버전이 있습니다' : '오프라인에서도 쓸 수 있게 준비됐습니다'}
      </p>
      {needRefresh && (
        <button type="button" className="btn-primary h-10 px-3 text-sm" onClick={() => void updateServiceWorker(true)}>
          업데이트
        </button>
      )}
      <button
        type="button"
        className="btn-secondary h-10 px-3 text-sm"
        onClick={() => {
          setOfflineReady(false);
          setNeedRefresh(false);
        }}
      >
        닫기
      </button>
    </div>
  );
}
