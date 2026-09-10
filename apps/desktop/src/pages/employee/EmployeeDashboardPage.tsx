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
  BarChart3,
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  Calendar,
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

      {/* Minimalist Dashboard Layout */}
      <div className="space-y-6">
        
        {/* HERO SHIFT BLOCK (Match Image 3) */}
        <div className="w-full rounded-[28px] overflow-hidden bg-gradient-to-br from-[#1a3a7b] to-[#122550] border border-[#2d4d94] shadow-xl p-8 relative flex flex-col md:flex-row justify-between items-center md:items-start gap-8">
          {/* Subtle grid pattern background */}
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
          
          <div className="relative z-10 w-full max-w-xl space-y-6">
            {/* Shift Remaining & Progress */}
            {shiftCountdownInfo ? (
              <div className="space-y-3">
                <div>
                  <div className="text-3xl font-extrabold text-[#f6cf55] tracking-tight tabular-nums font-sans">
                    {shiftCountdownInfo.isComplete ? '00h 00m 00s' : shiftCountdownInfo.text}
                  </div>
                  <div className="text-[10px] font-bold text-blue-200/70 uppercase tracking-[0.2em] mt-1">
                    {shiftCountdownInfo.isComplete ? 'Shift Completed' : 'Remaining in Shift'}
                  </div>
                </div>
                
                {/* Progress Bar */}
                <div className="w-full bg-blue-950/50 rounded-full h-2.5 overflow-hidden shadow-inner border border-blue-800/30">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500 shadow-[0_0_10px_rgba(34,211,238,0.4)] transition-all duration-1000 ease-linear"
                    style={{ width: `${shiftCountdownInfo.percent}%` }}
                  />
                </div>
                
                {/* Badges */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1e4a95]/40 border border-[#2d61ba]/50 text-cyan-300 text-[11px] font-medium shadow-sm">
                    <Clock size={11} className="opacity-70" />
                    IN: {firstClockIn ? fmt12h(firstClockIn) : '—'}
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1e4a95]/40 border border-[#2d61ba]/50 text-blue-200 text-[11px] font-medium shadow-sm">
                    <Clock size={11} className="opacity-70" />
                    SHIFT: {fmt12h(salaryMetrics.shiftStart)} - {fmt12h(salaryMetrics.shiftEnd)}
                  </div>
                  <div className="flex items-center justify-center px-3 py-1 rounded-full bg-[#2a3875] border border-[#3f509e] text-indigo-300 text-[11px] font-bold shadow-sm">
                    {shiftCountdownInfo.percent}%
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-3xl font-extrabold text-white/50 tracking-tight tabular-nums font-sans">
                    Not Started
                  </div>
                  <div className="text-[10px] font-bold text-blue-200/50 uppercase tracking-[0.2em] mt-1">
                    Shift Status
                  </div>
                </div>
                <div className="w-full bg-blue-950/50 rounded-full h-2.5 overflow-hidden shadow-inner border border-blue-800/30"></div>
                <div className="flex items-center gap-3 pt-1">
                   <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1e4a95]/40 border border-[#2d61ba]/50 text-blue-200/70 text-[11px] font-medium shadow-sm">
                    <Clock size={11} className="opacity-70" />
                    SHIFT: {fmt12h(salaryMetrics.shiftStart)} - {fmt12h(salaryMetrics.shiftEnd)}
                  </div>
                </div>
              </div>
            )}

            <div className="pt-4 space-y-1">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#264585] border border-[#3b5d9b] shadow-sm mb-2">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isClockedIn ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isClockedIn ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                </span>
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">{isClockedIn ? 'Live System' : 'System Offline'}</span>
              </div>
              <div className="text-5xl md:text-6xl font-black text-white tracking-tight tabular-nums [text-shadow:0_0_30px_rgba(255,255,255,0.2)]">
                {timeString}
              </div>
              <div className="text-sm font-medium text-blue-200/80 pl-1">
                {dateString}
              </div>
            </div>
          </div>

          {/* Right Action Area */}
          <div className="relative z-10 flex flex-col items-center justify-center min-w-[200px] shrink-0 mt-6 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0 md:border-l border-blue-500/20 md:pl-10">
            {isClockedIn ? (
              <button
                type="button"
                onClick={() => setIsPunchOutConfirmOpen(true)}
                disabled={punchOutMutation.isPending}
                className="w-32 h-32 md:w-40 md:h-40 rounded-full bg-[#ee4343] hover:bg-[#d63a3a] border-4 border-red-400/20 shadow-[0_0_40px_rgba(238,67,67,0.4)] flex flex-col items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 group"
              >
                <LogOut size={32} className="text-white mb-1 group-hover:-translate-y-1 transition-transform" />
                <span className="text-white font-bold text-lg">Clock Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsPunchInConfirmOpen(true)}
                disabled={punchInMutation.isPending}
                className="w-32 h-32 md:w-40 md:h-40 rounded-full bg-[#10b981] hover:bg-[#059669] border-4 border-emerald-400/20 shadow-[0_0_40px_rgba(16,185,129,0.4)] flex flex-col items-center justify-center gap-2 transition-all hover:scale-105 active:scale-95 group"
              >
                <LogIn size={32} className="text-white mb-1 group-hover:translate-y-1 transition-transform" />
                <span className="text-white font-bold text-lg">Clock In</span>
              </button>
            )}
            
            <div className="mt-6 text-[11px] font-medium text-blue-200/70">
              {punchCount} {punchCount === 1 ? 'punch' : 'punches'} today
            </div>
          </div>
        </div>

        {/* 4 STATS CARDS (Match Image 4 top row) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Weekday Present', value: salaryMetrics.presentRegularDays, icon: 'bg-emerald-500/20 text-emerald-500', iconSvg: <div className="w-5 h-5 rounded bg-emerald-500 flex items-center justify-center"><CheckCircle2 size={12} className="text-emerald-950"/></div> },
            { label: 'Weekday Absent', value: Math.max(0, salaryMetrics.totalWorkingDays - salaryMetrics.presentRegularDays), icon: 'bg-rose-500/20 text-rose-500', iconSvg: <div className="w-5 h-5 rounded bg-rose-500 flex items-center justify-center"><X size={12} className="text-rose-950"/></div> },
            { label: 'Sunday Present', value: salaryMetrics.sundaysCount > 0 ? (salaryMetrics.paidSundays > 0 ? 'Yes' : '0') : '0', icon: 'bg-amber-500/20 text-amber-500', iconSvg: <div className="w-5 h-5 rounded bg-amber-500 flex items-center justify-center"><Calendar size={12} className="text-amber-950"/></div> },
            { label: 'Sunday Absent', value: salaryMetrics.sundaysCount > 0 && salaryMetrics.paidSundays === 0 ? 'Yes' : '0', icon: 'bg-amber-700/20 text-amber-700', iconSvg: <div className="w-5 h-5 rounded bg-amber-700 flex items-center justify-center"><XCircle size={12} className="text-amber-100"/></div> },
          ].map((stat, i) => (
            <div key={i} className="bg-[#1e2336] rounded-[20px] p-5 flex flex-col items-center justify-center gap-3 border border-white/5 shadow-sm">
              <div className={`p-2 rounded-xl ${stat.icon}`}>
                {stat.iconSvg}
              </div>
              <div className="text-2xl font-black text-white">{stat.value}</div>
              <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                {stat.label.includes('Present') ? <CheckCircle2 size={10} /> : <XCircle size={10} className="text-rose-400" />}
                <span className={stat.label.includes('Absent') ? 'text-rose-400' : ''}>{stat.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* WEEKLY ACTIVITY & TIMELINE (Match Image 4 bottom block) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Weekly Activity Chart */}
          <div className="lg:col-span-8 bg-[#1e2336] rounded-[24px] border border-white/5 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#2d3752] rounded-lg">
                  <BarChart3 size={18} className="text-cyan-400" />
                </div>
                <h3 className="text-lg font-bold text-white">Weekly Activity</h3>
              </div>
              <button className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/50 hover:bg-white/10 transition-colors">
                <MoreHorizontal size={16} />
              </button>
            </div>

            <div className="h-[240px] flex items-end justify-between gap-2 px-2 pb-6 border-b border-white/10 relative">
              {data?.weeklyActivity?.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-white/30 italic">No activity recorded for the past 7 days</div>
              )}
              {data?.weeklyActivity?.map((day, idx) => {
                const maxH = Math.max(...(data.weeklyActivity?.map(d => d.hours) || []), 8);
                const pct = day.hours > 0 ? Math.max(10, (day.hours / maxH) * 100) : 4;
                const dObj = new Date(day.date);
                const dayLabel = dObj.toLocaleDateString('en-US', { weekday: 'narrow' });
                const isToday = dObj.toDateString() === now.toDateString();
                
                return (
                  <div key={idx} className="flex flex-col items-center flex-1 group">
                    {/* Tooltip */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity mb-2 bg-[#2d3752] text-white text-[10px] px-2 py-1 rounded shadow-lg pointer-events-none whitespace-nowrap">
                      {day.hours} hrs
                    </div>
                    {/* Bar */}
                    <div className="w-full max-w-[40px] bg-white/5 rounded-t-xl relative overflow-hidden group-hover:bg-white/10 transition-colors" style={{ height: '180px' }}>
                      <div 
                        className={`absolute bottom-0 w-full rounded-t-xl transition-all duration-700 ${isToday ? 'bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.5)]' : 'bg-slate-400/80'}`}
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                    {/* Label */}
                    <span className={`mt-4 text-xs font-bold ${isToday ? 'text-cyan-400' : 'text-white/40'}`}>{dayLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Timeline */}
          <div className="lg:col-span-4 bg-[#1e2336] rounded-[24px] border border-white/5 p-6 shadow-sm min-h-[350px]">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-[#2d3752] rounded-lg">
                <Clock size={18} className="text-cyan-400" />
              </div>
              <h3 className="text-lg font-bold text-white">Timeline</h3>
            </div>

            <div className="space-y-0 relative pl-3">
              {/* Timeline continuous line */}
              <div className="absolute left-[17.5px] top-4 bottom-8 w-[2px] bg-white/10"></div>
              
              {punchTimeline.length === 0 ? (
                 <p className="text-xs text-white/40 italic py-4 text-center">No punches recorded today</p>
              ) : (
                punchTimeline.map((item, idx) => (
                  <div key={idx} className="relative pl-10 pb-8 last:pb-2">
                    {/* Dot */}
                    <div className={`absolute left-[-5px] top-1 w-3 h-3 rounded-full border-[3px] border-[#1e2336] ${item.type === 'IN' ? 'bg-cyan-400' : 'bg-rose-400'}`} />
                    
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-sm font-bold text-white">
                          Clocked {item.type === 'IN' ? 'In' : 'Out'}
                        </div>
                        <div className="text-[11px] text-white/50 mt-1">
                          {fmt12h(item.time)}
                        </div>
                      </div>
                      <div className={`px-3 py-1 rounded text-[10px] font-bold ${item.type === 'IN' ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-800/50' : 'bg-rose-900/40 text-rose-400 border border-rose-800/50'}`}>
                        {item.type}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {punchTimeline.length > 0 && (
                <div className="relative pl-10 pt-4 text-[11px] text-white/30 italic">
                  End of timeline
                </div>
              )}
            </div>
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
