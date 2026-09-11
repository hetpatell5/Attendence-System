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
  Megaphone,
  X,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
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
  const [isTimelineModalOpen, setIsTimelineModalOpen] = useState(false);

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

  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('dismissed_announcements');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const handleDismissAnnouncement = (id: string) => {
    setDismissedAnnouncements((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      try {
        localStorage.setItem('dismissed_announcements', JSON.stringify(next));
      } catch {
        /* ignore localStorage errors */
      }
      return next;
    });
  };

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

  let todayWorkedMinutes = today?.workedMinutes || 0;
  if (today?.punchInAt && !today?.punchOutAt) {
    const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(today.punchInAt).getTime()) / 60000));
    todayWorkedMinutes = Math.max(todayWorkedMinutes, elapsed);
  }

  const weeklyDaysData = useMemo(() => {
    const shiftTargetHours = salaryMetrics.shiftHours || 9.0;
    const days = [];

    // Map the last 7 calendar days up to today
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
      const isToday = i === 0;
      const isSunday = d.getDay() === 0;

      // Find in backend weeklyActivity
      const actRow = (data?.weeklyActivity || []).find((w: any) => w.date === dateStr);
      let hours = actRow ? Number(actRow.hours || 0) : 0;

      // For today, incorporate live minutes if currently clocked in or active
      if (isToday && todayWorkedMinutes > 0) {
        hours = Math.max(hours, parseFloat((todayWorkedMinutes / 60).toFixed(2)));
      }

      const percent = Math.min(100, Math.round((hours / shiftTargetHours) * 100));

      days.push({
        dateStr,
        dayLabel,
        dateNum: d.getDate(),
        isToday,
        isSunday,
        hours,
        percent,
        isOvertime: hours > shiftTargetHours,
      });
    }

    return days;
  }, [now, data?.weeklyActivity, todayWorkedMinutes, salaryMetrics.shiftHours]);

  const weeklyStats = useMemo(() => {
    const totalHours = weeklyDaysData.reduce((acc, d) => acc + d.hours, 0);
    const activeDays = weeklyDaysData.filter((d) => d.hours > 0).length;
    const avgHours = activeDays > 0 ? (totalHours / activeDays).toFixed(1) : '0';
    const targetMetDays = weeklyDaysData.filter(
      (d) => d.hours >= (salaryMetrics.shiftHours || 9.0) * 0.9
    ).length;

    return {
      totalHours: Number(totalHours.toFixed(1)),
      avgHours,
      activeDays,
      targetMetDays,
    };
  }, [weeklyDaysData, salaryMetrics.shiftHours]);

  if (isLoading || !data) {
    return <div className="p-12 text-center text-muted-foreground animate-pulse text-sm">Loading dashboard...</div>;
  }

  const timeString = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const dateString = now.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const visibleAnnouncements = activeAnnouncements.filter((a) => {
    if (!a.isActive) return false;
    if (dismissedAnnouncements.includes(a.id)) return false;

    // Only remain visible for 24 hours from creation
    const createdTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const isWithin24Hours = (Date.now() - createdTime) <= 24 * 60 * 60 * 1000;
    const isNotExpired = !a.expiresAt || new Date(a.expiresAt).getTime() > Date.now();

    return isWithin24Hours && isNotExpired;
  });

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
                onClick={() => handleDismissAnnouncement(a.id)}
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

      {/* Top Hero: Focused Horizontal Clock & Shift Action Card */}
      <Card className="rounded-2xl border border-border/70 shadow-sm bg-card p-5 sm:p-6 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Left: Status Badge, Digital Clock, Date & Shift Info */}
          <div className="flex flex-col items-start gap-1.5 min-w-[260px]">
            <div className="flex items-center gap-2">
              <div
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                  isClockedIn
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                    : 'bg-muted/80 text-muted-foreground border-border/60'
                }`}
              >
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

            <div className="text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground font-mono tabular-nums mt-1">
              {timeString}
            </div>

            <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 mt-0.5">
              <Clock size={12} className="text-muted-foreground shrink-0" />
              <span>{salaryMetrics.shiftName} Shift</span>
              <span>•</span>
              <span>
                {fmt12h(salaryMetrics.shiftStart)} – {fmt12h(salaryMetrics.shiftEnd)}
              </span>
            </p>
          </div>

          {/* Middle: Shift Progress (if clocked in) or Today's Summary (if clocked out) */}
          <div className="flex-1 w-full lg:max-w-md lg:px-6 lg:border-x border-border/50">
            {isClockedIn && shiftCountdownInfo ? (
              <div className="space-y-2.5 py-1">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-muted-foreground">Shift Progress</span>
                  <span className="font-bold text-foreground tabular-nums">
                    {shiftCountdownInfo.isComplete
                      ? 'Shift Completed'
                      : `${shiftCountdownInfo.text} remaining`}
                  </span>
                </div>
                <div className="w-full bg-secondary/80 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-1000 ease-linear"
                    style={{ width: `${shiftCountdownInfo.percent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                  <span>First punch: {firstClockIn ? fmt12h(firstClockIn) : '—'}</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {shiftCountdownInfo.percent}% completed
                  </span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 py-1">
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Clock size={11} className="text-primary" /> Active Time Today
                  </span>
                  <p className="text-lg font-bold text-foreground mt-0.5">
                    {formatDuration(todayWorkedMinutes)}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30 border border-border/40">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Activity size={11} className="text-primary" /> Shift Target
                  </span>
                  <p className="text-lg font-bold text-foreground mt-0.5">
                    {salaryMetrics.shiftHours} hrs
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right: Big Focused Action Button & Punches Count */}
          <div className="flex flex-col items-stretch sm:items-end w-full lg:w-auto shrink-0 gap-2">
            {isClockedIn ? (
              <Button
                type="button"
                size="lg"
                variant="destructive"
                className="w-full sm:w-52 h-12 sm:h-14 rounded-xl font-semibold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-sm hover:shadow transition-all active:scale-[0.98]"
                onClick={() => setIsPunchOutConfirmOpen(true)}
                disabled={punchOutMutation.isPending}
              >
                <LogOut size={18} />
                <span>{punchOutMutation.isPending ? 'Processing...' : 'Clock Out'}</span>
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                className="w-full sm:w-52 h-12 sm:h-14 rounded-xl font-semibold text-sm sm:text-base bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-2.5 shadow-sm hover:shadow transition-all active:scale-[0.98]"
                onClick={() => setIsPunchInConfirmOpen(true)}
                disabled={punchInMutation.isPending}
              >
                <LogIn size={18} />
                <span>{punchInMutation.isPending ? 'Processing...' : 'Clock In'}</span>
              </Button>
            )}

            <div className="text-xs text-muted-foreground font-medium flex items-center justify-center sm:justify-end gap-1.5">
              <span>
                {punchCount} {punchCount === 1 ? 'punch' : 'punches'} recorded today
              </span>
              {punchTimeline.length > 0 && (
                <>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => setIsTimelineModalOpen(true)}
                    className="text-primary hover:underline font-semibold cursor-pointer"
                  >
                    View sequence
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Weekday Present', value: data?.monthSummary?.present || 0, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
          { label: 'Weekday Absent', value: data?.monthSummary?.absent || 0, icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-500/10' },
          { label: 'Sunday Present', value: data?.monthSummary?.sundayPresent || 0, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
          { label: 'Sunday Absent', value: data?.monthSummary?.sundayAbsent || 0, icon: XCircle, color: 'text-amber-600', bg: 'bg-amber-500/10' },
        ].map((stat, i) => (
          <Card key={i} className="p-4 border-border/70 shadow-sm flex flex-col justify-between h-28 hover:shadow-md transition-all">
            <div className="flex justify-between items-start">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{stat.label}</span>
              <div className={`p-1.5 rounded-lg ${stat.bg}`}>
                <stat.icon size={16} className={stat.color} />
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight mt-2 text-foreground">{stat.value}</div>
          </Card>
        ))}
      </div>

      {/* Row 1: Attendance Calendar & Requests Subgrid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <AttendanceCalendarCard
          initialYear={currentYear}
          initialMonth={currentMonthNum}
          todayDate={now}
        />
        <RequestsStatusCard />
      </div>

      {/* Row 2: Reimagined Weekly Activity & Today's Punch Timeline Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left (7 cols): Reimagined Clean Weekly Activity Card */}
        <div className="lg:col-span-7 flex flex-col">
          <Card className="rounded-2xl border border-border/70 shadow-sm bg-card p-5 sm:p-6 flex flex-col justify-between h-full">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-primary/10 rounded-xl text-primary shrink-0">
                  <Activity size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground tracking-tight">
                      Weekly Activity
                    </h3>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
                      Last 7 Days
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Logged working hours vs {salaryMetrics.shiftHours}h shift benchmark
                  </p>
                </div>
              </div>

              {/* Quick Summary Badges */}
              <div className="flex items-center gap-2 text-xs">
                <div className="px-3 py-1.5 rounded-xl bg-muted/40 border border-border/40 flex items-center gap-1.5">
                  <span className="text-muted-foreground text-[11px]">Total:</span>
                  <span className="font-bold text-foreground">{weeklyStats.totalHours} hrs</span>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-muted/40 border border-border/40 flex items-center gap-1.5">
                  <span className="text-muted-foreground text-[11px]">Avg:</span>
                  <span className="font-bold text-foreground">{weeklyStats.avgHours} h/d</span>
                </div>
              </div>
            </div>

            {/* 7-Day Chart Area */}
            <div className="py-4 my-auto">
              <div className="grid grid-cols-7 gap-2 sm:gap-3 items-end h-44 pb-2 pt-3">
                {weeklyDaysData.map((day, idx) => {
                  const isFull = day.percent >= 90;
                  const isPartial = day.hours > 0 && !isFull;

                  return (
                    <div key={idx} className="flex flex-col items-center h-full justify-end group relative">
                      {/* Floating tooltip */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-9 bg-popover text-popover-foreground text-[11px] font-medium px-2.5 py-1 rounded-lg shadow-md pointer-events-none whitespace-nowrap z-20 border border-border flex items-center gap-1.5">
                        <span>{day.dayLabel}, {day.dateNum}:</span>
                        <span className="font-bold text-foreground">{day.hours}h</span>
                        {day.isSunday && <span className="text-muted-foreground text-[10px]">(Sunday)</span>}
                      </div>

                      {/* Bar Track */}
                      <div
                        className={`w-full max-w-[36px] sm:max-w-[42px] h-full flex flex-col justify-end p-1 rounded-xl transition-all ${
                          day.isToday
                            ? 'bg-primary/5 ring-2 ring-primary/25'
                            : 'bg-muted/30 hover:bg-muted/50'
                        }`}
                      >
                        {/* Bar Fill */}
                        <div
                          className={`w-full rounded-lg transition-all duration-700 ${
                            day.isToday
                              ? 'bg-primary shadow-sm'
                              : isFull
                              ? 'bg-emerald-500 hover:bg-emerald-600'
                              : isPartial
                              ? 'bg-teal-400/85 hover:bg-teal-500'
                              : day.isSunday
                              ? 'bg-zinc-300 dark:bg-zinc-700'
                              : 'bg-muted-foreground/20'
                          }`}
                          style={{ height: `${Math.max(6, Math.min(100, day.percent))}%` }}
                        />
                      </div>

                      {/* Day Label & Hours */}
                      <div className="text-center mt-2 space-y-0.5">
                        <div
                          className={`text-[11px] font-bold ${
                            day.isToday ? 'text-primary' : 'text-foreground'
                          }`}
                        >
                          {day.dayLabel}
                        </div>
                        <div
                          className={`text-[10px] tabular-nums font-medium ${
                            day.hours > 0 ? 'text-muted-foreground' : 'text-muted-foreground/50'
                          }`}
                        >
                          {day.hours > 0 ? `${day.hours}h` : '—'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer Summary */}
            <div className="pt-3 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span>
                  Shift Target Met: <strong className="text-foreground font-semibold">{weeklyStats.targetMetDays} / 7 days</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-primary shrink-0" />
                <span>
                  Today: <strong className="text-foreground font-semibold">{formatDuration(todayWorkedMinutes)}</strong>
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* Right (5 cols): Today's Punch Timeline & Sequence Card */}
        <div className="lg:col-span-5 flex flex-col">
          <Card className="rounded-2xl border border-border/70 shadow-sm bg-card p-5 sm:p-6 flex flex-col justify-between h-full">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-border/50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-600 shrink-0">
                  <Clock size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground tracking-tight">
                    Today's Punch Timeline
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    {punchTimeline.length} {punchTimeline.length === 1 ? 'event' : 'events'} recorded today
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-muted text-muted-foreground">
                {formatDuration(todayWorkedMinutes)} Active
              </span>
            </div>

            {/* Punch Sequence List */}
            <div className="flex-1 py-3 my-auto min-h-[160px] flex flex-col justify-center">
              {punchTimeline.length === 0 ? (
                <div className="text-center py-6">
                  <Clock size={28} className="mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-xs font-medium text-muted-foreground">No punches recorded today yet</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    Click Clock In above to begin tracking your work shift
                  </p>
                </div>
              ) : (
                <div className="space-y-0 max-h-52 overflow-y-auto pr-1">
                  {punchTimeline.map((item, index) => {
                    const isLast = index === punchTimeline.length - 1;
                    return (
                      <div key={item.id || index} className="flex items-start gap-3 relative pb-3 group">
                        {!isLast && (
                          <div className="absolute left-[11px] top-6 bottom-0 w-[2px] bg-border/60" />
                        )}
                        <div
                          className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${
                            item.type === 'IN'
                              ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-600 border border-rose-500/30'
                          }`}
                        >
                          {item.type === 'IN' ? <LogIn size={11} /> : <LogOut size={11} />}
                        </div>
                        <div className="flex-1 flex items-center justify-between text-xs min-w-0 pt-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">Punch #{item.num}</span>
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                                item.type === 'IN'
                                  ? 'bg-emerald-500/10 text-emerald-600'
                                  : 'bg-rose-500/10 text-rose-600'
                              }`}
                            >
                              {item.type === 'IN' ? 'IN' : 'OUT'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-medium text-foreground/90">{fmt12h(item.time)}</span>
                            {item.sessionText && (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
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

            {/* Footer */}
            <div className="pt-3 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Shift: {salaryMetrics.shiftName} ({fmt12h(salaryMetrics.shiftStart)} – {fmt12h(salaryMetrics.shiftEnd)})</span>
              <span>Rate: ₹{salaryMetrics.hourRate}/hr</span>
            </div>
          </Card>
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

      {/* Quick Punches Sequence Modal */}
      <Dialog open={isTimelineModalOpen} onOpenChange={setIsTimelineModalOpen}>
        <DialogContent className="sm:max-w-[420px] rounded-2xl p-6">
          <DialogHeader className="pb-3 border-b border-border/40">
            <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
              <Clock size={18} className="text-primary" /> Today's Punch Sequence
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 max-h-72 overflow-y-auto space-y-2 pr-1">
            {punchTimeline.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                No punches recorded today yet.
              </div>
            ) : (
              punchTimeline.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30 border border-border/40"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        item.type === 'IN'
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : 'bg-rose-500/15 text-rose-600'
                      }`}
                    >
                      {item.type}
                    </span>
                    <span className="text-xs font-semibold text-foreground">Punch #{item.num}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono font-medium text-foreground">{fmt12h(item.time)}</span>
                    {item.sessionText && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        {item.sessionText}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsTimelineModalOpen(false)}
              className="w-full rounded-xl text-xs"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
