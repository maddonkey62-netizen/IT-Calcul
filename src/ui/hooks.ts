import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, FACTORY_PREFS, getSetting, SETTING, type Prefs } from '../data/db';

export function usePrefs(): Prefs | undefined {
  return useLiveQuery(async () => ({ ...FACTORY_PREFS, ...(await getSetting<Partial<Prefs>>(SETTING.prefs, {})) }));
}

export function useFluids(): string[] {
  return useLiveQuery(async () => (await db.fluids.orderBy('order').toArray()).map((f) => f.name)) ?? [];
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export interface SyncState {
  configured: boolean;
  pending: number;
  failed: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export function useSyncState(): SyncState | undefined {
  return useLiveQuery(async () => {
    const [url, pending, failed, lastSyncAt, lastError] = await Promise.all([
      getSetting<string>(SETTING.webAppUrl, ''),
      db.outbox.count(),
      db.records.where('syncStatus').equals('error').count(),
      getSetting<string | null>(SETTING.lastSyncAt, null),
      getSetting<string | null>(SETTING.lastSyncError, null),
    ]);
    return { configured: !!url, pending, failed, lastSyncAt, lastError };
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
