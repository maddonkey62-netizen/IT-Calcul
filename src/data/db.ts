import Dexie, { type Table } from 'dexie';
import type { DiffusionInput, DiffusionResult } from '../calc/diffusion';
import { DEFAULT_PATM, DEFAULT_REF_TEMP_C, DEFAULT_TEST_TEMP_C } from '../calc/diffusion';
import type { PressureUnit } from '../calc/units';

export type SyncStatus = 'pending' | 'synced' | 'error';

/** 시험 기록 1건. 기기 안(IndexedDB)과 Google Sheets 에 같은 id 로 저장된다. */
export interface TestRecord extends DiffusionInput, DiffusionResult {
  id: string;
  testAt: string;
  wettingFluid: string;
  note: string;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
  calcVersion: string;
  appVersion: string;
  deviceId: string;
  syncStatus: SyncStatus;
  syncError?: string;
}

export type OutboxOp =
  | { type: 'upsert'; recordId: string }
  | { type: 'delete'; recordId: string }
  | { type: 'setFluids' };

/** Sheets 로 보낼 작업 대기열. 보낼 때 기록의 최신 상태를 읽어 보낸다. */
export interface OutboxItem {
  seq?: number;
  op: OutboxOp;
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
}

export interface Fluid {
  name: string;
  order: number;
}

export interface Prefs {
  patm: number;
  patmUnit: PressureUnit;
  testTempC: number;
  refTempC: number;
  tempCorrection: boolean;
  defaultUnit: PressureUnit;
}

export const FACTORY_PREFS: Prefs = {
  patm: DEFAULT_PATM.value,
  patmUnit: DEFAULT_PATM.unit,
  testTempC: DEFAULT_TEST_TEMP_C,
  refTempC: DEFAULT_REF_TEMP_C,
  tempCorrection: false,
  defaultUnit: 'bar',
};

export interface SettingsRow {
  key: string;
  value: unknown;
}

class AppDB extends Dexie {
  records!: Table<TestRecord, string>;
  outbox!: Table<OutboxItem, number>;
  fluids!: Table<Fluid, string>;
  settings!: Table<SettingsRow, string>;

  constructor(name = 'diffusion-rate') {
    super(name);
    this.version(1).stores({
      records: 'id, createdAt, updatedAt, syncStatus',
      outbox: '++seq, nextAttemptAt',
      fluids: 'name, order',
      settings: 'key',
    });
  }
}

export const db = new AppDB();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export function setSetting(key: string, value: unknown) {
  return db.settings.put({ key, value });
}

export const SETTING = {
  prefs: 'prefs',
  webAppUrl: 'webAppUrl',
  deviceId: 'deviceId',
  lastSyncAt: 'lastSyncAt',
  lastSyncError: 'lastSyncError',
} as const;

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** 기기마다 한 번 만들어 두는 무작위 ID. 어느 기기에서 저장했는지 Sheets 에 남긴다. */
export async function getDeviceId(): Promise<string> {
  const existing = await getSetting<string | null>(SETTING.deviceId, null);
  if (existing) return existing;
  const id = `dev-${newId().slice(0, 8)}`;
  await setSetting(SETTING.deviceId, id);
  return id;
}
