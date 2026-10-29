import { calculate, CALC_VERSION, type DiffusionInput } from '../calc/diffusion';
import { db, getDeviceId, newId, type Fluid, type OutboxOp, type TestRecord } from './db';

export const APP_VERSION = '1.0.0';
/** 기기 안에 남겨 두는 전송 완료 기록 수. 전체 이력은 Google Sheets 에 있다. */
export const LOCAL_KEEP = 200;

function enqueue(op: OutboxOp) {
  return db.outbox.add({ op, createdAt: new Date().toISOString(), attempts: 0, nextAttemptAt: 0 });
}

export interface SaveInput {
  input: DiffusionInput;
  wettingFluid: string;
  note: string;
  /** 수정이면 기존 기록 id */
  editingId?: string;
}

/** 계산 후 기록과 전송 작업을 한 번에 저장한다. 오프라인이어도 항상 성공한다. */
export async function saveRecord({ input, wettingFluid, note, editingId }: SaveInput): Promise<TestRecord> {
  const result = calculate(input);
  if (!result) throw new Error('입력값이 올바르지 않아 저장할 수 없습니다');

  const now = new Date().toISOString();
  const deviceId = await getDeviceId();

  return db.transaction('rw', db.records, db.outbox, async () => {
    const prev = editingId ? await db.records.get(editingId) : undefined;
    const record: TestRecord = {
      ...input,
      ...result,
      id: prev?.id ?? newId(),
      testAt: prev?.testAt ?? now,
      wettingFluid,
      note,
      deleted: false,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      calcVersion: CALC_VERSION,
      appVersion: APP_VERSION,
      deviceId,
      syncStatus: 'pending',
    };
    await db.records.put(record);
    await enqueue({ type: 'upsert', recordId: record.id });
    return record;
  });
}

/** 기기 목록에서 지우고 Sheets 에는 '삭제됨'으로 표시한다 (행은 보존). */
export async function deleteRecord(id: string) {
  const now = new Date().toISOString();
  await db.transaction('rw', db.records, db.outbox, async () => {
    await db.records.update(id, { deleted: true, updatedAt: now, syncStatus: 'pending' });
    await enqueue({ type: 'delete', recordId: id });
  });
}

export async function saveFluids(names: string[]) {
  const fluids: Fluid[] = names.map((name, order) => ({ name, order }));
  await db.transaction('rw', db.fluids, db.outbox, async () => {
    await db.fluids.clear();
    await db.fluids.bulkPut(fluids);
    // 목록 전체를 보내므로 예전 작업은 필요 없다
    const old = await db.outbox.filter((i) => i.op.type === 'setFluids').primaryKeys();
    await db.outbox.bulkDelete(old);
    await enqueue({ type: 'setFluids' });
  });
}

export function recentRecords(limit = 50) {
  return db.records
    .orderBy('createdAt')
    .reverse()
    .filter((r) => !r.deleted)
    .limit(limit)
    .toArray();
}

/** Google Sheets 열 이름(snake_case)으로 바꾼다. 서버의 HEADERS 와 맞춰야 한다. */
export function toSheetRow(r: TestRecord) {
  return {
    id: r.id,
    test_at: r.testAt,
    volume_ml: r.volumeMl,
    test_pressure: r.testPressure,
    test_pressure_unit: r.testPressureUnit,
    stabilization_min: r.stabilizationMin,
    measure_min: r.measureMin,
    dp: r.dp,
    dp_unit: r.dpUnit,
    patm: r.patm,
    patm_unit: r.patmUnit,
    temp_correction: r.tempCorrection,
    t_test_c: r.tempCorrection ? r.testTempC : '',
    t_ref_c: r.tempCorrection ? r.refTempC : '',
    wetting_fluid: r.wettingFluid,
    note: r.note,
    dp_kpa: r.dpKPa,
    patm_kpa: r.patmKPa,
    temp_factor: r.tempFactor,
    diffusion_ml_min: r.mlPerMin,
    diffusion_ml_hr: r.mlPerHr,
    deleted: r.deleted,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    device_id: r.deviceId,
    calc_version: r.calcVersion,
    app_version: r.appVersion,
  };
}

/** 전송이 끝난 오래된 기록을 기기에서 정리한다. */
export async function pruneLocal() {
  const all = await db.records.orderBy('createdAt').reverse().toArray();
  const drop = all
    .filter((r, i) => r.syncStatus === 'synced' && (r.deleted || i >= LOCAL_KEEP))
    .map((r) => r.id);
  if (drop.length) await db.records.bulkDelete(drop);
}
