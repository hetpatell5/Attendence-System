import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attendanceApi, holidaysApi, leaveApi } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

interface AttendanceCalendarCardProps {
  initialYear?: number;
  initialMonth?: number; // 1 - 12
  todayDate?: Date;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAY_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function AttendanceCalendarCard({
  initialYear,
  initialMonth,
  todayDate = new Date(),
}: AttendanceCalendarCardProps): JSX.Element {
  const [viewDate, setViewDate] = useState(() => {
    const y = initialYear ?? todayDate.getFullYear();
    const m = (initialMonth ? initialMonth - 1 : todayDate.getMonth());
    return new Date(y, m, 1);
  });

  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth() + 1; // 1-indexed
  const totalDaysInMonth = new Date(viewYear, viewMonth, 0).getDate();

  const monthStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;
  const fromDate = `${monthStr}-01`;
  const toDate = `${monthStr}-${String(totalDaysInMonth).padStart(2, '0')}`;

  const todayStr = useMemo(() => {
    return `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
  }, [todayDate]);

  // Fetch Attendance for the viewed month
  const { data: attendanceList = [] } = useQuery({
    queryKey: ['attendance', 'me', monthStr],
    queryFn: () => attendanceApi.mine(fromDate, toDate),
  });

  // Fetch Holidays for the viewed year
  const { data: holidaysList = [] } = useQuery<any[]>({
    queryKey: ['holidays', viewYear],
    queryFn: () => holidaysApi.list({ year: String(viewYear) }) as Promise<any[]>,
  });

  // Fetch User's Leaves
  const { data: userLeaves = [] } = useQuery({
    queryKey: ['leave', 'me'],
    queryFn: leaveApi.mine,
  });

  // Map attendance by YYYY-MM-DD
  const attendanceMap = useMemo(() => {
    const map = new Map<string, any>();
    attendanceList.forEach((att: any) => {
      if (!att.attendanceDate) return;
      const key = new Date(att.attendanceDate).toLocaleDateString('en-CA');
      map.set(key, att);
    });
    return map;
  }, [attendanceList]);

  // Map approved leaves by date strings
  const approvedLeaveDates = useMemo(() => {
    const set = new Set<string>();
    userLeaves.forEach((req: any) => {
      if (req.status !== 'APPROVED' || !req.startDate) return;
      const start = new Date(req.startDate);
      const end = req.endDate ? new Date(req.endDate) : start;
      for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
        set.add(cur.toLocaleDateString('en-CA'));
      }
    });
    return set;
  }, [userLeaves]);

  // Map holidays by YYYY-MM-DD
  const holidayMap = useMemo(() => {
    const map = new Map<string, string>();
    holidaysList.forEach((h: any) => {
      if (!h.date) return;
      const key = h.date.slice(0, 10);
      map.set(key, h.name || 'Public Holiday');
    });
    return map;
  }, [holidaysList]);

  // Navigation handlers
  const handlePrevMonth = () => {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  // Month starting day offset (Monday as first day of week: Mon=0, Sun=6)
  const startDayOffset = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay();
    return (firstDay + 6) % 7;
  }, [viewYear, viewMonth]);

  // Compute status counts for the legend summary
  const summaryCounts = useMemo(() => {
    let present = 0;
    let absent = 0;
    let leave = 0;
    let holiday = 0;

    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dObj = new Date(viewYear, viewMonth - 1, day);
      const isSunday = dObj.getDay() === 0;
      const isHoliday = holidayMap.has(dateStr);
      const att = attendanceMap.get(dateStr);
      const isLeave = approvedLeaveDates.has(dateStr) || att?.status === 'LEAVE';
      const isPresent = att && (att.status === 'PRESENT' || att.status === 'HALF_DAY' || att.punchInAt || (att.workedMinutes && att.workedMinutes > 0));
      const isPastOrToday = dateStr <= todayStr;

      if (isHoliday) {
        holiday++;
      } else if (isLeave) {
        leave++;
      } else if (isPresent) {
        present++;
      } else if (!isSunday && isPastOrToday && !isPresent) {
        absent++;
      }
    }

    return { present, absent, leave, holiday };
  }, [viewYear, viewMonth, totalDaysInMonth, holidayMap, attendanceMap, approvedLeaveDates, todayStr]);

  return (
    <Card className="rounded-2xl border border-border/70 shadow-sm bg-card p-5 flex flex-col justify-between">
      {/* Calendar Header */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/50 dark:border-indigo-800/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <CalendarIcon size={18} />
            </div>
            <h3 className="font-bold text-base sm:text-lg text-foreground tracking-tight">
              {MONTH_NAMES[viewMonth - 1]} {viewYear}
            </h3>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Previous Month"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Next Month"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Weekday Headers: M T W T F S S */}
        <div className="grid grid-cols-7 gap-1.5 text-center mb-2">
          {WEEKDAY_HEADERS.map((dayName, idx) => (
            <div
              key={idx}
              className="text-xs font-semibold text-muted-foreground/80 py-1"
            >
              {dayName}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {/* Empty offset days */}
          {Array.from({ length: startDayOffset }).map((_, idx) => (
            <div key={`offset-${idx}`} className="aspect-square" />
          ))}

          {/* Actual days of month */}
          {Array.from({ length: totalDaysInMonth }).map((_, idx) => {
            const day = idx + 1;
            const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dObj = new Date(viewYear, viewMonth - 1, day);
            const isSunday = dObj.getDay() === 0;
            const holidayName = holidayMap.get(dateStr);
            const isHoliday = Boolean(holidayName);
            const att = attendanceMap.get(dateStr);
            const isLeave = approvedLeaveDates.has(dateStr) || att?.status === 'LEAVE';
            const isPresent = att && (
              att.status === 'PRESENT' ||
              att.status === 'HALF_DAY' ||
              Boolean(att.punchInAt) ||
              Boolean(att.workedMinutes && att.workedMinutes > 0)
            );
            const isToday = dateStr === todayStr;
            const isPast = dateStr < todayStr;
            const isAbsent = !isSunday && !isHoliday && !isLeave && !isPresent && isPast;

            // Determine styling based on user rules:
            // 1. Holiday -> Orange
            // 2. Absent -> Red
            // 3. Present -> Green
            // 4. Sundays -> Gray
            // 5. Today (if not present) -> Distinct highlighted capsule (Indigo/Purple as in Image 1)
            let cellStyle = 'text-foreground/85 hover:bg-muted/60';
            let tooltipText = `${dateStr}`;

            if (isToday) {
              if (isPresent) {
                cellStyle = 'bg-emerald-400 text-slate-900 font-bold shadow-sm ring-2 ring-emerald-500/50';
                tooltipText = `Today: Present`;
              } else {
                cellStyle = 'bg-indigo-600 text-white font-bold ring-2 ring-indigo-400/40 shadow-sm';
                tooltipText = `Today: In Progress`;
              }
            } else if (isHoliday) {
              // Holiday in orange
              cellStyle = 'bg-orange-500 hover:bg-orange-600 text-white font-semibold shadow-sm';
              tooltipText = `Holiday: ${holidayName}`;
            } else if (isPresent) {
              // Present in green (mint green as in Image 1)
              cellStyle = 'bg-emerald-400 hover:bg-emerald-500 text-slate-900 font-semibold shadow-sm';
              const duration = att?.workedMinutes ? ` (${Math.floor(att.workedMinutes / 60)}h ${att.workedMinutes % 60}m)` : '';
              tooltipText = `Present${duration}`;
            } else if (isAbsent) {
              // Absent in red
              cellStyle = 'bg-rose-500 hover:bg-rose-600 text-white font-semibold shadow-sm';
              tooltipText = `Absent`;
            } else if (isLeave) {
              // Leave
              cellStyle = 'bg-blue-500 hover:bg-blue-600 text-white font-semibold shadow-sm';
              tooltipText = `Approved Leave`;
            } else if (isSunday) {
              // Sundays in gray (as in Image 1)
              cellStyle = 'bg-slate-100 dark:bg-zinc-800/80 text-slate-400 dark:text-zinc-500 font-medium';
              tooltipText = `Sunday (Weekly Off)`;
            }

            return (
              <div
                key={dateStr}
                title={tooltipText}
                className={`aspect-square flex items-center justify-center rounded-xl text-xs sm:text-sm transition-all select-none cursor-default ${cellStyle}`}
              >
                {day}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend & Summary Badges (Always in a single neat row) */}
      <div className="grid grid-cols-4 gap-1.5 pt-4 mt-3 border-t border-border/40 text-[11px]">
        {/* Present Badge */}
        <div className="inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 font-medium border border-emerald-300/40 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span>{summaryCounts.present} Present</span>
        </div>

        {/* Absent Badge */}
        <div className="inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-medium border border-border/50 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
          <span>{summaryCounts.absent} Absent</span>
        </div>

        {/* Leave Badge */}
        <div className="inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium border border-blue-200/40 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
          <span>{summaryCounts.leave} Leave</span>
        </div>

        {/* Holiday Badge */}
        <div className="inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-full bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 font-medium border border-orange-200/40 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
          <span>{summaryCounts.holiday} Holiday</span>
        </div>
      </div>
    </Card>
  );
}
