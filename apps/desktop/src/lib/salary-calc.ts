export interface SalaryCalcEmployee {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  employeeCode?: string | null;
  baseSalary?: number | string | null;
  joiningDate?: string | null;
  employeeShifts?: Array<{
    shift?: {
      startTime?: string | null;
      endTime?: string | null;
      name?: string | null;
    } | null;
  }> | null;
}

export interface SalaryCalcAttendance {
  id?: string;
  employeeId: string;
  attendanceDate: string;
  punchInAt?: string | null;
  punchOutAt?: string | null;
  workedMinutes?: number | null;
  punchPairs?: Array<{
    punchInAt?: string | null;
    punchOutAt?: string | null;
  }> | null;
}

export interface SalaryCalcHoliday {
  id?: string;
  name?: string;
  date: string;
}

export interface SalaryCalcSavedRecord {
  id?: string;
  employeeId: string;
  month: string;
  status: string;
  basicSalary?: number | string | null;
  commissionAmount?: number | string | null;
  advanceDeducted?: number | string | null;
  netSalary?: number | string | null;
  remarks?: string | null;
  excludeSundayHoliday?: boolean | null;
}

export interface SalaryCalculationInput {
  selectedYear: string;
  selectedMonth: string;
  employees: SalaryCalcEmployee[];
  attendances: SalaryCalcAttendance[];
  holidaysList: SalaryCalcHoliday[];
  savedSalaries?: SalaryCalcSavedRecord[];
  effectiveRates?: Record<string, number>;
  cardEdits?: Record<
    string,
    {
      commission?: number;
      advance?: number;
      remarks?: string;
      excludeSundayHoliday?: boolean;
      status?: 'PAID' | 'PENDING';
    }
  >;
}

export interface CalculatedSalaryCard {
  emp: SalaryCalcEmployee;
  monthlySalary: number;
  shiftHours: number;
  perDaySalary: number;
  hourRate: number;
  totalDaysInMonth: number;
  totalWorkingDays: number;
  sundaysCount: number;
  holidaysCount: number;
  presentRegularDays: number;
  totalHours: number;
  expectedHours: number;
  overtimeHours: number;
  overtimePayout: number;
  paidSundays: number;
  paidHolidays: number;
  totalPaidOffDays: number;
  sundayHolidayPay: number;
  basicSalary: number;
  lastPending: number;
  thisMonthNet: number;
  totalWithPending: number;
  commission: number;
  advance: number;
  remarks: string;
  excludeSundayHoliday: boolean;
  status: 'PAID' | 'PENDING';
  savedRecordId?: string;
}

export interface SalaryOverviewSummary {
  cards: CalculatedSalaryCard[];
  totalDueSum: number;
  paidSum: number;
  unpaidSum: number;
  paidCount: number;
  unpaidCount: number;
  totalEmployeesCount: number;
  percentagePaid: number;
}

export function computeSalaryOverview(input: SalaryCalculationInput): SalaryOverviewSummary {
  const {
    selectedYear,
    selectedMonth,
    employees,
    attendances,
    holidaysList,
    savedSalaries = [],
    effectiveRates = {},
    cardEdits = {},
  } = input;

  const totalDaysInMonth = new Date(parseInt(selectedYear, 10), parseInt(selectedMonth, 10), 0).getDate();
  const monthEnd = `${selectedYear}-${selectedMonth}-${String(totalDaysInMonth).padStart(2, '0')}`;
  const monthEndMs = new Date(monthEnd + 'T23:59:59Z').getTime();

  // Sundays in selected month
  const sundayDates: string[] = [];
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const dateObj = new Date(parseInt(selectedYear, 10), parseInt(selectedMonth, 10) - 1, d);
    if (dateObj.getDay() === 0) {
      sundayDates.push(`${selectedYear}-${selectedMonth}-${String(d).padStart(2, '0')}`);
    }
  }

  // Unique holidays (not falling on Sunday)
  const uniqueHolidays = holidaysList.filter((h) => {
    const dStr = h.date ? h.date.slice(0, 10) : '';
    return dStr && !sundayDates.includes(dStr) && dStr.startsWith(`${selectedYear}-${selectedMonth}`);
  });

  const sundaysCount = sundayDates.length;
  const holidaysCount = uniqueHolidays.length;
  const totalWorkingDays = totalDaysInMonth - sundaysCount - holidaysCount;

  // Group attendances by employee
  const empAttMap = new Map<string, SalaryCalcAttendance[]>();
  for (const att of attendances) {
    if (!empAttMap.has(att.employeeId)) {
      empAttMap.set(att.employeeId, []);
    }
    empAttMap.get(att.employeeId)!.push(att);
  }

  const getPaidCount = (presentDays: number, totalOff: number) => {
    if (presentDays >= 18) return totalOff;
    if (presentDays >= 12) return Math.min(2, totalOff);
    if (presentDays >= 5) return Math.min(1, totalOff);
    return 0;
  };

  const cards: CalculatedSalaryCard[] = employees
    .filter((emp) => {
      const hasSaved = savedSalaries.some((s) => s.employeeId === emp.id);
      if (hasSaved) return true;
      if (!emp.joiningDate) return true;
      const joiningMs = new Date(emp.joiningDate).getTime();
      return joiningMs <= monthEndMs;
    })
    .map((emp) => {
      const empLogs = empAttMap.get(emp.id) || [];
      const monthlySalary = effectiveRates[emp.id] ?? Number(emp.baseSalary || 0);

      // Shift hours
      let shiftHours = 10.5;
      const latestShift = emp.employeeShifts?.[0]?.shift;
      if (latestShift?.startTime && latestShift?.endTime) {
        const [sh, sm] = latestShift.startTime.split(':').map(Number);
        const [eh, em] = latestShift.endTime.split(':').map(Number);
        const shiftH = sh || 0;
        const shiftM = sm || 0;
        const endH = eh || 0;
        const endM = em || 0;
        let diffMinutes = endH * 60 + endM - (shiftH * 60 + shiftM);
        if (diffMinutes <= 0) diffMinutes += 24 * 60;
        shiftHours = diffMinutes / 60;
      }

      const perDaySalaryExact = totalDaysInMonth > 0 ? monthlySalary / totalDaysInMonth : 0;
      const hourRateExact = shiftHours > 0 ? perDaySalaryExact / shiftHours : 0;
      const perDaySalary = Number(perDaySalaryExact.toFixed(2));
      const hourRate = Number(hourRateExact.toFixed(2));

      // Day seconds map
      const daySecondsMap = new Map<string, number>();
      for (const log of empLogs) {
        const dStr = new Date(log.attendanceDate).toLocaleDateString('en-CA');
        let secs = 0;

        if (Array.isArray(log.punchPairs) && log.punchPairs.length > 0) {
          for (const pair of log.punchPairs) {
            if (pair?.punchInAt && pair?.punchOutAt) {
              const pairDiff = (new Date(pair.punchOutAt).getTime() - new Date(pair.punchInAt).getTime()) / 1000;
              if (pairDiff > 0) secs += pairDiff;
            }
          }
        } else if (log.punchInAt && log.punchOutAt) {
          const diff = (new Date(log.punchOutAt).getTime() - new Date(log.punchInAt).getTime()) / 1000;
          if (diff > 0) secs += diff;
        } else if (log.workedMinutes) {
          secs = log.workedMinutes * 60;
        }

        daySecondsMap.set(dStr, (daySecondsMap.get(dStr) || 0) + secs);
      }

      let totalWorkedSeconds = 0;
      let presentRegularDays = 0;

      for (let d = 1; d <= totalDaysInMonth; d++) {
        const dateStr = `${selectedYear}-${selectedMonth}-${String(d).padStart(2, '0')}`;
        const dateObj = new Date(parseInt(selectedYear, 10), parseInt(selectedMonth, 10) - 1, d);
        const isSun = dateObj.getDay() === 0;
        const isHol = holidaysList.some((h) => h.date && h.date.slice(0, 10) === dateStr);
        const secs = daySecondsMap.get(dateStr) || 0;

        if (!isSun && !isHol && secs > 0) {
          presentRegularDays++;
        }
        totalWorkedSeconds += secs;
      }

      const totalHoursExact = totalWorkedSeconds / 3600;
      const totalHours = Number(totalHoursExact.toFixed(1));
      const expectedHoursExact = presentRegularDays * shiftHours;
      const expectedHours = Number(expectedHoursExact.toFixed(1));

      const overtimeHoursExact = Math.max(0, totalHoursExact - expectedHoursExact);
      const overtimeHours = Number(overtimeHoursExact.toFixed(1));
      const overtimePayout = Number((overtimeHoursExact * hourRateExact).toFixed(2));

      const paidSundays = getPaidCount(presentRegularDays, sundaysCount);
      const paidHolidays = getPaidCount(presentRegularDays, holidaysCount);
      const totalPaidOffDays = paidSundays + paidHolidays;

      const savedRecord = savedSalaries.find((s) => s.employeeId === emp.id);

      const edit = cardEdits[emp.id] || {};
      const commission = edit.commission !== undefined ? edit.commission : (savedRecord ? Number(savedRecord.commissionAmount || 0) : 0);
      const advance = edit.advance !== undefined ? edit.advance : (savedRecord ? Number(savedRecord.advanceDeducted || 0) : 0);
      const remarks = edit.remarks !== undefined ? edit.remarks : (savedRecord?.remarks || '');
      const excludeSundayHoliday = edit.excludeSundayHoliday !== undefined ? edit.excludeSundayHoliday : Boolean(savedRecord?.excludeSundayHoliday);
      const status: 'PAID' | 'PENDING' = savedRecord?.status === 'PAID' ? 'PAID' : (edit.status || 'PENDING');

      const sundayHolidayPay = excludeSundayHoliday ? 0 : Number((totalPaidOffDays * perDaySalaryExact).toFixed(2));
      const basicSalary = Number((totalHoursExact * hourRateExact).toFixed(2));
      const thisMonthNet = Math.round(basicSalary + sundayHolidayPay + commission - advance);

      const lastPending = 0;
      const totalWithPending = thisMonthNet + lastPending;

      return {
        emp,
        monthlySalary,
        shiftHours,
        perDaySalary,
        hourRate,
        totalDaysInMonth,
        totalWorkingDays,
        sundaysCount,
        holidaysCount,
        presentRegularDays,
        totalHours,
        expectedHours,
        overtimeHours,
        overtimePayout,
        paidSundays,
        paidHolidays,
        totalPaidOffDays,
        sundayHolidayPay,
        basicSalary,
        lastPending,
        thisMonthNet,
        totalWithPending,
        commission,
        advance,
        remarks,
        excludeSundayHoliday,
        status,
        savedRecordId: savedRecord?.id,
      };
    });

  const paidItems = cards.filter((c) => c.status === 'PAID');
  const unpaidItems = cards.filter((c) => c.status !== 'PAID');

  const paidSum = paidItems.reduce((sum, c) => sum + c.thisMonthNet, 0);
  const unpaidSum = unpaidItems.reduce((sum, c) => sum + c.totalWithPending, 0);
  const totalDueSum = cards.reduce((sum, c) => sum + c.totalWithPending, 0);

  const paidCount = paidItems.length;
  const unpaidCount = unpaidItems.length;
  const totalEmployeesCount = cards.length;

  const percentagePaid =
    totalDueSum > 0
      ? Math.round((paidSum / totalDueSum) * 100)
      : totalEmployeesCount > 0
      ? Math.round((paidCount / totalEmployeesCount) * 100)
      : 0;

  return {
    cards,
    totalDueSum,
    paidSum,
    unpaidSum,
    paidCount,
    unpaidCount,
    totalEmployeesCount,
    percentagePaid,
  };
}
