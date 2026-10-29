import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  calculate,
  formatMlPerHr,
  formatMlPerMin,
  validate,
  type DiffusionInput,
  type FieldKey,
} from '../calc/diffusion';
import { convertPressure, GAUGE_UNITS, gaugeUnitFor, type PressureUnit } from '../calc/units';
import type { Prefs, TestRecord } from '../data/db';
import { recentRecords, saveRecord } from '../data/records';
import { syncNow } from '../data/sync';
import { NumberField, numToStr, parseNum, Toggle, UnitSelect } from './fields';
import { formatDateTime, useFluids } from './hooks';

interface Form {
  volumeMl: string;
  testPressure: string;
  testPressureUnit: PressureUnit;
  stabilizationMin: string;
  measureMin: string;
  dp: string;
  dpUnit: PressureUnit;
  patm: string;
  patmUnit: PressureUnit;
  tempCorrection: boolean;
  testTempC: string;
  refTempC: string;
  wettingFluid: string;
  note: string;
}

function referenceFrom(prefs: Prefs) {
  return {
    patm: numToStr(prefs.patm),
    patmUnit: prefs.patmUnit,
    tempCorrection: prefs.tempCorrection,
    testTempC: numToStr(prefs.testTempC),
    refTempC: numToStr(prefs.refTempC),
  };
}

function emptyForm(prefs: Prefs): Form {
  return {
    volumeMl: '',
    testPressure: '',
    testPressureUnit: gaugeUnitFor(prefs.defaultUnit),
    stabilizationMin: '',
    measureMin: '',
    dp: '',
    dpUnit: gaugeUnitFor(prefs.defaultUnit),
    ...referenceFrom(prefs),
    wettingFluid: '',
    note: '',
  };
}

/** bar 로 저장된 예전 기록 값은 mbar 로 바꿔 보여 준다 (계산 결과는 같음) */
function gaugeValue(value: number, unit: PressureUnit): string {
  return numToStr(unit === 'bar' ? Number(convertPressure(value, 'bar', 'mbar').toPrecision(12)) : value);
}

function formFromRecord(r: TestRecord): Form {
  return {
    volumeMl: numToStr(r.volumeMl),
    testPressure: gaugeValue(r.testPressure, r.testPressureUnit),
    testPressureUnit: gaugeUnitFor(r.testPressureUnit),
    stabilizationMin: numToStr(r.stabilizationMin),
    measureMin: numToStr(r.measureMin),
    dp: gaugeValue(r.dp, r.dpUnit),
    dpUnit: gaugeUnitFor(r.dpUnit),
    patm: numToStr(r.patm),
    patmUnit: r.patmUnit,
    tempCorrection: r.tempCorrection,
    testTempC: numToStr(r.testTempC),
    refTempC: numToStr(r.refTempC),
    wettingFluid: r.wettingFluid,
    note: r.note,
  };
}

function toInput(f: Form): DiffusionInput {
  return {
    volumeMl: parseNum(f.volumeMl),
    testPressure: parseNum(f.testPressure),
    testPressureUnit: f.testPressureUnit,
    stabilizationMin: parseNum(f.stabilizationMin),
    measureMin: parseNum(f.measureMin),
    dp: parseNum(f.dp),
    dpUnit: f.dpUnit,
    patm: parseNum(f.patm),
    patmUnit: f.patmUnit,
    tempCorrection: f.tempCorrection,
    testTempC: parseNum(f.testTempC),
    refTempC: parseNum(f.refTempC),
  };
}

const round6 = (n: number) => Number(n.toPrecision(6));

interface Props {
  prefs: Prefs;
  editing: TestRecord | null;
  onEditDone: () => void;
  notify: (msg: string) => void;
}

export function CalcScreen({ prefs, editing, onEditDone, notify }: Props) {
  const [form, setForm] = useState<Form>(() => emptyForm(prefs));
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set());
  const [refOpen, setRefOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const fluids = useFluids();
  const recent = useLiveQuery(() => recentRecords(5), []) ?? [];

  useEffect(() => {
    if (editing) {
      setForm(formFromRecord(editing));
      setTouched(new Set());
      setRefOpen(true);
    }
  }, [editing]);

  const input = useMemo(() => toInput(form), [form]);
  const validation = useMemo(() => validate(input), [input]);
  const result = useMemo(() => calculate(input), [input]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in input) setTouched((t) => new Set(t).add(key as FieldKey));
  };

  const errorOf = (field: FieldKey) =>
    touched.has(field) ? validation.errors.find((e) => e.field === field)?.message : undefined;
  const warningOf = (field: FieldKey) => validation.warnings.find((w) => w.field === field)?.message;

  /** 대기압은 정해진 물리량이므로 단위를 바꾸면 값도 환산한다 */
  const changePatmUnit = (unit: PressureUnit) => {
    const v = parseNum(form.patm);
    setForm((f) => ({
      ...f,
      patmUnit: unit,
      patm: Number.isFinite(v) ? numToStr(round6(convertPressure(v, f.patmUnit, unit))) : f.patm,
    }));
  };

  const resetReference = () => {
    setForm((f) => ({ ...f, ...referenceFrom(prefs) }));
    notify('기준값을 기본값으로 되돌렸습니다');
  };

  /** 최근 기록의 반복 값(V·시험 압력·시간·단위·용액)을 채운다. ΔP 는 매번 새로 재므로 비운다. */
  const loadRecent = (id: string) => {
    const r = recent.find((x) => x.id === id);
    if (!r) return;
    setForm((f) => ({
      ...f,
      volumeMl: numToStr(r.volumeMl),
      testPressure: gaugeValue(r.testPressure, r.testPressureUnit),
      testPressureUnit: gaugeUnitFor(r.testPressureUnit),
      stabilizationMin: numToStr(r.stabilizationMin),
      measureMin: numToStr(r.measureMin),
      dp: '',
      dpUnit: gaugeUnitFor(r.dpUnit),
      wettingFluid: r.wettingFluid,
    }));
    setTouched(new Set());
    notify('최근 입력값을 불러왔습니다. ΔP 를 입력하세요');
  };

  const clear = () => {
    setForm(emptyForm(prefs));
    setTouched(new Set());
    if (editing) onEditDone();
  };

  const save = async () => {
    if (!result) {
      setTouched(new Set(validation.errors.map((e) => e.field)));
      return;
    }
    setSaving(true);
    try {
      await saveRecord({ input, wettingFluid: form.wettingFluid, note: form.note.trim(), editingId: editing?.id });
      notify(editing ? '수정했습니다 · 전송 대기' : '저장했습니다 · 전송 대기');
      // 다음 시험을 위해 측정값만 비우고 반복 값은 남긴다
      setForm((f) => ({ ...f, dp: '', note: '' }));
      setTouched(new Set());
      if (editing) onEditDone();
      void syncNow({ force: true });
    } catch (e) {
      notify(e instanceof Error ? e.message : '저장하지 못했습니다');
    } finally {
      setSaving(false);
    }
  };

  const refSummary = `대기압 ${form.patm || '—'} ${form.patmUnit} · 온도 보정 ${
    form.tempCorrection ? `ON (${form.testTempC || '—'} → ${form.refTempC || '—'} °C)` : 'OFF'
  }`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {editing && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span className="text-sm font-semibold">기록 수정 중 · {formatDateTime(editing.testAt)}</span>
            <button type="button" className="text-sm font-semibold underline" onClick={clear}>
              취소
            </button>
          </div>
        )}

        {!editing && recent.length > 0 && (
          <div>
            <label htmlFor="recent" className="sr-only">
              최근 입력값 불러오기
            </label>
            <select
              id="recent"
              className="input h-12 cursor-pointer text-base font-semibold text-blue-700 dark:text-blue-300"
              value=""
              onChange={(e) => loadRecent(e.target.value)}
            >
              <option value="">↺ 최근 입력값 불러오기</option>
              {recent.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatDateTime(r.testAt)} · V {r.volumeMl} mL · {r.testPressure} {r.testPressureUnit} ·{' '}
                  {r.wettingFluid || '용액 없음'}
                </option>
              ))}
            </select>
          </div>
        )}

        <section className="card space-y-4">
          <NumberField id="volumeMl" label="용기(상류측) 체적 V" suffix="mL" value={form.volumeMl} onChange={(v) => set('volumeMl', v)} error={errorOf('volumeMl')} />
          <NumberField id="testPressure" label="시험 압력 (게이지압)" value={form.testPressure} onChange={(v) => set('testPressure', v)} error={errorOf('testPressure')}>
            <UnitSelect label="시험 압력 단위" units={GAUGE_UNITS} value={form.testPressureUnit} onChange={(u) => set('testPressureUnit', u)} />
          </NumberField>
          <div className="grid grid-cols-2 gap-3">
            <NumberField id="stabilizationMin" label="안정화 시간" suffix="min" value={form.stabilizationMin} onChange={(v) => set('stabilizationMin', v)} error={errorOf('stabilizationMin')} />
            <NumberField id="measureMin" label="측정 시간 t" suffix="min" value={form.measureMin} onChange={(v) => set('measureMin', v)} error={errorOf('measureMin')} />
          </div>
          <NumberField id="dp" label="Pressure Drop ΔP" value={form.dp} onChange={(v) => set('dp', v)} error={errorOf('dp')} warning={warningOf('dp')}>
            <UnitSelect label="ΔP 단위" units={GAUGE_UNITS} value={form.dpUnit} onChange={(u) => set('dpUnit', u)} />
          </NumberField>
        </section>

        <section className="card">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="flex min-h-12 flex-1 items-center gap-2 text-left"
              aria-expanded={refOpen}
              onClick={() => setRefOpen((o) => !o)}
            >
              <span className={`text-slate-400 transition ${refOpen ? 'rotate-90' : ''}`}>▶</span>
              <span>
                <span className="block text-base font-semibold">기준값</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">{refSummary}</span>
              </span>
            </button>
            <button type="button" className="btn-secondary h-10 px-3 text-sm" onClick={resetReference}>
              ↺ 기본값
            </button>
          </div>
          {refOpen && (
            <div className="mt-4 space-y-4 border-t border-slate-200 pt-4 dark:border-slate-800">
              <NumberField id="patm" label="대기압 P_atm" value={form.patm} onChange={(v) => set('patm', v)} error={errorOf('patm')}>
                <UnitSelect label="대기압 단위" value={form.patmUnit} onChange={changePatmUnit} />
              </NumberField>
              <Toggle label="온도 보정 (× T_ref / T_test)" checked={form.tempCorrection} onChange={(v) => set('tempCorrection', v)} />
              {form.tempCorrection && (
                <div className="grid grid-cols-2 gap-3">
                  <NumberField id="testTempC" label="시험 온도" suffix="°C" value={form.testTempC} onChange={(v) => set('testTempC', v)} error={errorOf('testTempC')} />
                  <NumberField id="refTempC" label="기준 온도" suffix="°C" value={form.refTempC} onChange={(v) => set('refTempC', v)} error={errorOf('refTempC')} />
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card space-y-4">
          <div>
            <label htmlFor="fluid" className="field-label">
              습윤 용액
            </label>
            <select id="fluid" className="input text-lg" value={form.wettingFluid} onChange={(e) => set('wettingFluid', e.target.value)}>
              <option value="">선택 안 함</option>
              {fluids.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              {form.wettingFluid && !fluids.includes(form.wettingFluid) && <option value={form.wettingFluid}>{form.wettingFluid}</option>}
            </select>
            {fluids.length === 0 && <p className="mt-1 text-sm text-slate-500">설정 화면에서 용액 목록을 등록하세요</p>}
          </div>
          <div>
            <label htmlFor="note" className="field-label">
              비고
            </label>
            <textarea
              id="note"
              rows={2}
              className="input h-auto py-3 text-base"
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="장비 번호, 특이사항 등"
            />
          </div>
        </section>
        {/* 모바일에서 아래 고정 결과 카드에 가리지 않도록 여백 */}
        <div className="h-2 lg:hidden" />
      </form>

      <aside className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 lg:top-4 lg:bottom-auto" aria-live="polite">
        <div className="card border-blue-200 shadow-lg dark:border-blue-900 lg:shadow-sm">
          <div className="flex items-end justify-between gap-3 lg:block">
            <div>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Diffusion Rate</p>
              <p className="tabular-nums">
                <span className="text-4xl font-bold text-blue-700 dark:text-blue-300 lg:text-5xl">
                  {result ? formatMlPerMin(result.mlPerMin) : '—'}
                </span>
                <span className="ml-1 text-lg font-semibold text-slate-500">mL/min</span>
              </p>
              <p className="tabular-nums text-base text-slate-600 dark:text-slate-300">
                {result ? formatMlPerHr(result.mlPerHr) : '—'} <span className="text-sm">mL/hr</span>
              </p>
            </div>
            <div className="flex shrink-0 gap-2 lg:mt-4">
              <button type="button" className="btn-secondary hidden lg:inline-flex" onClick={clear}>
                초기화
              </button>
              <button type="button" className="btn-primary min-w-[6.5rem] lg:flex-1" disabled={saving} onClick={() => void save()}>
                {editing ? '수정 저장' : '저장'}
              </button>
            </div>
          </div>
          {result && (
            <p className="mt-2 hidden text-sm text-slate-500 dark:text-slate-400 lg:block">
              ΔP {result.dpKPa.toFixed(3)} kPa · P_atm {result.patmKPa.toFixed(3)} kPa · 보정 계수 {result.tempFactor.toFixed(4)}
            </p>
          )}
          {validation.warnings.length > 0 && (
            <p className="mt-2 text-sm font-semibold text-amber-600 dark:text-amber-400">⚠ {validation.warnings[0].message}</p>
          )}
        </div>
      </aside>
    </div>
  );
}
