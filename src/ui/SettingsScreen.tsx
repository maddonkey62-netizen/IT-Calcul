import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CALC_VERSION } from '../calc/diffusion';
import { convertPressure, type PressureUnit } from '../calc/units';
import { FACTORY_PREFS, getDeviceId, getSetting, setSetting, SETTING, type Prefs } from '../data/db';
import { APP_VERSION, saveFluids } from '../data/records';
import { syncNow, testConnection } from '../data/sync';
import { NumberField, numToStr, parseNum, Toggle, UnitSelect } from './fields';
import { formatDateTime, useFluids, useSyncState } from './hooks';

interface Props {
  prefs: Prefs;
  notify: (msg: string) => void;
}

export function SettingsScreen({ prefs, notify }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PrefsCard prefs={prefs} notify={notify} />
      <FluidsCard notify={notify} />
      <SheetsCard notify={notify} />
      <p className="text-center text-sm text-slate-500">
        앱 버전 {APP_VERSION} · 계산식 {CALC_VERSION}
      </p>
    </div>
  );
}

function PrefsCard({ prefs, notify }: Props) {
  const [patm, setPatm] = useState(numToStr(prefs.patm));
  const [testT, setTestT] = useState(numToStr(prefs.testTempC));
  const [refT, setRefT] = useState(numToStr(prefs.refTempC));

  useEffect(() => {
    setPatm(numToStr(prefs.patm));
    setTestT(numToStr(prefs.testTempC));
    setRefT(numToStr(prefs.refTempC));
  }, [prefs]);

  const update = (patch: Partial<Prefs>) => setSetting(SETTING.prefs, { ...prefs, ...patch });

  /** 칸을 벗어날 때 올바른 값이면 저장, 아니면 원래 값으로 */
  const commit = (key: 'patm' | 'testTempC' | 'refTempC', raw: string, reset: () => void) => {
    const v = parseNum(raw);
    const ok = key === 'patm' ? v > 0 : v > -273.15;
    if (Number.isFinite(v) && ok) void update({ [key]: v });
    else reset();
  };

  const changePatmUnit = (unit: PressureUnit) =>
    update({ patmUnit: unit, patm: Number(convertPressure(prefs.patm, prefs.patmUnit, unit).toPrecision(6)) });

  const factoryReset = async () => {
    await setSetting(SETTING.prefs, FACTORY_PREFS);
    notify('계산 기본값을 처음 값으로 되돌렸습니다');
  };

  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">계산 기본값</h2>
        <button type="button" className="btn-secondary h-10 px-3 text-sm" onClick={() => void factoryReset()}>
          ↺ 처음 값으로
        </button>
      </div>
      <p className="-mt-2 text-sm text-slate-500 dark:text-slate-400">
        새 시험을 시작할 때 자동으로 채워지는 값입니다 (처음 값: 1.01325 bar, 20 °C, 보정 OFF). 이 기기에만 적용됩니다.
      </p>
      <div onBlur={() => commit('patm', patm, () => setPatm(numToStr(prefs.patm)))}>
        <NumberField id="pref-patm" label="대기압 P_atm" value={patm} onChange={setPatm}>
          <UnitSelect label="대기압 단위" value={prefs.patmUnit} onChange={(u) => void changePatmUnit(u)} />
        </NumberField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div onBlur={() => commit('testTempC', testT, () => setTestT(numToStr(prefs.testTempC)))}>
          <NumberField id="pref-test" label="시험 온도" suffix="°C" value={testT} onChange={setTestT} />
        </div>
        <div onBlur={() => commit('refTempC', refT, () => setRefT(numToStr(prefs.refTempC)))}>
          <NumberField id="pref-ref" label="기준 온도" suffix="°C" value={refT} onChange={setRefT} />
        </div>
      </div>
      <Toggle label="온도 보정 기본 사용" checked={prefs.tempCorrection} onChange={(v) => void update({ tempCorrection: v })} />
      <div>
        <span className="field-label">기본 압력 단위 (bar 이면 시험 압력·ΔP 는 mbar)</span>
        <UnitSelect label="기본 압력 단위" value={prefs.defaultUnit} onChange={(u) => void update({ defaultUnit: u })} />
      </div>
    </section>
  );
}

function FluidsCard({ notify }: { notify: (msg: string) => void }) {
  const fluids = useFluids();
  const [draft, setDraft] = useState('');

  const commit = async (next: string[]) => {
    await saveFluids(next);
    void syncNow({ force: true });
  };

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    if (fluids.includes(name)) {
      notify('이미 있는 용액입니다');
      return;
    }
    await commit([...fluids, name]);
    setDraft('');
  };

  const rename = async (i: number) => {
    const name = window.prompt('용액 이름', fluids[i])?.trim();
    if (!name || name === fluids[i]) return;
    await commit(fluids.map((f, j) => (j === i ? name : f)));
  };

  const remove = async (i: number) => {
    if (!window.confirm(`'${fluids[i]}' 을(를) 목록에서 지울까요? 이미 저장된 기록은 바뀌지 않습니다.`)) return;
    await commit(fluids.filter((_, j) => j !== i));
  };

  const move = async (i: number, d: -1 | 1) => {
    const next = [...fluids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    await commit(next);
  };

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-lg font-bold">습윤 용액 목록</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Google Sheets 로 팀 전체가 같은 목록을 씁니다</p>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {fluids.map((f, i) => (
          <li key={f} className="flex items-center gap-1 py-2">
            <span className="flex-1 text-base font-medium">{f}</span>
            <IconBtn label="위로" disabled={i === 0} onClick={() => void move(i, -1)}>↑</IconBtn>
            <IconBtn label="아래로" disabled={i === fluids.length - 1} onClick={() => void move(i, 1)}>↓</IconBtn>
            <IconBtn label="이름 바꾸기" onClick={() => void rename(i)}>✎</IconBtn>
            <IconBtn label="삭제" onClick={() => void remove(i)}>✕</IconBtn>
          </li>
        ))}
        {fluids.length === 0 && <li className="py-2 text-sm text-slate-500">등록된 용액이 없습니다</li>}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label htmlFor="new-fluid" className="sr-only">새 용액 이름</label>
        <input id="new-fluid" className="input h-12 text-base" placeholder="예) IPA 60/40" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn-primary shrink-0">+ 추가</button>
      </form>
    </section>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="h-10 w-10 rounded-lg text-lg text-slate-500 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  );
}

function SheetsCard({ notify }: { notify: (msg: string) => void }) {
  const saved = useLiveQuery(() => getSetting<string>(SETTING.webAppUrl, ''));
  const [deviceId, setDeviceId] = useState<string>();
  const sync = useSyncState();

  useEffect(() => {
    void getDeviceId().then(setDeviceId);
  }, []);
  const [url, setUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (saved !== undefined) setUrl(saved);
  }, [saved]);

  const valid = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url.trim());

  const saveAndTest = async () => {
    const u = url.trim();
    setTesting(true);
    setResult(null);
    const r = await testConnection(u);
    setTesting(false);
    setResult(r);
    if (r.ok) {
      await setSetting(SETTING.webAppUrl, u);
      notify('Google Sheets 에 연결했습니다');
      void syncNow({ force: true });
    }
  };

  const disconnect = async () => {
    if (!window.confirm('연결을 해제할까요? 기기에 저장된 기록은 지워지지 않습니다.')) return;
    await setSetting(SETTING.webAppUrl, '');
    setUrl('');
    setResult(null);
  };

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-lg font-bold">Google Sheets 연결</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Apps Script 웹앱 배포 후 받은 URL 을 붙여 넣으세요 (…/exec 로 끝남)</p>
      </div>
      <label htmlFor="webapp" className="sr-only">웹앱 URL</label>
      <input
        id="webapp"
        className="input h-12 text-sm"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://script.google.com/macros/s/…/exec"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      {url && !valid && <p className="text-sm text-amber-600">URL 형식을 확인하세요: https://script.google.com/macros/s/…/exec</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" disabled={!valid || testing} onClick={() => void saveAndTest()}>
          {testing ? '확인 중…' : '연결 테스트 후 저장'}
        </button>
        {saved && (
          <button type="button" className="btn-secondary" onClick={() => void disconnect()}>
            연결 해제
          </button>
        )}
      </div>
      {result && (
        <p className={`text-sm font-semibold ${result.ok ? 'text-emerald-600' : 'text-red-600'}`}>
          {result.ok ? '✓ ' : '✕ '}
          {result.message}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-slate-500">상태</dt>
          <dd className="font-medium">{saved ? '연결됨' : '연결 안 됨'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">전송 대기</dt>
          <dd className="font-medium">{sync?.pending ?? 0}건</dd>
        </div>
        <div>
          <dt className="text-slate-500">마지막 동기화</dt>
          <dd className="font-medium">{sync?.lastSyncAt ? formatDateTime(sync.lastSyncAt) : '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">기기 ID</dt>
          <dd className="font-mono">{deviceId ?? '—'}</dd>
        </div>
      </dl>
      {sync?.lastError && <p className="text-sm text-red-600">최근 오류: {sync.lastError}</p>}
    </section>
  );
}
