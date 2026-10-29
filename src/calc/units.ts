export type PressureUnit = 'bar' | 'mbar' | 'psi' | 'kPa';

/** 시험 압력·대기압 단위 */
export const PRESSURE_UNITS: PressureUnit[] = ['bar', 'psi', 'kPa'];
/** ΔP 는 값이 작아서 bar 대신 mbar 로 받는다 */
export const DP_UNITS: PressureUnit[] = ['mbar', 'psi', 'kPa'];

/** 기본 단위가 bar 이면 ΔP 는 mbar 를 쓴다 */
export function dpUnitFor(unit: PressureUnit): PressureUnit {
  return unit === 'bar' ? 'mbar' : unit;
}

/** 1 단위 = 몇 kPa 인지 */
export const KPA_PER_UNIT: Record<PressureUnit, number> = {
  bar: 100,
  mbar: 0.1,
  psi: 6.894757293168361,
  kPa: 1,
};

export function toKPa(value: number, unit: PressureUnit): number {
  return value * KPA_PER_UNIT[unit];
}

export function fromKPa(kPa: number, unit: PressureUnit): number {
  return kPa / KPA_PER_UNIT[unit];
}

export function convertPressure(value: number, from: PressureUnit, to: PressureUnit): number {
  return fromKPa(toKPa(value, from), to);
}

export const KELVIN_OFFSET = 273.15;

export function celsiusToKelvin(c: number): number {
  return c + KELVIN_OFFSET;
}
