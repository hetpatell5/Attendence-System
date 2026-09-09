import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi, attendanceApi, announcementsApi, holidaysApi, employeesApi } from '@/lib/api';
import { useAuthStore } from '@/state/auth-store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  LogIn,
  LogOut,
  CalendarDays,
  Clock,
  IndianRupee,
  AlertCircle,
  ArrowUpRight,
  Megaphone,
  X,
  AlertTriangle,
} from 'lucide-react';
import { ShutdownPunchOutModal } from '@/components/ShutdownPunchOutModal';
import { AttendanceCalendarCard } from '@/components/AttendanceCalendarCard';
import { RequestsStatusCard } from '@/components/RequestsStatusCard';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmt12h(timeStr?: string | null): string {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr || '0', 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

export function EmployeeDashboardPage(): JSX.Element {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const [isPunchInConfirmOpen, setIsPunchInConfirmOpen] = useState(false);
  const [isPunchOutConfirmOpen, setIsPunchOutConfirmOpen] = useState(false);
  const [punchErrorMessage, setPunchErrorMessage] = useState<string | null>(null);
  // Shutdown-gate: shown when the OS tries to shut down while employee is clocked in
  const [showShutdownModal, setShowShutdownModal] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'employee'],
    queryFn: dashboardApi.employee,
    refetchInterval: 15000,
  });

  const { data: employee } = useQuery({
    queryKey: ['employee', 'me'],
    queryFn: employeesApi.me,
  });

  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;
  const currentMonthStr = `${currentYear}-${String(currentMonthNum).padStart(2, '0')}`;
  const lastDay = new Date(currentYear, currentMonthNum, 0).getDate();
  const fromDate = `${currentMonthStr}-01`;
  const toDate = `${currentMonthStr}-${String(lastDay).padStart(2, '0')}`;

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

  const punchInMutation = useMutation({
    mutationFn: attendanceApi.punchIn,
    onSuccess: () => {
      setPunchErrorMessage(null);
      invalidate();
      // Keep punch-status file in sync so the shutdown-gate helper knows
      try {
        const eApi = (window as any).electronApi;
        if (eApi?.shutdown?.updatePunchStatus) void eApi.shutdown.updatePunchStatus(true);
      } catch { /* non-Electron environment */ }
    },
    onError: (err: any) => {
      const msg = err?.message || 'Failed to clock in';
      setPunchErrorMessage(msg);
    },
  });

  const punchOutMutation = useMutation({
    mutationFn: attendanceApi.punchOut,
    onSuccess: () => {
      setPunchErrorMessage(null);
      invalidate();
      setIsPunchOutConfirmOpen(false);
      // Sync punch-status so helper allows next shutdown attempt
      try {
        const eApi = (window as any).electronApi;
        if (eApi?.shutdown?.updatePunchStatus) void eApi.shutdown.updatePunchStatus(false);
      } catch { /* non-Electron environment */ }
    },
    onError: (err: any) => {
      const msg = err?.message || 'Failed to clock out';
      setPunchErrorMessage(msg);
      setIsPunchOutConfirmOpen(false);
    },
  });

  // -------------------------------------------------------------------------
  // Punch State Logic
  // -------------------------------------------------------------------------
  const punchState = data?.punchState;
  const today = data?.today;

  const punchCount = punchState?.punchCount ?? (today?.punchInAt ? 1 : 0);
  const isClockedIn = punchState
    ? punchState.currentState === 'in'
    : Boolean(today?.punchInAt) && !today?.punchOutAt;

  const shiftEndTimestamp = punchState?.shiftEndTimestamp;
  const shiftStartTimestamp = punchState?.shiftStartTimestamp;
  const firstClockIn = punchState?.firstClockIn;

  // ---------------------------------------------------------------------------
  // Shutdown-gate: keep status file in sync with live punch state and register
  // the IPC listener so main process can trigger the modal on shutdown.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Only sync when data has loaded (avoid false negatives during loading)
    if (isLoading) return;
    try {
      const eApi = (window as any).electronApi;
      if (eApi?.shutdown?.updatePunchStatus) {
        void eApi.shutdown.updatePunchStatus(isClockedIn);
      }
    } catch { /* non-Electron */ }
  }, [isClockedIn, isLoading]);

  useEffect(() => {
    try {
      const eApi = (window as any).electronApi;
      if (!eApi?.shutdown?.onPunchOutRequired) return;
      // Register listener — returns cleanup disposer
      const cleanup = eApi.shutdown.onPunchOutRequired(() => {
        setShowShutdownModal(true);
      });
      return cleanup;
    } catch {
      return undefined;
    }
  }, []);


  // -------------------------------------------------------------------------
  // Shift Countdown & Progress Info
  // -------------------------------------------------------------------------
  const shiftCountdownInfo = useMemo(() => {
    if (!isClockedIn || !shiftEndTimestamp) return null;

    const remainingMs = shiftEndTimestamp - now.getTime();
    if (remainingMs <= 0) {
      return {
        isComplete: true,
        text: 'Shift Completed',
        percent: 100,
      };
    }

    const totalSecs = Math.floor(remainingMs / 1000);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeText = `${pad(h)}h ${pad(m)}m ${pad(s)}s`;

    let percent = 0;
    if (shiftStartTimestamp && shiftEndTimestamp > shiftStartTimestamp) {
      const elapsedMs = now.getTime() - shiftStartTimestamp;
      const totalShiftMs = shiftEndTimestamp - shiftStartTimestamp;
      percent = Math.min(100, Math.max(0, Math.round((elapsedMs / totalShiftMs) * 100)));
    }

    return {
      isComplete: false,
      text: timeText,
      percent,
    };
  }, [isClockedIn, shiftEndTimestamp, shiftStartTimestamp, now]);

  // -------------------------------------------------------------------------
  // Punch Timeline Builder
  // -------------------------------------------------------------------------
  const punchTimeline = useMemo(() => {
    const rawPunches = punchState?.punches || [];
    return rawPunches.map((p, idx) => {
      const type = String(p.punch_type).toUpperCase();
      const isLatest = idx === rawPunches.length - 1;
      const isCurrentlyActive = isLatest && type === 'IN' && isClockedIn;

      let sessionText: string | null = null;
      if (type === 'OUT' && idx > 0) {
        const prev = rawPunches[idx - 1];
        if (prev) {
          const [sh, sm, ss] = prev.time.split(':').map(Number);
          const [eh, em, es] = p.time.split(':').map(Number);
          const diffSecs =
            ((eh || 0) * 3600 + (em || 0) * 60 + (es || 0)) -
            ((sh || 0) * 3600 + (sm || 0) * 60 + (ss || 0));
          if (diffSecs > 0) {
            const diffMins = Math.round(diffSecs / 60);
            sessionText = formatDuration(diffMins);
          }
        }
      } else if (isCurrentlyActive) {
        sessionText = 'Active';
      }

      return {
        id: p.id,
        num: idx + 1,
        type: type === 'IN' ? 'IN' : 'OUT',
        time: p.time,
        sessionText,
        isCurrentlyActive,
      };
    });
  }, [punchState?.punches, isClockedIn]);

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

    const latestShift = (employee as any)?.employeeShifts?.[0]?.shift || punchState?.shift;
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
  }, [employee, punchState, monthAttendance, holidaysList, currentYear, currentMonthNum, lastDay]);

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
  const dateString = now.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const visibleAnnouncements = activeAnnouncements.filter(
    (a) => a.isActive && !dismissedAnnouncements.includes(a.id)
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Shutdown gate: blocks OS shutdown until employee punches out */}
      {showShutdownModal && (
        <ShutdownPunchOutModal onDone={() => setShowShutdownModal(false)} />
      )}

      {/* Friendly Alert Modal for Punch Errors */}
      <Dialog open={Boolean(punchErrorMessage)} onOpenChange={(open) => !open && setPunchErrorMessage(null)}>
        <DialogContent className="sm:max-w-[400px] rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
              <AlertTriangle size={18} className="text-amber-500 shrink-0" />
              <span>Punch Action</span>
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground leading-relaxed">
            {punchErrorMessage}
          </div>
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => setPunchErrorMessage(null)}
              className="w-full sm:w-auto px-5 rounded-lg text-xs font-medium"
            >
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Announcements */}
      {visibleAnnouncements.length > 0 && (
        <div className="space-y-2.5">
          {visibleAnnouncements.map((a) => (
            <div
              key={a.id}
              className="p-3.5 rounded-xl bg-primary/5 border border-primary/15 flex items-center gap-3 relative text-sm"
            >
              <Megaphone size={16} className="text-primary shrink-0" />
              <div className="flex-1 pr-6 text-xs text-foreground">
                <span className="font-semibold text-primary mr-2 uppercase tracking-wide text-[10px]">Announcement:</span>
                {a.message}
              </div>
              <button
                onClick={() => setDismissedAnnouncements((prev) => [...prev, a.id])}
                className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-2 border-b border-border/50">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {greeting()}, {user?.name}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
            <span>{employee?.department?.name || 'General'}</span>
            <span>•</span>
            <span>{salaryMetrics.shiftName} ({fmt12h(salaryMetrics.shiftStart)} – {fmt12h(salaryMetrics.shiftEnd)})</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/me/salary">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs font-medium h-8 rounded-lg">
              <IndianRupee size={13} /> Salary Slip
            </Button>
          </Link>
          <Link to="/me/attendance">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs font-medium h-8 rounded-lg">
              <CalendarDays size={13} /> Attendance Log
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Minimalist Punch Card & Today Stats */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Hero Clock & Punch Card */}
          <Card className="rounded-2xl border border-border/70 shadow-sm bg-card p-6 flex flex-col justify-between relative overflow-hidden">
            {/* Top Status & Date */}
            <div className="flex items-center justify-between w-full mb-3">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-muted/60 text-[11px] font-medium text-foreground/80">
                <span className="relative flex h-2 w-2">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      isClockedIn ? 'bg-emerald-400' : 'bg-zinc-400'
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      isClockedIn ? 'bg-emerald-500' : 'bg-zinc-400'
                    }`}
                  />
                </span>
                <span>{isClockedIn ? 'Clocked In' : 'Clocked Out'}</span>
              </div>
              <span className="text-xs font-medium text-muted-foreground">{dateString}</span>
            </div>

            {/* Clean Live Time Display */}
            <div className="text-center py-2">
              <div className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground font-sans tabular-nums">
                {timeString}
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-medium">
                {salaryMetrics.shiftName} Shift
              </p>
            </div>

            {/* Shift Progress Section (Unified, clean & minimal) */}
            {isClockedIn && shiftCountdownInfo && (
              <div className="w-full my-3 p-3.5 rounded-xl bg-muted/40 border border-border/40 space-y-2">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-muted-foreground">
                    {shiftCountdownInfo.isComplete ? 'Shift Completed' : 'Time Remaining'}
                  </span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {shiftCountdownInfo.text}
                  </span>
                </div>
                {/* Sleek Minimal Progress Track */}
                <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-1000 ease-linear"
                    style={{ width: `${shiftCountdownInfo.percent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                  <span>In: {firstClockIn ? fmt12h(firstClockIn) : '—'}</span>
                  <span className="font-medium">{shiftCountdownInfo.percent}% done</span>
                </div>
              </div>
            )}

            {/* Punch Action Button */}
            <div className="w-full mt-3 flex flex-col items-center gap-2">
              {isClockedIn ? (
                <Button
                  type="button"
                  size="lg"
                  variant="destructive"
                  className="w-full h-11 rounded-xl font-medium text-sm flex items-center justify-center gap-2 shadow-sm transition-all"
                  onClick={() => setIsPunchOutConfirmOpen(true)}
                  disabled={punchOutMutation.isPending}
                >
                  <LogOut size={16} />
                  <span>{punchOutMutation.isPending ? 'Processing...' : 'Clock Out'}</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  className="w-full h-11 rounded-xl font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-2 shadow-sm transition-all"
                  onClick={() => setIsPunchInConfirmOpen(true)}
                  disabled={punchInMutation.isPending}
                >
                  <LogIn size={16} />
                  <span>{punchInMutation.isPending ? 'Processing...' : 'Clock In'}</span>
                </Button>
              )}

              {punchCount > 0 && (
                <span className="text-xs text-muted-foreground font-medium">
                  {punchCount} {punchCount === 1 ? 'punch' : 'punches'} recorded today
                </span>
              )}
            </div>
          </Card>

          {/* Today's Stats & Punch Timeline Card */}
          <Card className="rounded-2xl border border-border/70 shadow-sm bg-card p-5">
            <div className="flex items-center justify-between pb-3 border-b border-border/50 mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today's Summary</span>
              <span className="text-xs font-medium text-muted-foreground">Rate: ₹{salaryMetrics.hourRate}/hr</span>
            </div>

            {/* Summary Metrics Row */}
            <div className="grid grid-cols-2 gap-2 pb-3 border-b border-border/40">
              <div className="p-2.5 rounded-xl bg-muted/30 border border-border/30">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock size={11} className="text-primary" /> Active Time
                </span>
                <p className="text-sm font-bold text-foreground mt-0.5">
                  {formatDuration(todayWorkedMinutes)}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-muted/30 border border-border/30">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <IndianRupee size={11} className="text-emerald-600" /> Earned Today
                </span>
                <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  ₹{todayEarnedSalary.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Punch Timeline Header */}
            <div className="pt-3">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Punches Timeline ({punchTimeline.length})
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Today's Sequence
                </span>
              </div>

              {punchTimeline.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2 text-center">
                  No punches recorded today yet
                </p>
              ) : (
                <div className="space-y-0 max-h-56 overflow-y-auto pr-1">
                  {punchTimeline.map((item, index) => {
                    const isLast = index === punchTimeline.length - 1;
                    return (
                      <div key={item.id || index} className="flex items-start gap-3 relative pb-2.5 group">
                        {/* Vertical connecting line */}
                        {!isLast && (
                          <div className="absolute left-[11px] top-5 bottom-0 w-[2px] bg-border/60" />
                        )}

                        {/* Node Icon */}
                        <div
                          className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 transition-all ${
                            item.type === 'IN'
                              ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-600 border border-rose-500/30'
                          }`}
                        >
                          {item.type === 'IN' ? <LogIn size={11} /> : <LogOut size={11} />}
                        </div>

                        {/* Details */}
                        <div className="flex-1 flex items-center justify-between text-xs min-w-0 pt-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">
                              Punch #{item.num}
                            </span>
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.2 rounded-md ${
                                item.type === 'IN'
                                  ? 'bg-emerald-500/10 text-emerald-600'
                                  : 'bg-rose-500/10 text-rose-600'
                              }`}
                            >
                              {item.type === 'IN' ? 'IN' : 'OUT'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-foreground/90">
                              {fmt12h(item.time)}
                            </span>
                            {item.sessionText && (
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                                  item.isCurrentlyActive
                                    ? 'bg-emerald-500/15 text-emerald-600 animate-pulse font-semibold'
                                    : 'bg-muted text-muted-foreground'
                                }`}
                              >
                                {item.sessionText}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Redesigned Minimalist Salary Overview & Feature Cards */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Redesigned Compact Minimalist Salary Overview */}
          <Card className="rounded-2xl border border-border/70 shadow-sm bg-card p-5">
            {/* Header: Title & Estimated Net Pay */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-border/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/50 dark:border-emerald-800/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <IndianRupee size={17} />
                </div>
                <div>
                  <h3 className="font-bold text-base text-foreground tracking-tight">
                    {now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} Salary Overview
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Based on actual punches, overtime, and off-day rules
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                  Estimated Net Pay
                </span>
                <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  ₹{salaryMetrics.estimatedNetPay.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Streamlined Minimalist Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 border-b border-border/40">
              {/* 1. Monthly Base & Rate */}
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                  Base & Hourly
                </span>
                <p className="text-sm font-bold text-foreground">
                  ₹{salaryMetrics.monthlySalary.toLocaleString()}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  ₹{salaryMetrics.hourRate}/hr · ₹{salaryMetrics.perDaySalary}/day
                </p>
              </div>

              {/* 2. Days & Attendance */}
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                  Working Days
                </span>
                <p className="text-sm font-bold text-foreground">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{salaryMetrics.presentRegularDays}</span>
                  <span className="text-muted-foreground font-normal"> / {salaryMetrics.totalWorkingDays} days</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {salaryMetrics.totalDaysInMonth} total days in month
                </p>
              </div>

              {/* 3. Hours (Act / Exp) */}
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                  Logged Hours
                </span>
                <p className="text-sm font-bold text-foreground">
                  {salaryMetrics.totalHours} <span className="text-muted-foreground font-normal">/ {salaryMetrics.expectedHours} hrs</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {salaryMetrics.overtimeHours > 0 ? `+${salaryMetrics.overtimeHours}h overtime` : 'Regular shift hours'}
                </p>
              </div>

              {/* 4. Earned Components */}
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                  Earnings Breakdown
                </span>
                <p className="text-sm font-bold text-foreground">
                  ₹{salaryMetrics.basicSalary.toLocaleString()}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  + ₹{salaryMetrics.sundayHolidayPay.toLocaleString()} ({salaryMetrics.totalPaidOffDays} paid off-days)
                </p>
              </div>
            </div>

            {/* Compact Minimalist Breakdown Strip */}
            <div className="pt-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  Basic Work: <strong className="text-foreground font-semibold">₹{salaryMetrics.basicSalary.toLocaleString()}</strong> ({salaryMetrics.totalHours}h @ ₹{salaryMetrics.hourRate})
                </span>
                <span>•</span>
                <span>
                  Off-day Pay: <strong className="text-foreground font-semibold">₹{salaryMetrics.sundayHolidayPay.toLocaleString()}</strong> ({salaryMetrics.totalPaidOffDays} days @ ₹{salaryMetrics.perDaySalary})
                </span>
              </div>
              <Link
                to="/me/salary"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0"
              >
                <span>View Full Salary Slip</span>
                <ArrowUpRight size={13} />
              </Link>
            </div>
          </Card>

          {/* Subgrid: Attendance Calendar (Image 1) & Requests Status Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <AttendanceCalendarCard
              initialYear={currentYear}
              initialMonth={currentMonthNum}
              todayDate={now}
            />
            <RequestsStatusCard />
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Clock In */}
      <Dialog open={isPunchInConfirmOpen} onOpenChange={setIsPunchInConfirmOpen}>
        <DialogContent className="sm:max-w-[380px] rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <LogIn size={18} className="text-emerald-500" /> Confirm Clock In
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-xs text-muted-foreground leading-relaxed">
            Are you sure you want to clock in? This will record your current punch in time.
          </div>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => setIsPunchInConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="rounded-lg text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                setIsPunchInConfirmOpen(false);
                punchInMutation.mutate();
              }}
              disabled={punchInMutation.isPending}
            >
              {punchInMutation.isPending ? 'Processing...' : 'Yes, Clock In'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal for Clock Out */}
      <Dialog open={isPunchOutConfirmOpen} onOpenChange={setIsPunchOutConfirmOpen}>
        <DialogContent className="sm:max-w-[380px] rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <AlertCircle size={18} className="text-rose-500" /> Confirm Clock Out
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-xs text-muted-foreground leading-relaxed">
            Are you sure you want to clock out? This will record your punch out time. You can clock in again later today if needed.
          </div>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => setIsPunchOutConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="rounded-lg text-xs"
              onClick={() => {
                setIsPunchOutConfirmOpen(false);
                punchOutMutation.mutate();
              }}
              disabled={punchOutMutation.isPending}
            >
              {punchOutMutation.isPending ? 'Processing...' : 'Yes, Clock Out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
