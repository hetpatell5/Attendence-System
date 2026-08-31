import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attendanceApi, employeesApi, holidaysApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import type { Attendance } from '@attendance/shared';
import { 
  Calendar as CalendarIcon, Clock, ArrowRight, CheckCircle2, 
  XCircle, Clock4, CalendarDays, IndianRupee 
} from 'lucide-react';
import { cn } from '@/lib/utils';

function monthRange(month: string): { from: string; to: string; year: number; mon: number; totalDays: number } {
  const parts = month.split('-').map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const mon = parts[1] ?? new Date().getMonth() + 1;
  const totalDays = new Date(year, mon, 0).getDate();
  const from = `${month}-01`;
  const to = `${month}-${String(totalDays).padStart(2, '0')}`;
  return { from, to, year, mon, totalDays };
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function MyAttendancePage(): JSX.Element {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { from, to, year, mon, totalDays } = monthRange(month);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['attendance', 'me', month],
    queryFn: () => attendanceApi.mine(from, to),
  });

  const { data: summary } = useQuery({
    queryKey: ['attendance', 'me', 'summary', month],
    queryFn: () => attendanceApi.monthlySummary(`${month}-01`),
  });

  const { data: employee } = useQuery({
    queryKey: ['employee', 'me'],
    queryFn: employeesApi.me,
  });

  const { data: holidaysList = [] } = useQuery<any[]>({
    queryKey: ['holidays', year],
    queryFn: () => holidaysApi.list({ year: String(year) }) as Promise<any[]>,
  });

  // Calculate rate and eligibility
  const rateMetrics = useMemo(() => {
    const monthlySalary = Number(employee?.baseSalary || 0);
    let shiftHours = 9.0;
    const latestShift = (employee as any)?.employeeShifts?.[0]?.shift;
    if (latestShift?.startTime && latestShift?.endTime) {
      const [sh, sm] = latestShift.startTime.split(':').map(Number);
      const [eh, em] = latestShift.endTime.split(':').map(Number);
      let diffMinutes = ((eh || 0) * 60 + (em || 0)) - ((sh || 0) * 60 + (sm || 0));
      if (diffMinutes <= 0) diffMinutes += 24 * 60;
      shiftHours = diffMinutes / 60;
    }

    const perDaySalaryExact = totalDays > 0 ? monthlySalary / totalDays : 0;
    const hourRateExact = shiftHours > 0 ? perDaySalaryExact / shiftHours : 0;

    // Count present regular days in this month
    const daySecondsMap = new Map<string, number>();
    rows.forEach((log: any) => {
      const dStr = new Date(log.attendanceDate).toLocaleDateString('en-CA');
      let secs = 0;
      if (log.punchInAt && log.punchOutAt) {
        const diff = (new Date(log.punchOutAt).getTime() - new Date(log.punchInAt).getTime()) / 1000;
        if (diff > 0) secs += diff;
      } else if (log.workedMinutes) {
        secs = log.workedMinutes * 60;
      }
      daySecondsMap.set(dStr, (daySecondsMap.get(dStr) || 0) + secs);
    });

    let presentRegularDays = 0;
    let totalWorkedSecs = 0;
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(year, mon - 1, d);
      const isSun = dateObj.getDay() === 0;
      const isHol = holidaysList.some((h: any) => h.date?.slice(0, 10) === dateStr);
      const secs = daySecondsMap.get(dateStr) || 0;
      if (!isSun && !isHol && secs > 0) {
        presentRegularDays++;
      }
      totalWorkedSecs += secs;
    }

    const getPaidCount = (presentDays: number, totalOff: number) => {
      if (presentDays >= 18) return totalOff;
      if (presentDays >= 12) return Math.min(2, totalOff);
      if (presentDays >= 5) return Math.min(1, totalOff);
      return 0;
    };

    // Sundays in this month
    let sundaysCount = 0;
    for (let d = 1; d <= totalDays; d++) {
      if (new Date(year, mon - 1, d).getDay() === 0) sundaysCount++;
    }
    const thisMonthHolidays = holidaysList.filter((h: any) => {
      if (!h.date) return false;
      const hDate = new Date(h.date);
      return hDate.getFullYear() === year && (hDate.getMonth() + 1) === mon && hDate.getDay() !== 0;
    });
    const holidaysCount = thisMonthHolidays.length;

    const paidSundays = getPaidCount(presentRegularDays, sundaysCount);
    const paidHolidays = getPaidCount(presentRegularDays, holidaysCount);
    const totalPaidOffDays = paidSundays + paidHolidays;

    const basicSalary = (totalWorkedSecs / 3600) * hourRateExact;
    const sundayHolidayPay = totalPaidOffDays * perDaySalaryExact;
    const monthEstimatedSalary = Math.round(basicSalary + sundayHolidayPay);

    return {
      monthlySalary,
      perDaySalary: Number(perDaySalaryExact.toFixed(2)),
      hourRate: Number(hourRateExact.toFixed(2)),
      presentRegularDays,
      paidSundays,
      paidHolidays,
      totalPaidOffDays,
      monthEstimatedSalary,
      totalWorkedHours: Number((totalWorkedSecs / 3600).toFixed(1)),
    };
  }, [employee, rows, totalDays, year, mon, holidaysList]);

  const columns: DataTableColumn<Attendance>[] = [
    { 
      key: 'attendanceDate', 
      header: 'Date', 
      render: (r) => {
        const dObj = new Date(r.attendanceDate);
        const isSun = dObj.getDay() === 0;
        return (
          <div className="flex items-center gap-2">
            <CalendarIcon size={14} className={cn(isSun ? "text-purple-500" : "text-muted-foreground")} />
            <span className={cn("font-medium", isSun && "text-purple-600 font-semibold")}>
              {dObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          </div>
        );
      } 
    },
    {
      key: 'punchInAt',
      header: 'Punch In',
      render: (r) => (
        r.punchInAt ? (
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500 font-medium">
            <Clock size={14} />
            {new Date(r.punchInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
          </div>
        ) : <span className="text-muted-foreground">--:--</span>
      ),
    },
    {
      key: 'punchOutAt',
      header: 'Punch Out',
      render: (r) => (
        r.punchOutAt ? (
          <div className="flex items-center gap-2 text-orange-600 dark:text-orange-500 font-medium">
            <Clock size={14} />
            {new Date(r.punchOutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
          </div>
        ) : <span className="text-muted-foreground">--:--</span>
      ),
    },
    { 
      key: 'workedMinutes', 
      header: 'Working Time',
      render: (r) => {
        if (!r.workedMinutes) return <span className="text-muted-foreground">--</span>;
        return <span className="font-semibold text-foreground">{formatDuration(r.workedMinutes)}</span>;
      }
    },
    { 
      key: 'overtimeMinutes', 
      header: 'Overtime',
      render: (r) => r.overtimeMinutes > 0 ? (
        <span className="text-emerald-600 font-medium">+{r.overtimeMinutes}m</span>
      ) : <span className="text-muted-foreground">--</span>
    },
    { 
      key: 'status', 
      header: 'Status', 
      render: (r) => <StatusBadge status={r.status} /> 
    },
    {
      key: 'dailySalary',
      header: 'Daily Earnings',
      render: (r) => {
        const dObj = new Date(r.attendanceDate);
        const isSun = dObj.getDay() === 0;
        const dStr = dObj.toLocaleDateString('en-CA');
        const isHol = holidaysList.some((h: any) => h.date?.slice(0, 10) === dStr) || r.status === 'HOLIDAY';

        if (isSun) {
          if (rateMetrics.paidSundays > 0) {
            return (
              <span className="text-purple-600 dark:text-purple-400 font-semibold text-xs bg-purple-500/10 px-2 py-1 rounded-md">
                ₹{rateMetrics.perDaySalary} (Sunday Pay)
              </span>
            );
          }
          return <span className="text-muted-foreground text-xs">Sunday Off</span>;
        }

        if (isHol) {
          if (rateMetrics.paidHolidays > 0) {
            return (
              <span className="text-purple-600 dark:text-purple-400 font-semibold text-xs bg-purple-500/10 px-2 py-1 rounded-md">
                ₹{rateMetrics.perDaySalary} (Holiday Pay)
              </span>
            );
          }
          return <span className="text-muted-foreground text-xs">Holiday</span>;
        }

        if (r.workedMinutes > 0) {
          const earned = Math.round((r.workedMinutes / 60) * rateMetrics.hourRate);
          return (
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              ₹{earned.toLocaleString()}
            </span>
          );
        }

        if (r.status === 'LEAVE') {
          return <span className="text-blue-600 font-medium text-xs">Approved Leave</span>;
        }

        return <span className="text-muted-foreground text-xs">₹0</span>;
      }
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">My Attendance</h2>
          <p className="text-sm text-muted-foreground mt-1">Review your attendance logs, punch times, and daily earnings.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="pl-10 pr-4 py-2 bg-background border border-input rounded-full shadow-sm text-sm font-medium focus:ring-2 focus:ring-primary focus:border-primary outline-none"
            />
            <CalendarDays size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="bg-emerald-500/10 border-emerald-500/20 shadow-sm">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <CheckCircle2 size={22} className="text-emerald-600 mb-1.5" />
            <div className="text-2xl font-bold text-foreground">{summary?.present ?? 0}</div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Present</p>
          </CardContent>
        </Card>
        
        <Card className="bg-red-500/10 border-red-500/20 shadow-sm">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <XCircle size={22} className="text-red-600 mb-1.5" />
            <div className="text-2xl font-bold text-foreground">{summary?.absent ?? 0}</div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Absent</p>
          </CardContent>
        </Card>
        
        <Card className="bg-orange-500/10 border-orange-500/20 shadow-sm">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <Clock4 size={22} className="text-orange-600 mb-1.5" />
            <div className="text-2xl font-bold text-foreground">{summary?.halfDay ?? 0}</div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Half Day</p>
          </CardContent>
        </Card>
        
        <Card className="bg-blue-500/10 border-blue-500/20 shadow-sm">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <ArrowRight size={22} className="text-blue-600 mb-1.5" />
            <div className="text-2xl font-bold text-foreground">{summary?.leave ?? 0}</div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Leave</p>
          </CardContent>
        </Card>
        
        <Card className="bg-purple-500/10 border-purple-500/20 shadow-sm">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <CalendarIcon size={22} className="text-purple-600 mb-1.5" />
            <div className="text-2xl font-bold text-foreground">{summary?.holiday ?? 0}</div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Holiday</p>
          </CardContent>
        </Card>

        <Card className="bg-primary/10 border-primary/25 shadow-sm sm:col-span-1 col-span-2">
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <IndianRupee size={22} className="text-primary mb-1.5" />
            <div className="text-2xl font-bold text-primary">₹{rateMetrics.monthEstimatedSalary.toLocaleString()}</div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Est. Earnings</p>
          </CardContent>
        </Card>
      </div>

      {/* Attendance Table */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Attendance & Daily Earnings Log</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Hourly Rate: ₹{rateMetrics.hourRate}/hr • Per Day Salary: ₹{rateMetrics.perDaySalary}/day
            </p>
          </div>
          <div className="text-xs font-semibold text-muted-foreground bg-secondary/30 px-3 py-1.5 rounded-full">
            Total Worked: <span className="text-primary font-bold">{rateMetrics.totalWorkedHours} hrs</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} isLoading={isLoading} />
        </CardContent>
      </Card>
    </div>
  );
}
