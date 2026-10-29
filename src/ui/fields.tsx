import type { ReactNode } from 'react';
import { PRESSURE_UNITS, type PressureUnit } from '../calc/units';

/** 빈 칸은 NaN. 쉼표 소수점(1,5)도 받는다. */
export function parseNum(s: string): number {
  const t = s.trim().replace(',', '.');
  return t === '' ? NaN : Number(t);
}

export function numToStr(n: number): string {
  return Number.isFinite(n) ? String(n) : '';
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  error?: string;
  warning?: string;
  children?: ReactNode;
}

export function NumberField({ id, label, value, onChange, suffix, error, warning, children }: NumberFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            id={id}
            className={`input ${error ? 'input-error' : ''} ${suffix ? 'pr-16' : ''}`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="next"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9.,\-]/g, ''))}
            aria-invalid={!!error}
            aria-describedby={error || warning ? `${id}-msg` : undefined}
          />
          {suffix && (
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-base text-slate-400">
              {suffix}
            </span>
          )}
        </div>
        {children}
      </div>
      {(error || warning) && (
        <p id={`${id}-msg`} className={`mt-1 text-sm ${error ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {error ?? `⚠ ${warning}`}
        </p>
      )}
    </div>
  );
}

export function UnitSelect({
  value,
  onChange,
  label,
  units = PRESSURE_UNITS,
}: {
  value: PressureUnit;
  onChange: (u: PressureUnit) => void;
  label: string;
  units?: PressureUnit[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-14 shrink-0 rounded-xl border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
      {units.map((u) => (
        <button
          key={u}
          type="button"
          role="radio"
          aria-checked={value === u}
          onClick={() => onChange(u)}
          className={`min-w-[3.25rem] rounded-lg px-2 text-base font-semibold transition ${
            value === u
              ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-950 dark:text-blue-300'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
    >
      <span className="text-base font-semibold">{label}</span>
      <span
        className={`relative h-8 w-14 shrink-0 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}
      >
        <span
          className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-7' : 'left-1'}`}
        />
      </span>
    </button>
  );
}
