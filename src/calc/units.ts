export type PressureUnit = 'mbar' | 'bar' | 'psi' | 'kPa' | 'MPa';

export const PRESSURE_UNITS: PressureUnit[] = ['mbar', 'bar', 'psi', 'kPa', 'MPa'];

/** 1 단위 = 몇 kPa 인지 */
export const KPA_PER_UNIT: Record<PressureUnit, number> = {
  bar: 100,
  mbar: 0.1,
  psi: 6.894757293168361,
  kPa: 1,
  MPa: 1000,
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
