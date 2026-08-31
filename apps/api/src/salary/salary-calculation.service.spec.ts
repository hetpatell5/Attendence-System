import { Prisma } from '@prisma/client';
import { SalaryCalculationService } from './salary-calculation.service';

describe('SalaryCalculationService', () => {
  const service = new SalaryCalculationService();

  it('computes net salary as basic + allowances + overtime + bonus - deductions', () => {
    const result = service.calculate({
      basicSalary: new Prisma.Decimal(30000),
      totalAllowances: new Prisma.Decimal(2000),
      totalDeductions: new Prisma.Decimal(500),
      bonusAmount: new Prisma.Decimal(1000),
      workingDays: 30,
      absentDays: new Prisma.Decimal(0),
      overtimeMinutes: 0,
      shiftWorkingHours: new Prisma.Decimal(8),
    });

    expect(result.netSalary.toNumber()).toBeCloseTo(32500, 2);
  });

  it('deducts a proportional amount for absent days', () => {
    const result = service.calculate({
      basicSalary: new Prisma.Decimal(30000),
      totalAllowances: new Prisma.Decimal(0),
      totalDeductions: new Prisma.Decimal(0),
      bonusAmount: new Prisma.Decimal(0),
      workingDays: 30,
      absentDays: new Prisma.Decimal(3),
      overtimeMinutes: 0,
      shiftWorkingHours: new Prisma.Decimal(8),
    });

    // per-day rate = 1000, 3 absent days = 3000 deduction
    expect(result.absenceDeduction.toNumber()).toBeCloseTo(3000, 2);
    expect(result.netSalary.toNumber()).toBeCloseTo(27000, 2);
  });

  it('computes overtime pay at 1.5x the hourly rate', () => {
    const result = service.calculate({
      basicSalary: new Prisma.Decimal(24000),
      totalAllowances: new Prisma.Decimal(0),
      totalDeductions: new Prisma.Decimal(0),
      bonusAmount: new Prisma.Decimal(0),
      workingDays: 30,
      absentDays: new Prisma.Decimal(0),
      overtimeMinutes: 120,
      shiftWorkingHours: new Prisma.Decimal(8),
    });

    // per-day = 800, per-hour = 100, 2 hours OT * 1.5 = 300
    expect(result.overtimeAmount.toNumber()).toBeCloseTo(300, 2);
  });

  it('does not divide by zero when workingDays is 0', () => {
    const result = service.calculate({
      basicSalary: new Prisma.Decimal(30000),
      totalAllowances: new Prisma.Decimal(0),
      totalDeductions: new Prisma.Decimal(0),
      bonusAmount: new Prisma.Decimal(0),
      workingDays: 0,
      absentDays: new Prisma.Decimal(0),
      overtimeMinutes: 60,
      shiftWorkingHours: new Prisma.Decimal(8),
    });

    expect(result.netSalary.toNumber()).toBe(30000);
    expect(result.overtimeAmount.toNumber()).toBe(0);
  });

  it('rounds monetary results to 2 decimal places', () => {
    const result = service.calculate({
      basicSalary: new Prisma.Decimal(10000),
      totalAllowances: new Prisma.Decimal(0),
      totalDeductions: new Prisma.Decimal(0),
      bonusAmount: new Prisma.Decimal(0),
      workingDays: 3,
      absentDays: new Prisma.Decimal(1),
      overtimeMinutes: 0,
      shiftWorkingHours: new Prisma.Decimal(8),
    });

    expect(result.absenceDeduction.decimalPlaces()).toBeLessThanOrEqual(2);
    expect(result.netSalary.decimalPlaces()).toBeLessThanOrEqual(2);
  });

  describe('calculateHourly', () => {
    it('computes net as workedHours*hourRate + commission + bonus + allowances - deductions - advance', () => {
      const result = service.calculateHourly({
        workedHours: new Prisma.Decimal(200),
        hourRate: new Prisma.Decimal(30),
        commissionAmount: new Prisma.Decimal(500),
        bonusAmount: new Prisma.Decimal(0),
        totalAllowances: new Prisma.Decimal(0),
        totalDeductions: new Prisma.Decimal(0),
        advanceDeducted: new Prisma.Decimal(1000),
      });

      // 200*30 + 500 - 1000 = 5500
      expect(result.netSalary.toNumber()).toBeCloseTo(5500, 2);
    });

    it('computes net from commission alone when worked hours are zero', () => {
      const result = service.calculateHourly({
        workedHours: new Prisma.Decimal(0),
        hourRate: new Prisma.Decimal(30),
        commissionAmount: new Prisma.Decimal(2374),
        bonusAmount: new Prisma.Decimal(0),
        totalAllowances: new Prisma.Decimal(0),
        totalDeductions: new Prisma.Decimal(0),
        advanceDeducted: new Prisma.Decimal(0),
      });

      expect(result.netSalary.toNumber()).toBeCloseTo(2374, 2);
    });

    it('permits a negative net salary when the advance exceeds the gross', () => {
      const result = service.calculateHourly({
        workedHours: new Prisma.Decimal(10),
        hourRate: new Prisma.Decimal(20),
        commissionAmount: new Prisma.Decimal(0),
        bonusAmount: new Prisma.Decimal(0),
        totalAllowances: new Prisma.Decimal(0),
        totalDeductions: new Prisma.Decimal(0),
        advanceDeducted: new Prisma.Decimal(500),
      });

      // 10*20 - 500 = -300, must not be clamped to zero
      expect(result.netSalary.toNumber()).toBeCloseTo(-300, 2);
    });

    it('rounds to 2 decimal places', () => {
      const result = service.calculateHourly({
        workedHours: new Prisma.Decimal(33.333),
        hourRate: new Prisma.Decimal(27.777),
        commissionAmount: new Prisma.Decimal(0),
        bonusAmount: new Prisma.Decimal(0),
        totalAllowances: new Prisma.Decimal(0),
        totalDeductions: new Prisma.Decimal(0),
        advanceDeducted: new Prisma.Decimal(0),
      });

      expect(result.netSalary.decimalPlaces()).toBeLessThanOrEqual(2);
    });
  });
});
