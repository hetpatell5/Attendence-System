import { useEffect, useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi, attendanceApi, announcementsApi, employeesApi, holidaysApi } from '@/lib/api';
import { useAuthStore } from '@/state/auth-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { 
  Clock, LogIn, LogOut, CheckCircle2, Megaphone, X, 
  IndianRupee, CalendarDays, AlertCircle, ArrowUpRight 
} from 'lucide-react';

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmt12h(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  const h = parseInt(parts[0] || '0', 10);
  const m = parts[1] || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${m} ${ampm}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function EmployeeDashboardPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [now, setNow] = useState(new Date());
  const [isPunchOutConfirmOpen, setIsPunchOutConfirmOpen] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;
  const currentMonthStr = `${currentYear}-${String(currentMonthNum).padStart(2, '0')}`;
  const fromDate = `${currentMonthStr}-01`;
  const lastDay = new Date(currentYear, currentMonthNum, 0).getDate();
  const toDate = `${currentMonthStr}-${String(lastDay).padStart(2, '0')}`;

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'employee'],
    queryFn: dashboardApi.employee,
  });

  const { data: employee } = useQuery({
    queryKey: ['employee', 'me'],
    queryFn: employeesApi.me,
  });

  const { data: activeAnnouncements = [] } = useQuery<any[]>({
    queryKey: ['announcements', 'active'],
    queryFn: () => announcementsApi.list({ activeOnly: 'true' }) as Promise<any[]>,
  });

  const { data: holidaysList = [] } = useQuery<any[]>({
    queryKey: ['holidays', currentYear],
    queryFn: () => holidaysApi.list({ year: String(currentYear) }) as Promise<any[]>,
  });

  const { data: monthAttendance = [] } = useQuery({
    queryKey: ['attendance', 'me', currentMonthStr],
    queryFn: () => attendanceApi.mine(fromDate, toDate),
  });

  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<string[]>([]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['dashboard', 'employee'] });
    void queryClient.invalidateQueries({ queryKey: ['attendance'] });
  };

  const punchInMutation = useMutation({ mutationFn: attendanceApi.punchIn, onSuccess: invalidate });
  const punchOutMutation = useMutation({
    mutationFn: attendanceApi.punchOut,
    onSuccess: () => {
      invalidate();
      setIsPunchOutConfirmOpen(false);
    },
  });

  const today = data?.today;
  const canPunchIn = !today?.punchInAt || (Boolean(today?.punchInAt) && Boolean(today?.punchOutAt));
  const canPunchOut = Boolean(today?.punchInAt) && !today?.punchOutAt;

  // Keyboard shortcut: Press Enter to Punch In
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
      return;
    }
    if (e.key === 'Enter' && canPunchIn && !punchInMutation.isPending && !isPunchOutConfirmOpen) {
      e.preventDefault();
      punchInMutation.mutate();
    }
  }, [canPunchIn, punchInMutation, isPunchOutConfirmOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // -------------------------------------------------------------------------
  // Exact Calculation (Matching Admin Salary Management Page 1:1)
  // -------------------------------------------------------------------------
  const salaryMetrics = useMemo(() => {
    const monthlySalary = Number(employee?.baseSalary || 0);
    const totalDaysInMonth = lastDay;

    let shiftHours = 9.0;
    let shiftName = 'Full Day';
    let shiftStart = '09:00';
    let shiftEnd = '19:30';

    const latestShift = (employee as any)?.employeeShifts?.[0]?.shift;
    if (latestShift?.startTime && latestShift?.endTime) {
      shiftStart = latestShift.startTime;
      shiftEnd = latestShift.endTime;
      shiftName = latestShift.name || 'Full Day';
      const [sh, sm] = shiftStart.split(':').map(Number);
      const [eh, em] = shiftEnd.split(':').map(Number);
      let diffMinutes = ((eh || 0) * 60 + (em || 0)) - ((sh || 0) * 60 + (sm || 0));
      if (diffMinutes <= 0) diffMinutes += 24 * 60;
      shiftHours = diffMinutes / 60;
    }

    const perDaySalaryExact = totalDaysInMonth > 0 ? monthlySalary / totalDaysInMonth : 0;
    const hourRateExact = shiftHours > 0 ? perDaySalaryExact / shiftHours : 0;

    let sundaysCount = 0;
    for (let d = 1; d <= totalDaysInMonth; d++) {
      if (new Date(currentYear, currentMonthNum - 1, d).getDay() === 0) {
        sundaysCount++;
      }
    }

    const thisMonthHolidays = holidaysList.filter((h: any) => {
      if (!h.date) return false;
      const hDate = new Date(h.date);
      return hDate.getFullYear() === currentYear && (hDate.getMonth() + 1) === currentMonthNum && hDate.getDay() !== 0;
    });
    const holidaysCount = thisMonthHolidays.length;
    const totalWorkingDays = totalDaysInMonth - sundaysCount - holidaysCount;

    const daySecondsMap = new Map<string, number>();
    monthAttendance.forEach((log: any) => {
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

    let totalWorkedSeconds = 0;
    let presentRegularDays = 0;

    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dateStr = `${currentYear}-${String(currentMonthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(currentYear, currentMonthNum - 1, d);
      const isSun = dateObj.getDay() === 0;
      const isHol = holidaysList.some((h: any) => h.date?.slice(0, 10) === dateStr);
      const secs = daySecondsMap.get(dateStr) || 0;

      if (!isSun && !isHol && secs > 0) {
        presentRegularDays++;
      }
      totalWorkedSeconds += secs;
    }

    const totalHoursExact = totalWorkedSeconds / 3600;
    const expectedHoursExact = presentRegularDays * shiftHours;
    const overtimeHoursExact = Math.max(0, totalHoursExact - expectedHoursExact);
    const overtimePayout = overtimeHoursExact * hourRateExact;

    const getPaidCount = (presentDays: number, totalOff: number) => {
      if (presentDays >= 18) return totalOff;
      if (presentDays >= 12) return Math.min(2, totalOff);
      if (presentDays >= 5) return Math.min(1, totalOff);
      return 0;
    };

    const paidSundays = getPaidCount(presentRegularDays, sundaysCount);
    const paidHolidays = getPaidCount(presentRegularDays, holidaysCount);
    const totalPaidOffDays = paidSundays + paidHolidays;
    const sundayHolidayPay = totalPaidOffDays * perDaySalaryExact;
    const basicSalary = totalHoursExact * hourRateExact;
    const estimatedNetPay = Math.round(basicSalary + sundayHolidayPay);

    return {
      monthlySalary,
      shiftHours,
      shiftName,
      shiftStart,
      shiftEnd,
      perDaySalary: Number(perDaySalaryExact.toFixed(2)),
      hourRate: Number(hourRateExact.toFixed(2)),
      totalDaysInMonth,
      totalWorkingDays,
      sundaysCount,
      holidaysCount,
      presentRegularDays,
      totalHours: Number(totalHoursExact.toFixed(1)),
      expectedHours: Math.round(expectedHoursExact),
      overtimeHours: Number(overtimeHoursExact.toFixed(1)),
      overtimePayout: Number(overtimePayout.toFixed(2)),
      paidSundays,
      paidHolidays,
      totalPaidOffDays,
      sundayHolidayPay: Number(sundayHolidayPay.toFixed(2)),
      basicSalary: Number(basicSalary.toFixed(2)),
      estimatedNetPay,
    };
  }, [employee, monthAttendance, holidaysList, currentYear, currentMonthNum, lastDay]);

  if (isLoading || !data) {
    return <div className="p-12 text-center text-muted-foreground animate-pulse text-sm">Loading dashboard...</div>;
  }

  let todayWorkedMinutes = today?.workedMinutes || 0;
  if (today?.punchInAt && !today?.punchOutAt) {
    const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(today.punchInAt).getTime()) / 60000));
    todayWorkedMinutes = Math.max(todayWorkedMinutes, elapsed);
  }
  const todayEarnedSalary = Math.round((todayWorkedMinutes / 60) * salaryMetrics.hourRate);

  const timeString = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const dateString = now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const visibleAnnouncements = activeAnnouncements.filter(
    (a) => a.isActive && !dismissedAnnouncements.includes(a.id)
  );

  return (
    <div className="space-y-6">
      {/* Announcements */}
      {visibleAnnouncements.length > 0 && (
        <div className="space-y-3">
          {visibleAnnouncements.map((a) => (
            <div
              key={a.id}
              className="p-4 rounded-lg bg-primary/5 border border-primary/20 flex items-start gap-3 relative text-sm"
            >
              <Megaphone size={16} className="text-primary shrink-0 mt-0.5" />
              <div className="flex-1 pr-6">
                <span className="text-xs font-semibold uppercase tracking-wider text-primary mr-2">Notice:</span>
                <span className="text-foreground">{a.message}</span>
              </div>
              <button
                onClick={() => setDismissedAnnouncements((prev) => [...prev, a.id])}
                className="text-muted-foreground hover:text-foreground p-1"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b pb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {greeting()}, {user?.name}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {employee?.department?.name || 'General'} | {salaryMetrics.shiftName.toUpperCase()} ({fmt12h(salaryMetrics.shiftStart)} - {fmt12h(salaryMetrics.shiftEnd)})
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/me/salary">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs font-medium">
              <IndianRupee size={14} /> View Salary Slip
            </Button>
          </Link>
          <Link to="/me/attendance">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs font-medium">
              <CalendarDays size={14} /> Attendance Log
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Clock & Action */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          <Card className="border border-border shadow-sm flex flex-col items-center justify-center p-6 text-center bg-card">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground text-[11px] font-medium mb-3">
              <Clock className="h-3 w-3" /> Live Clock
            </div>
            <div className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground mb-1 tabular-nums">
              {timeString}
            </div>
            <div className="text-xs text-muted-foreground mb-6">
              {dateString}
            </div>

            {canPunchOut ? (
              <Button 
                size="lg" 
                className="w-full max-w-[260px] h-12 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white gap-2 transition-all"
                onClick={() => setIsPunchOutConfirmOpen(true)}
                disabled={punchOutMutation.isPending}
              >
                <LogOut size={16} /> {punchOutMutation.isPending ? 'Punching out...' : 'Punch Out'}
              </Button>
            ) : (
              <Button 
                size="lg" 
                className="w-full max-w-[260px] h-12 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white gap-2 transition-all"
                onClick={() => punchInMutation.mutate()}
                disabled={punchInMutation.isPending}
              >
                <LogIn size={16} /> {punchInMutation.isPending ? 'Punching in...' : 'Punch In (Press Enter)'}
              </Button>
            )}

            {today?.punchOutAt && (
              <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 size={13} className="text-emerald-500" /> Out recorded at {formatTime(today.punchOutAt)}
              </p>
            )}
          </Card>

          {/* Today's Summary */}
          <Card className="border border-border shadow-sm">
            <CardHeader className="py-3 px-5 border-b">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex justify-between">
                <span>Today's Work</span>
                <span>Rate: ₹{salaryMetrics.hourRate}/hr</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground flex items-center gap-2">
                  <LogIn size={13} className="text-emerald-600" /> Punch In
                </span>
                <span className="font-medium text-foreground">{formatTime(today?.punchInAt)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground flex items-center gap-2">
                  <LogOut size={13} className="text-red-600" /> Punch Out
                </span>
                <span className="font-medium text-foreground">{formatTime(today?.punchOutAt)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Clock size={13} className="text-primary" /> Duration
                </span>
                <span className="font-medium text-foreground">{formatDuration(todayWorkedMinutes)}</span>
              </div>
              <div className="pt-2.5 border-t flex justify-between items-center text-sm">
                <span className="font-medium text-muted-foreground">Today's Earnings</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  ₹{todayEarnedSalary.toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Month Salary Card (Same format as Admin side) */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          <Card className="border border-border shadow-sm bg-card">
            <div className="px-5 py-3.5 border-b flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-sm text-foreground">
                  {now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} Salary Overview
                </h3>
                <p className="text-xs text-muted-foreground">
                  Calculated based on actual attendance, overtime and eligible off-day rules
                </p>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-medium text-muted-foreground uppercase">Estimated Net Pay</span>
                <div className="text-xl font-bold text-primary">
                  ₹{salaryMetrics.estimatedNetPay.toLocaleString()}
                </div>
              </div>
            </div>

            <CardContent className="p-5 space-y-4">
              {/* Grid 3x3 matching Admin Card */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-secondary/30 border border-secondary/50">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Monthly Salary</p>
                  <p className="text-sm font-semibold text-foreground mt-1">₹ {salaryMetrics.monthlySalary.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-secondary/50">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Rate / Hr</p>
                  <p className="text-sm font-semibold text-foreground mt-1">₹ {salaryMetrics.hourRate}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-secondary/50">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Hours (Tot / Exp)</p>
                  <p className="text-sm font-semibold text-foreground mt-1">{salaryMetrics.totalHours} / {salaryMetrics.expectedHours}</p>
                </div>

                <div className="p-3 rounded-lg bg-secondary/30 border border-secondary/50">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Salary Per Day</p>
                  <p className="text-sm font-semibold text-foreground mt-1">₹ {salaryMetrics.perDaySalary}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-secondary/50">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Total Days in Month</p>
                  <p className="text-sm font-semibold text-foreground mt-1">{salaryMetrics.totalDaysInMonth}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-secondary/50">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Basic Salary</p>
                  <p className="text-sm font-semibold text-foreground mt-1">₹ {salaryMetrics.basicSalary.toLocaleString()}</p>
                </div>

                <div className="p-3 rounded-lg bg-secondary/30 border border-secondary/50">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Total Working Days</p>
                  <p className="text-sm font-semibold text-foreground mt-1">{salaryMetrics.totalWorkingDays}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-secondary/50">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Sunday & Holiday Pay</p>
                  <p className="text-sm font-semibold text-foreground mt-1">₹ {salaryMetrics.sundayHolidayPay.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/30 border border-secondary/50">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Mon-Sat Present Days</p>
                  <p className="text-sm font-semibold text-emerald-600 mt-1">{salaryMetrics.presentRegularDays}</p>
                </div>
              </div>

              {/* Bottom Summary Breakdown */}
              <div className="p-3.5 rounded-lg bg-muted/40 border border-border text-xs space-y-1.5">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Basic Working Hours Pay ({salaryMetrics.totalHours} hrs × ₹{salaryMetrics.hourRate})</span>
                  <span className="font-medium text-foreground">₹{salaryMetrics.basicSalary.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Sunday & Holiday Allowance ({salaryMetrics.totalPaidOffDays} off-days × ₹{salaryMetrics.perDaySalary})</span>
                  <span className="font-medium text-foreground">₹{salaryMetrics.sundayHolidayPay.toLocaleString()}</span>
                </div>
                <div className="pt-2 border-t flex justify-between items-center font-medium text-sm text-foreground">
                  <span>Estimated Total Earned This Month</span>
                  <span className="font-semibold text-primary">₹{salaryMetrics.estimatedNetPay.toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Info & Recent Leave Requests */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="border border-border shadow-sm p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Month Attendance</p>
                  <p className="text-xl font-semibold text-foreground mt-0.5">{data.monthSummary.present} Days Present</p>
                  <p className="text-xs text-muted-foreground">{data.monthSummary.absent} Absent · {data.monthSummary.leave} Leave</p>
                </div>
                <Link to="/me/attendance" className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 text-muted-foreground transition-colors">
                  <ArrowUpRight size={16} />
                </Link>
              </div>
            </Card>

            <Card className="border border-border shadow-sm p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase">Leave Requests</p>
                  <p className="text-xl font-semibold text-foreground mt-0.5">{data.pendingLeaveCount} Pending</p>
                  <p className="text-xs text-muted-foreground">Apply for time off</p>
                </div>
                <Link to="/me/leaves" className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 text-muted-foreground transition-colors">
                  <ArrowUpRight size={16} />
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Punch Out */}
      <Dialog open={isPunchOutConfirmOpen} onOpenChange={setIsPunchOutConfirmOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <AlertCircle size={18} className="text-amber-500" /> Confirm Punch Out
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 text-xs text-muted-foreground">
            Are you sure you want to clock out for today? This will record your punch out time and finalize your shift hours.
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setIsPunchOutConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => punchOutMutation.mutate()}
              disabled={punchOutMutation.isPending}
            >
              {punchOutMutation.isPending ? 'Punching out...' : 'Yes, Punch Out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
