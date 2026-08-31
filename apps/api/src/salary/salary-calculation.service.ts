import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Overtime pay multiplier applied to the effective hourly rate. */
const OVERTIME_MULTIPLIER = 1.5;

export interface SalaryInputs {
  basicSalary: Prisma.Decimal;
  totalAllowances: Prisma.Decimal;
  totalDeductions: Prisma.Decimal;
  bonusAmount: Prisma.Decimal;
  workingDays: number;
  absentDays: Prisma.Decimal;
  overtimeMinutes: number;
  shiftWorkingHours: Prisma.Decimal;
}

export interface CalculatedSalary {
  overtimeAmount: Prisma.Decimal;
  absenceDeduction: Prisma.Decimal;
  netSalary: Prisma.Decimal;
}

export interface HourlySalaryInputs {
  workedHours: Prisma.Decimal;
  hourRate: Prisma.Decimal;
  commissionAmount: Prisma.Decimal;
  bonusAmount: Prisma.Decimal;
  totalAllowances: Prisma.Decimal;
  totalDeductions: Prisma.Decimal;
  advanceDeducted: Prisma.Decimal;
}

export interface CalculatedHourlySalary {
  netSalary: Prisma.Decimal;
}

/**
 * Pure salary math — no Prisma database dependency beyond the Decimal type,
 * so it can be unit tested directly and reused wherever a projected salary
 * figure is needed without a live database round trip.
 */
@Injectable()
export class SalaryCalculationService {
  calculate(input: SalaryInputs): CalculatedSalary {
    const zero = new Prisma.Decimal(0);

    if (input.workingDays <= 0) {
      return { overtimeAmount: zero, absenceDeduction: zero, netSalary: input.basicSalary };
    }

    const perDayRate = input.basicSalary.dividedBy(input.workingDays);
    const shiftHours = input.shiftWorkingHours.isZero()
      ? new Prisma.Decimal(8)
      : input.shiftWorkingHours;
    const perHourRate = perDayRate.dividedBy(shiftHours);

    const overtimeHours = new Prisma.Decimal(input.overtimeMinutes).dividedBy(60);
    const overtimeAmount = perHourRate
      .times(overtimeHours)
      .times(OVERTIME_MULTIPLIER)
      .toDecimalPlaces(2);

    const absenceDeduction = perDayRate.times(input.absentDays).toDecimalPlaces(2);

    const netSalary = input.basicSalary
      .plus(input.totalAllowances)
      .plus(overtimeAmount)
      .plus(input.bonusAmount)
      .minus(input.totalDeductions)
      .minus(absenceDeduction)
      .toDecimalPlaces(2);

    return { overtimeAmount, absenceDeduction, netSalary };
  }

  /**
   * HOURLY pay mode: net = workedHours*hourRate + commission + bonus +
   * allowances - deductions - advanceDeducted. Overtime is deliberately not a
   * separate line item here — extra hours are already priced into
   * workedHours, so a distinct overtime multiplier would double-count them.
   * A negative result is valid (an employee can be advanced more than they
   * earned in a given month) and must not be clamped to zero.
   */
  calculateHourly(input: HourlySalaryInputs): CalculatedHourlySalary {
    const netSalary = input.workedHours
      .times(input.hourRate)
      .plus(input.commissionAmount)
      .plus(input.bonusAmount)
      .plus(input.totalAllowances)
      .minus(input.totalDeductions)
      .minus(input.advanceDeducted)
      .toDecimalPlaces(2);

    return { netSalary };
  }
}
