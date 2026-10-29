import { celsiusToKelvin, KELVIN_OFFSET, toKPa, type PressureUnit } from './units';

/** 계산식 버전. 공식이 바뀌면 올리고 Sheets 기록에 함께 남긴다. */
export const CALC_VERSION = 'v1';

export const DEFAULT_PATM = { value: 1.01325, unit: 'bar' as PressureUnit };
export const DEFAULT_PATM_KPA = 101.325;
export const DEFAULT_TEST_TEMP_C = 20;
export const DEFAULT_REF_TEMP_C = 20;

export interface DiffusionInput {
  volumeMl: number;
  testPressure: number;
  testPressureUnit: PressureUnit;
  stabilizationMin: number;
  measureMin: number;
  dp: number;
  dpUnit: PressureUnit;
  patm: number;
  patmUnit: PressureUnit;
  tempCorrection: boolean;
  testTempC: number;
  refTempC: number;
}

export interface DiffusionResult {
  dpKPa: number;
  patmKPa: number;
  tempFactor: number;
  mlPerMin: number;
  mlPerHr: number;
}

export type FieldKey =
  | 'volumeMl'
  | 'testPressure'
  | 'stabilizationMin'
  | 'measureMin'
  | 'dp'
  | 'patm'
  | 'testTempC'
  | 'refTempC';

export interface Issue {
  field: FieldKey;
  message: string;
}

export interface Validation {
  /** 계산할 수 없는 오류 */
  errors: Issue[];
  /** 계산·저장은 되지만 확인이 필요한 경고 */
  warnings: Issue[];
}

const isNum = (n: number) => typeof n === 'number' && Number.isFinite(n);

/**
 * 입력값을 검사한다. 비어 있는 칸(NaN)은 오류로 본다.
 * 안정화 시간·시험 압력은 계산에 쓰지 않지만 기록 항목이므로 형식만 검사한다.
 */
export function validate(input: DiffusionInput): Validation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const positive: [FieldKey, number, string][] = [
    ['volumeMl', input.volumeMl, '용기 체적 V는 0보다 커야 합니다'],
    ['measureMin', input.measureMin, '측정 시간 t는 0보다 커야 합니다'],
    ['patm', input.patm, '대기압은 0보다 커야 합니다'],
  ];
  for (const [field, v, msg] of positive) {
    if (!isNum(v)) errors.push({ field, message: '값을 입력하세요' });
    else if (v <= 0) errors.push({ field, message: msg });
  }

  if (!isNum(input.dp)) errors.push({ field: 'dp', message: '값을 입력하세요' });
  else if (input.dp < 0) errors.push({ field: 'dp', message: 'ΔP는 0 이상이어야 합니다' });

  if (!isNum(input.testPressure)) errors.push({ field: 'testPressure', message: '값을 입력하세요' });
  else if (input.testPressure < 0) errors.push({ field: 'testPressure', message: '시험 압력은 0 이상이어야 합니다' });

  if (!isNum(input.stabilizationMin)) errors.push({ field: 'stabilizationMin', message: '값을 입력하세요' });
  else if (input.stabilizationMin < 0) errors.push({ field: 'stabilizationMin', message: '0 이상이어야 합니다' });

  if (input.tempCorrection) {
    for (const field of ['testTempC', 'refTempC'] as const) {
      const v = input[field];
      if (!isNum(v)) errors.push({ field, message: '값을 입력하세요' });
      else if (v <= -KELVIN_OFFSET) errors.push({ field, message: '절대영도(−273.15 °C)보다 높아야 합니다' });
    }
  }

  if (
    isNum(input.dp) &&
    isNum(input.testPressure) &&
    input.testPressure > 0 &&
    toKPa(input.dp, input.dpUnit) >= toKPa(input.testPressure, input.testPressureUnit)
  ) {
    warnings.push({ field: 'dp', message: 'ΔP가 시험 압력 이상입니다. 입력값과 단위를 확인하세요' });
  }

  return { errors, warnings };
}

/**
 * Diffusion Rate [mL/min] = ΔP × V / (P_atm × t)  (ΔP, P_atm 은 kPa 로 통일)
 * 온도 보정 사용 시 × T_ref[K] / T_test[K]
 * mL/hr = mL/min × 60
 * 입력이 유효하지 않으면 null.
 */
export function calculate(input: DiffusionInput): DiffusionResult | null {
  if (validate(input).errors.length > 0) return null;

  const dpKPa = toKPa(input.dp, input.dpUnit);
  const patmKPa = toKPa(input.patm, input.patmUnit);
  const tempFactor = input.tempCorrection
    ? celsiusToKelvin(input.refTempC) / celsiusToKelvin(input.testTempC)
    : 1;

  const mlPerMin = ((dpKPa * input.volumeMl) / (patmKPa * input.measureMin)) * tempFactor;
  return { dpKPa, patmKPa, tempFactor, mlPerMin, mlPerHr: mlPerMin * 60 };
}

/** 화면 표시용 반올림 (저장은 원본 정밀도) */
export function formatMlPerMin(v: number): string {
  return v.toFixed(2);
}

export function formatMlPerHr(v: number): string {
  return v.toFixed(1);
}
