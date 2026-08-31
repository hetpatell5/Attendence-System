import {
  splitName,
  parseDurationToMinutes,
  repairCorruptedYear,
  monthYearToDate,
  dateOnlyToUtcMidnight,
  inclusiveDayCount,
  toShiftTime,
  deriveShiftHours,
} from './transforms';

describe('splitName', () => {
  it('gives a single-token name a placeholder surname', () => {
    expect(splitName('RUSHIT')).toEqual({ firstName: 'RUSHIT', lastName: '-' });
  });

  it('splits a two-token name normally', () => {
    expect(splitName('Dhara Thummar')).toEqual({ firstName: 'Dhara', lastName: 'Thummar' });
  });

  it('joins remaining tokens for a three-token name', () => {
    expect(splitName('Jane Van Der Berg')).toEqual({
      firstName: 'Jane',
      lastName: 'Van Der Berg',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(splitName('  ASHISH  ')).toEqual({ firstName: 'ASHISH', lastName: '-' });
  });
});

describe('parseDurationToMinutes', () => {
  it('parses a normal HH:MM:SS duration', () => {
    expect(parseDurationToMinutes('00:14:00')).toBe(14);
  });

  it('parses a duration exceeding 24 hours', () => {
    expect(parseDurationToMinutes('256:30:00')).toBe(256 * 60 + 30);
  });

  it('returns 0 for null', () => {
    expect(parseDurationToMinutes(null)).toBe(0);
  });

  it('returns 0 for an unparseable string', () => {
    expect(parseDurationToMinutes('garbage')).toBe(0);
  });
});

describe('repairCorruptedYear', () => {
  it('repairs the known 0026 -> 2026 pattern', () => {
    const result = repairCorruptedYear('0026-01-16');
    expect(result.date).toBe('2026-01-16');
    expect(result.wasRepaired).toBe(true);
  });

  it('leaves a normal date untouched', () => {
    const result = repairCorruptedYear('2026-01-16');
    expect(result.date).toBe('2026-01-16');
    expect(result.wasRepaired).toBe(false);
  });
});

describe('monthYearToDate', () => {
  it("converts 'YYYY-MM' to the 1st of that month in UTC", () => {
    const date = monthYearToDate('2025-06');
    expect(date.toISOString()).toBe('2025-06-01T00:00:00.000Z');
  });

  it('throws on an invalid format', () => {
    expect(() => monthYearToDate('2025/06')).toThrow();
  });
});

describe('dateOnlyToUtcMidnight', () => {
  it('parses a date string to UTC midnight without local-timezone drift', () => {
    const date = dateOnlyToUtcMidnight('2026-03-10');
    expect(date.toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });
});

describe('inclusiveDayCount', () => {
  it('counts a single day as 1', () => {
    expect(inclusiveDayCount('2026-03-10', '2026-03-10')).toBe(1);
  });

  it('counts a multi-day range inclusively', () => {
    expect(inclusiveDayCount('2026-03-10', '2026-03-13')).toBe(4);
  });
});

describe('toShiftTime', () => {
  it('extracts HH:mm from a HH:MM:SS value', () => {
    expect(toShiftTime('09:30:00', '00:00')).toBe('09:30');
  });

  it('falls back when the value is null', () => {
    expect(toShiftTime(null, '09:00')).toBe('09:00');
  });
});

describe('deriveShiftHours', () => {
  it('derives working hours as span minus a 60-minute break for a full-day shift', () => {
    const result = deriveShiftHours('09:00', '19:00');
    expect(result.breakDurationMinutes).toBe(60);
    expect(result.workingHours).toBeCloseTo(9, 5);
  });

  it('handles the short ACCOUNTING shift by dropping the break entirely', () => {
    const result = deriveShiftHours('08:30', '10:30');
    expect(result.breakDurationMinutes).toBe(0);
    expect(result.workingHours).toBeCloseTo(2, 5);
  });

  it('handles a shift crossing midnight', () => {
    const result = deriveShiftHours('22:00', '06:00');
    expect(result.workingHours).toBeCloseTo(7, 5); // 8h span - 60min break
  });
});
