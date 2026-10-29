import { describe, expect, it } from 'vitest';
import { calculate, validate, formatMlPerMin, formatMlPerHr, type DiffusionInput } from './diffusion';
import { convertPressure, dpUnitFor, toKPa } from './units';

const base: DiffusionInput = {
  volumeMl: 500,
  testPressure: 2.5,
  testPressureUnit: 'bar',
  stabilizationMin: 5,
  measureMin: 5,
  dp: 0.05,
  dpUnit: 'bar',
  patm: 1.01325,
  patmUnit: 'bar',
  tempCorrection: false,
  testTempC: 20,
  refTempC: 20,
};

describe('단위 환산', () => {
  it('bar, psi, kPa 를 kPa 로 바꾼다', () => {
    expect(toKPa(1, 'bar')).toBe(100);
    expect(toKPa(1, 'psi')).toBeCloseTo(6.894757, 6);
    expect(toKPa(3, 'kPa')).toBe(3);
  });

  it('대기압 1.01325 bar 는 14.696 psi', () => {
    expect(convertPressure(1.01325, 'bar', 'psi')).toBeCloseTo(14.696, 3);
  });

  it('왕복 환산해도 값이 같다', () => {
    expect(convertPressure(convertPressure(2.5, 'bar', 'psi'), 'psi', 'bar')).toBeCloseTo(2.5, 12);
  });

  it('1 mbar 는 0.1 kPa, 1000 mbar 는 1 bar', () => {
    expect(toKPa(1, 'mbar')).toBe(0.1);
    expect(convertPressure(1000, 'mbar', 'bar')).toBeCloseTo(1, 12);
  });

  it('ΔP 는 bar 대신 mbar 를 쓴다', () => {
    expect(dpUnitFor('bar')).toBe('mbar');
    expect(dpUnitFor('psi')).toBe('psi');
  });
});

describe('제시안 샘플 계산', () => {
  it('샘플 1: bar, 보정 OFF', () => {
    const r = calculate(base)!;
    expect(r.mlPerMin).toBeCloseTo(4.934616, 6);
    expect(r.mlPerHr).toBeCloseTo(296.0770, 4);
    expect(formatMlPerMin(r.mlPerMin)).toBe('4.93');
    expect(formatMlPerHr(r.mlPerHr)).toBe('296.1');
  });

  it('샘플 1 을 ΔP 50 mbar 로 넣어도 결과가 같다', () => {
    const r = calculate({ ...base, dp: 50, dpUnit: 'mbar' })!;
    expect(r.mlPerMin).toBeCloseTo(4.934616, 6);
  });

  it('샘플 2: ΔP psi + 대기압 kPa (단위 섞임)', () => {
    const r = calculate({ ...base, volumeMl: 1200, dp: 0.5, dpUnit: 'psi', measureMin: 3, patm: 101.325, patmUnit: 'kPa' })!;
    expect(r.dpKPa).toBeCloseTo(3.447379, 6);
    expect(r.mlPerMin).toBeCloseTo(13.609191, 5);
    expect(formatMlPerMin(r.mlPerMin)).toBe('13.61');
    expect(formatMlPerHr(r.mlPerHr)).toBe('816.6');
  });

  it('샘플 3: kPa, 온도 보정 ON (25 °C → 20 °C)', () => {
    const r = calculate({
      ...base,
      volumeMl: 800,
      dp: 4,
      dpUnit: 'kPa',
      measureMin: 10,
      patm: 101.325,
      patmUnit: 'kPa',
      tempCorrection: true,
      testTempC: 25,
      refTempC: 20,
    })!;
    expect(r.tempFactor).toBeCloseTo(0.983230, 6);
    expect(r.mlPerMin).toBeCloseTo(3.105192, 5);
    expect(formatMlPerMin(r.mlPerMin)).toBe('3.11');
    expect(formatMlPerHr(r.mlPerHr)).toBe('186.3');
  });
});

describe('계산 규칙', () => {
  it('보정 OFF 이면 온도 값과 상관없이 계수 1', () => {
    expect(calculate({ ...base, testTempC: 35 })!.tempFactor).toBe(1);
  });

  it('보정 ON 이고 시험·기준 온도가 같으면 계수 1', () => {
    expect(calculate({ ...base, tempCorrection: true })!.tempFactor).toBe(1);
  });

  it('안정화 시간·시험 압력은 결과에 영향이 없다', () => {
    const a = calculate(base)!.mlPerMin;
    const b = calculate({ ...base, stabilizationMin: 30, testPressure: 4 })!.mlPerMin;
    expect(b).toBe(a);
  });

  it('ΔP = 0 이면 0', () => {
    expect(calculate({ ...base, dp: 0 })!.mlPerMin).toBe(0);
  });

  it('같은 압력을 다른 단위로 넣어도 결과가 같다', () => {
    const inBar = calculate(base)!.mlPerMin;
    const inPsi = calculate({
      ...base,
      dp: convertPressure(0.05, 'bar', 'psi'),
      dpUnit: 'psi',
      patm: convertPressure(1.01325, 'bar', 'psi'),
      patmUnit: 'psi',
    })!.mlPerMin;
    expect(inPsi).toBeCloseTo(inBar, 10);
  });
});

describe('입력 검사', () => {
  it('정상 입력은 오류·경고 없음', () => {
    expect(validate(base)).toEqual({ errors: [], warnings: [] });
  });

  it.each([
    ['volumeMl', 0],
    ['measureMin', 0],
    ['patm', -1],
    ['dp', -0.01],
  ] as const)('%s = %s 이면 계산하지 않는다', (field, value) => {
    const input = { ...base, [field]: value };
    expect(validate(input).errors.map((e) => e.field)).toContain(field);
    expect(calculate(input)).toBeNull();
  });

  it('빈 칸(NaN)은 오류', () => {
    expect(calculate({ ...base, volumeMl: NaN })).toBeNull();
  });

  it('보정 OFF 이면 온도 칸이 비어도 계산한다', () => {
    expect(calculate({ ...base, testTempC: NaN })).not.toBeNull();
  });

  it('보정 ON 이고 절대영도 이하면 오류', () => {
    expect(calculate({ ...base, tempCorrection: true, testTempC: -273.15 })).toBeNull();
  });

  it('ΔP ≥ 시험 압력이면 경고만 내고 계산은 한다 (단위 환산 후 비교)', () => {
    const input = { ...base, dp: 40, dpUnit: 'psi' as const, testPressure: 2.5, testPressureUnit: 'bar' as const };
    const v = validate(input);
    expect(v.errors).toEqual([]);
    expect(v.warnings.map((w) => w.field)).toEqual(['dp']);
    expect(calculate(input)).not.toBeNull();
  });

  it('ΔP < 시험 압력이면 경고 없음', () => {
    expect(validate({ ...base, dp: 30, dpUnit: 'psi' }).warnings).toEqual([]);
  });
});
