import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { renderHtmlToPdf } from '../../common/html-to-pdf.util';
import {
  buildPerformanceReportHtml,
  type AbsentRow,
  type HolidaySundayRow,
  type PerformanceReportData,
  type PresentRow,
} from './attendance-report.pdf-template';
import { eachDateInRange, parseHhMm, startOfCompanyDay } from '../../common/time.util';

function pad2(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(2, '0');
}

function formatHms(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function fmtDmy(day: Date): string {
  return `${pad2(day.getUTCDate())}-${pad2(day.getUTCMonth() + 1)}-${day.getUTCFullYear()}`;
}

function fmtTime12h(d: Date, timeZone: string): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone });
}

/** Minutes since local midnight, in the given IANA timezone, for a real UTC instant. */
function localMinutesOfDay(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

interface PunchPair {
  punchInAt: string;
  punchOutAt: string | null;
}

@Injectable()
export class AttendanceReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 1:1 behavioral port of AttenOld/admin/perf_range.php's PDF export (the "Employee
   * Performance Report" downloaded from the Performance page's Last 30 Days / Last 3
   * Months / Custom Date buttons). Presence is "does this day have any punch at all",
   * lateness compares first-punch wall-clock time against the shift start with a
   * 60-second grace, and overtime is worked-hours exceeding the shift span by 6+
   * minutes — all matching the old PHP exactly, not the app's own attendance-status
   * or lateness fields.
   */
  async generate(
    employeeId: string,
    fromIso: string,
    toIso: string,
    rangeLabel: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const from = startOfCompanyDay(new Date(fromIso));
    const to = startOfCompanyDay(new Date(toIso));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
      throw new BadRequestException('Invalid date range.');
    }

    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { employeeShifts: { orderBy: { effectiveFrom: 'desc' }, take: 1, include: { shift: true } } },
    });
    const shift = employee.employeeShifts[0]?.shift ?? null;

    const settings = await this.prisma.companySettings.findFirst();
    const timeZone = settings?.timezone || 'Asia/Kolkata';
    const logoSrc = settings?.companyLogo?.startsWith('data:image') ? settings.companyLogo : '';

    const attendances = await this.prisma.attendance.findMany({
      where: { employeeId, attendanceDate: { gte: from, lte: to } },
    });
    const attByDate = new Map(attendances.map((a) => [a.attendanceDate.toISOString().slice(0, 10), a]));

    const holidays = await this.prisma.holiday.findMany({ where: { date: { gte: from, lte: to } } });
    const holidayByDate = new Map(holidays.map((h) => [h.date.toISOString().slice(0, 10), h]));

    const leaveRequests = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: { not: 'CANCELLED' },
        startDate: { lte: to },
        endDate: { gte: from },
      },
    });
    const leaveForDate = (day: Date) =>
      leaveRequests.find((lr) => lr.startDate.getTime() <= day.getTime() && lr.endDate.getTime() >= day.getTime());

    const days = eachDateInRange(from, to);

    let totalDays = 0;
    let sundays = 0;
    let holCount = 0;
    let workDays = 0;
    let presents = 0;
    const presentRows: PresentRow[] = [];
    const absentRows: AbsentRow[] = [];
    const holidaySundayRows: HolidaySundayRow[] = [];
    let presentId = 1;
    let absentId = 1;
    let holId = 1;

    for (const day of days) {
      const key = day.toISOString().slice(0, 10);
      const isSunday = day.getUTCDay() === 0;
      const holiday = holidayByDate.get(key);
      const isHoliday = Boolean(holiday);
      totalDays++;
      if (isSunday) sundays++;
      if (isHoliday) holCount++;
      const isWorking = !isSunday && !isHoliday;
      if (isWorking) workDays++;

      const rec = attByDate.get(key);
      const pairs: PunchPair[] =
        Array.isArray(rec?.punchPairs) && (rec!.punchPairs as unknown[]).length > 0
          ? (rec!.punchPairs as unknown as PunchPair[])
          : rec?.punchInAt
          ? [{ punchInAt: rec.punchInAt.toISOString(), punchOutAt: rec.punchOutAt?.toISOString() ?? null }]
          : [];

      let firstIn: Date | null = null;
      let lastOut: Date | null = null;
      for (const p of pairs) {
        const inAt = new Date(p.punchInAt);
        if (!firstIn || inAt.getTime() < firstIn.getTime()) firstIn = inAt;
        if (p.punchOutAt) {
          const outAt = new Date(p.punchOutAt);
          if (!lastOut || outAt.getTime() > lastOut.getTime()) lastOut = outAt;
        }
      }
      const hasPunch = firstIn !== null;
      if (hasPunch) presents++;

      if (hasPunch) {
        let isLate = false;
        let status = 'On Time';
        if (shift?.startTime) {
          const { hours: sh, minutes: sm } = parseHhMm(shift.startTime);
          const shiftStartMin = sh * 60 + sm;
          const entryMin = localMinutesOfDay(firstIn!, timeZone);
          const diffMin = entryMin - shiftStartMin;
          // Old system's grace is >60 seconds; minute-resolution timestamps here make
          // ">= 1 full minute late" the closest equivalent.
          if (diffMin >= 1) {
            isLate = true;
            status = `Late (${diffMin}m)`;
          }
        }

        const workedSeconds = lastOut && lastOut.getTime() > firstIn!.getTime() ? Math.round((lastOut.getTime() - firstIn!.getTime()) / 1000) : 0;
        if (shift?.startTime && shift?.endTime) {
          const { hours: sh, minutes: sm } = parseHhMm(shift.startTime);
          const { hours: eh, minutes: em } = parseHhMm(shift.endTime);
          let shiftMinutes = eh * 60 + em - (sh * 60 + sm);
          if (shiftMinutes <= 0) shiftMinutes += 24 * 60;
          const shiftHrs = shiftMinutes / 60;
          const totalHrs = workedSeconds / 3600;
          if (totalHrs > shiftHrs + 0.1) status += ', OT';
        }

        presentRows.push({
          id: presentId++,
          date: fmtDmy(day),
          day: day.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
          entryTime: fmtTime12h(firstIn!, timeZone),
          exitTime: lastOut ? fmtTime12h(lastOut, timeZone) : '-',
          hours: formatHms(workedSeconds),
          status,
          isLate,
        });
      } else if (isSunday || isHoliday) {
        holidaySundayRows.push({
          id: holId++,
          date: fmtDmy(day),
          day: day.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
          description: isSunday ? 'Sunday' : holiday!.name || 'Holiday',
        });
      } else {
        const leave = leaveForDate(day);
        absentRows.push({
          id: absentId++,
          date: fmtDmy(day),
          day: day.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
          reason: leave ? `${leave.reason} (${leave.status})` : 'Uninformed Absence',
        });
      }
    }

    const absents = Math.max(0, workDays - presents);

    const shiftText = shift ? `${shift.name} (${shift.startTime} - ${shift.endTime})` : 'N/A';

    const data: PerformanceReportData = {
      logoSrc,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      shiftText,
      rangeLabel,
      fromLabel: fmtDmy(from),
      toLabel: fmtDmy(to),
      totalDays,
      sundays,
      holidays: holCount,
      working: workDays,
      presents,
      absents,
      presentRows,
      absentRows,
      holidaySundayRows,
      generatedOnLabel: (() => {
        const now = new Date();
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const local = new Date(now.toLocaleString('en-US', { timeZone }));
        return `${pad2(local.getDate())} ${monthNames[local.getMonth()]} ${local.getFullYear()} ${pad2(local.getHours())}:${pad2(local.getMinutes())}`;
      })(),
    };

    const html = buildPerformanceReportHtml(data);
    const buffer = await renderHtmlToPdf(html, { margin: { top: '0', bottom: '0', left: '0', right: '0' } });

    const safeName = `${employee.firstName}_${employee.lastName}`.replace(/[^A-Za-z0-9_-]/g, '_');
    const safeLabel = rangeLabel.replace(/[^A-Za-z0-9_-]/g, '_');
    return { buffer, fileName: `Employee_Performance_${safeName}_${safeLabel}.pdf` };
  }
}
