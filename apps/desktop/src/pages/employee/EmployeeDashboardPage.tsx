import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi, attendanceApi, announcementsApi, holidaysApi, employeesApi } from '@/lib/api';
import { useAuthStore } from '@/state/auth-store';
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

  // Previous month — needed so streak calculation doesn't reset at every month boundary
  const prevMonthYear = currentMonthNum === 1 ? currentYear - 1 : currentYear;
  const prevMonthNumVal = currentMonthNum === 1 ? 12 : currentMonthNum - 1;
  const prevMonthStr = `${prevMonthYear}-${String(prevMonthNumVal).padStart(2, '0')}`;
  const prevMonthLastDay = new Date(prevMonthYear, prevMonthNumVal, 0).getDate();

  const { data: prevMonthAttendance = [] } = useQuery({
    queryKey: ['attendance', 'me', prevMonthStr],
    queryFn: () => attendanceApi.mine(
      `${prevMonthStr}-01`,
      `${prevMonthStr}-${String(prevMonthLastDay).padStart(2, '0')}`,
    ),
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
      const dayLabel = d.toLocaleDateString('en-GB', { weekday: 'short' });
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

  // ---------------------------------------------------------------------------
  // Attendance Streak Calculation (Snapchat-style)
  // Rules:
  //   • PRESENT / HALF_DAY (or has punchInAt)  → streak day ✅
  //   • LEAVE / HOLIDAY / WEEKLY_OFF           → transparent (neither counts nor breaks)
  //   • Sunday / public holiday                → skipped entirely
  //   • ABSENT / no record on a working day    → breaks streak ❌
  //   • Today: if no punch yet, start from yesterday (grace period until end of day)
  // ---------------------------------------------------------------------------
  const streakData = useMemo(() => {
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const allRecords = [...(prevMonthAttendance as any[]), ...(monthAttendance as any[])];
    const recordByDate = new Map<string, any>();
    allRecords.forEach((r: any) => {
      if (!r.attendanceDate) return;
      const key = new Date(r.attendanceDate).toLocaleDateString('en-CA');
      recordByDate.set(key, r);
    });

    const holidaySet = new Set<string>(
      (holidaysList as any[]).map((h: any) => h.date?.slice(0, 10)).filter(Boolean)
    );

    const isWorkingDay = (dateStr: string) =>
      new Date(dateStr + 'T12:00:00').getDay() !== 0 && !holidaySet.has(dateStr);

    const getDayResult = (dateStr: string): 'present' | 'leave' | 'absent' => {
      const rec = recordByDate.get(dateStr);
      if (!rec) return 'absent';
      const hasPunch = Boolean(rec.punchInAt);
      if (rec.status === 'PRESENT' || rec.status === 'HALF_DAY' || hasPunch) return 'present';
      if (rec.status === 'LEAVE' || rec.status === 'HOLIDAY' || rec.status === 'WEEKLY_OFF') return 'leave';
      return 'absent';
    };

    // If today is a working day but employee hasn't punched in yet, start from yesterday
    const todayIsWorking = isWorkingDay(todayStr);
    const todayHasPunch = todayIsWorking && getDayResult(todayStr) === 'present';
    const startOffset = todayIsWorking && !todayHasPunch ? 1 : 0;

    // Walk backwards to compute current streak
    let currentStreak = 0;
    for (let i = startOffset; i <= 62; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dStr = d.toLocaleDateString('en-CA');
      if (!isWorkingDay(dStr)) continue; // skip sundays & holidays
      const result = getDayResult(dStr);
      if (result === 'present') { currentStreak++; }
      else if (result === 'leave') { continue; } // transparent — don't break
      else { break; } // absent → streak ends
    }

    // Tier classification
    const tier =
      currentStreak === 0 ? 0
      : currentStreak <= 4 ? 1
      : currentStreak <= 9 ? 2
      : currentStreak <= 14 ? 3
      : currentStreak <= 20 ? 4
      : currentStreak <= 25 ? 5 : 6;

    const TIER_INFO = [
      { emoji: '💤', label: 'No Streak Yet' },
      { emoji: '🔥', label: 'Getting Started' },
      { emoji: '🔥', label: 'On Fire!' },
      { emoji: '⚡', label: 'Electrifying' },
      { emoji: '🌟', label: 'Superstar!' },
      { emoji: '💎', label: 'Diamond' },
      { emoji: '👑', label: 'Legendary!' },
    ];

    // Next milestone progress
    const THRESHOLDS = [1, 5, 10, 15, 21, 26] as const;
    const nextThreshIdx = THRESHOLDS.findIndex(t => currentStreak < t);
    const nextMilestone = nextThreshIdx >= 0 ? (() => {
      const nextT = THRESHOLDS[nextThreshIdx] ?? 26;
      const prevT = nextThreshIdx === 0 ? 0 : (THRESHOLDS[nextThreshIdx - 1] ?? 0);
      const progress = prevT === nextT ? 100 : Math.round(((currentStreak - prevT) / (nextT - prevT)) * 100);
      const targetTier = TIER_INFO[Math.min(nextThreshIdx + 1, 6)] ?? TIER_INFO[6]!;
      return {
        daysLeft: nextT - currentStreak,
        nextEmoji: targetTier.emoji,
        nextLabel: targetTier.label,
        progress: Math.max(0, Math.min(100, progress)),
      };
    })() : null;

    const currentTier = TIER_INFO[tier] ?? TIER_INFO[0]!;

    return {
      currentStreak,
      tier,
      emoji: currentTier.emoji,
      label: currentTier.label,
      nextMilestone,
      isActive: currentStreak > 0,
    };
  }, [monthAttendance, prevMonthAttendance, holidaysList, now.getDate(), now.getMonth(), now.getFullYear()]);

  if (isLoading || !data) {
    return <div className="p-12 text-center text-muted-foreground animate-pulse text-sm">Loading dashboard...</div>;
  }

  const hours = String(now.getHours() % 12 || 12).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ampm = now.getHours() >= 12 ? 'pm' : 'am';

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const formattedDate = `${dayNames[now.getDay()]}, ${now.getDate()} ${monthNamesShort[now.getMonth()]}, ${now.getFullYear()}`;

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
    <div className="relative space-y-7 max-w-7xl mx-auto pb-8">
      {/* Ambient background glow accents for rich claymorphism depth */}
      <div className="absolute -top-12 -right-12 -z-10 w-96 h-96 bg-emerald-100/35 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-48 -left-12 -z-10 w-96 h-96 bg-sky-100/35 rounded-full blur-3xl pointer-events-none" />

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
              className="clay-card p-4 flex items-center gap-3 relative text-sm border border-emerald-500/20 bg-emerald-50/30"
            >
              <Megaphone size={16} className="text-emerald-600 shrink-0" />
              <div className="flex-1 pr-6 text-xs text-slate-800">
                <span className="font-bold text-emerald-700 mr-2 uppercase tracking-wide text-[10px]">Announcement:</span>
                {a.message}
              </div>
              <button
                onClick={() => handleDismissAnnouncement(a.id)}
                className="text-slate-400 hover:text-slate-700 p-1 transition-colors"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-slate-200/70">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            {greeting()}, {user?.name}
          </h2>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 font-medium">
            <span className="px-2.5 py-0.5 rounded-full clay-pill text-slate-600 font-semibold text-[11px]">{employee?.department?.name || 'General'}</span>
            <span>•</span>
            <span>{salaryMetrics.shiftName} ({fmt12h(salaryMetrics.shiftStart)} – {fmt12h(salaryMetrics.shiftEnd)})</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/me/salary">
            <button className="clay-button-subtle px-4 py-2 text-xs font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer">
              <IndianRupee size={14} className="text-slate-500" />
              <span>Salary Slip</span>
            </button>
          </Link>
          <Link to="/me/attendance">
            <button className="clay-button-subtle px-4 py-2 text-xs font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer">
              <CalendarDays size={14} className="text-slate-500" />
              <span>Attendance Log</span>
            </button>
          </Link>
        </div>
      </div>

      {/* Top Hero: Focused Claymorphic Clock, 3 Metric Pods & Circular Action Button Sticked on Wall */}
      <div className="relative py-2 transition-all duration-300">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left (4 cols): Status Badge, Digital Clock, Date & Shift Info (Sticked on Wall) */}
          <div className="lg:col-span-4 flex flex-col items-start gap-1.5 min-w-0">
            {/* Status Badge + Date */}
            <div className="flex items-center gap-3">
              <div
                className={`inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-semibold ${
                  isClockedIn
                    ? 'bg-emerald-50 text-emerald-700 shadow-[inset_0_2px_3px_rgba(255,255,255,0.9),inset_0_-1.5px_2px_rgba(5,150,105,0.15),0_2px_5px_rgba(16,185,129,0.1)] border border-emerald-400/30'
                    : 'clay-pill text-slate-600'
                }`}
              >
                <span className="relative flex h-2 w-2">
                  {isClockedIn ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </>
                  ) : (
                    <span className="inline-flex rounded-full h-2 w-2 bg-slate-400" />
                  )}
                </span>
                <span>{isClockedIn ? 'Clocked In' : 'Clocked Out'}</span>
              </div>
              <span className="text-xs sm:text-[13px] font-semibold text-slate-500 tracking-normal">
                {formattedDate}
              </span>
            </div>

            {/* Digital Clock */}
            <div className="flex items-baseline mt-1 font-sans">
              <span className="text-4xl sm:text-5xl lg:text-[54px] font-extrabold tracking-tight text-slate-900 tabular-nums">
                {hours} : {minutes} : {seconds}
              </span>
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-800 ml-2 tracking-tight">
                {ampm}
              </span>
            </div>

            {/* Subtitle with Shift info */}
            <p className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-0.5">
              <Clock size={13} className="text-slate-400 shrink-0" />
              <span>{salaryMetrics.shiftName} Shift</span>
              <span>•</span>
              <span>{fmt12h(salaryMetrics.shiftStart)} – {fmt12h(salaryMetrics.shiftEnd)}</span>
              {firstClockIn && (
                <>
                  <span>•</span>
                  <span>First: {fmt12h(firstClockIn)}</span>
                </>
              )}
            </p>
          </div>

          {/* Center (5 cols): The 3 Middle Boxes (Sticked on Wall) */}
          <div className="lg:col-span-5 flex flex-col gap-2.5 w-full">
            {/* Top row: 2 Equal Metric Pods */}
            <div className="grid grid-cols-2 gap-3 w-full">
              {/* Box 1: ACTIVE TIME TODAY */}
              <div className="clay-pod p-3.5 flex flex-col justify-between h-[82px]">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <Clock size={13} className="text-slate-400 shrink-0" />
                  <span className="truncate">Active Time Today</span>
                </div>
                <div className="text-2xl sm:text-[26px] font-extrabold text-slate-900 tracking-tight leading-none">
                  {formatDuration(todayWorkedMinutes)}
                </div>
              </div>

              {/* Box 2: SHIFT TARGET */}
              <div className="clay-pod p-3.5 flex flex-col justify-between h-[82px]">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <Activity size={13} className="text-slate-400 shrink-0" />
                  <span className="truncate">Shift Target</span>
                </div>
                <div className="flex items-baseline leading-none">
                  <span className="text-2xl sm:text-[26px] font-extrabold text-slate-900 tracking-tight">
                    {salaryMetrics.shiftHours}
                  </span>
                  <span className="text-sm font-bold text-slate-500 ml-1.5">
                    hrs
                  </span>
                </div>
              </div>
            </div>

            {/* Box 3: Shift Progress Bar (when clocked in) or Scheduled Shift */}
            {isClockedIn && shiftCountdownInfo ? (
              <div className="clay-pod px-4 py-2.5 w-full">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 mb-1.5">
                  <span className="flex items-center gap-1.5 text-slate-700 font-bold">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Shift Progress</span>
                  </span>
                  <span className="font-bold text-emerald-600 tabular-nums">
                    {shiftCountdownInfo.isComplete ? 'Shift Completed' : `${shiftCountdownInfo.text} left`}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden shadow-[inset_0_1.5px_2px_rgba(0,0,0,0.08)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_2px_6px_rgba(16,185,129,0.4)] transition-all duration-1000 ease-linear"
                    style={{ width: `${shiftCountdownInfo.percent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium mt-1.5">
                  <span>{firstClockIn ? `Started at ${fmt12h(firstClockIn)}` : 'On track'}</span>
                  <span className="font-bold text-slate-700">{shiftCountdownInfo.percent}% completed</span>
                </div>
              </div>
            ) : (
              <div className="clay-pod px-3.5 py-2.5 flex items-center justify-between text-xs text-slate-500 font-medium">
                <span className="flex items-center gap-1.5">
                  <Clock size={12} className="text-slate-400" />
                  <span>Scheduled Shift</span>
                </span>
                <span className="font-semibold text-slate-700">
                  {fmt12h(salaryMetrics.shiftStart)} – {fmt12h(salaryMetrics.shiftEnd)}
                </span>
              </div>
            )}
          </div>

          {/* Right (3 cols): Independent Circular Clay Button Sticked on Wall */}
          <div className="lg:col-span-3 flex flex-col items-center justify-center">
            {isClockedIn ? (
              <button
                type="button"
                className="clay-btn-circle-red w-28 h-28 sm:w-32 sm:h-32 text-white flex flex-col items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed select-none"
                onClick={() => setIsPunchOutConfirmOpen(true)}
                disabled={punchOutMutation.isPending}
                title="Click to Clock Out"
              >
                <LogOut size={28} className="stroke-[2.5]" />
                <span className="font-extrabold text-xs sm:text-sm tracking-wider uppercase">
                  {punchOutMutation.isPending ? 'Saving...' : 'Clock Out'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="clay-btn-circle-green w-28 h-28 sm:w-32 sm:h-32 text-white flex flex-col items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed select-none"
                onClick={() => setIsPunchInConfirmOpen(true)}
                disabled={punchInMutation.isPending}
                title="Click to Clock In"
              >
                <LogIn size={28} className="stroke-[2.5]" />
                <span className="font-extrabold text-xs sm:text-sm tracking-wider uppercase">
                  {punchInMutation.isPending ? 'Saving...' : 'Clock In'}
                </span>
              </button>
            )}

            <div className="text-xs text-slate-400 font-medium mt-2.5 flex items-center gap-1.5">
              <span>
                {punchCount} {punchCount === 1 ? 'punch' : 'punches'} recorded today
              </span>
              {punchTimeline.length > 0 && (
                <>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => setIsTimelineModalOpen(true)}
                    className="text-emerald-600 hover:text-emerald-700 font-semibold underline underline-offset-2 cursor-pointer"
                  >
                    View sequence
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Attendance Streak & Monthly Breakdown Banner ── */}
      <div className={`clay-card p-5 sm:p-6 relative overflow-hidden transition-all duration-500 ${
        streakData.tier >= 6
          ? 'bg-gradient-to-br from-purple-50/70 via-violet-50/40 to-white border-purple-200/50'
          : streakData.tier >= 5
          ? 'bg-gradient-to-br from-blue-50/70 via-indigo-50/40 to-white border-blue-200/50'
          : streakData.tier >= 4
          ? 'bg-gradient-to-br from-amber-50/70 via-yellow-50/40 to-white border-amber-200/50'
          : streakData.tier >= 3
          ? 'bg-gradient-to-br from-yellow-50/70 via-amber-50/40 to-white border-yellow-200/50'
          : streakData.isActive
          ? 'bg-gradient-to-br from-orange-50/70 via-amber-50/40 to-white border-orange-200/50'
          : 'bg-white/95 border-slate-200/60'
      }`}>
        <div className="relative z-10 grid grid-cols-1 xl:grid-cols-12 gap-5 xl:gap-6 items-center">
          {/* LEFT (4 cols): Emoji Pod + Streak Count + Milestone Label & Progress Bar below */}
          <div className="xl:col-span-4 flex flex-col justify-center min-w-0 pr-0 xl:pr-3">
            <div className="flex items-center gap-3.5 min-w-0">
              <div
                className={`clay-pod w-16 h-16 sm:w-18 sm:h-18 flex items-center justify-center text-4xl sm:text-[42px] select-none shrink-0 ${
                  streakData.isActive ? '' : 'opacity-30 grayscale'
                }`}
                title={streakData.label}
              >
                {streakData.emoji}
              </div>

              <div className="min-w-0">
                <div className="flex items-end gap-1.5">
                  <span className={`text-3xl sm:text-4xl font-black tabular-nums leading-none ${
                    streakData.tier >= 6 ? 'text-purple-600'
                    : streakData.tier >= 5 ? 'text-blue-600'
                    : streakData.tier >= 4 ? 'text-amber-600'
                    : streakData.tier >= 3 ? 'text-yellow-600'
                    : streakData.isActive ? 'text-orange-600'
                    : 'text-slate-400'
                  }`}>
                    {streakData.currentStreak}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-slate-500 pb-0.5">
                    day{streakData.currentStreak !== 1 ? 's' : ''} streak
                  </span>
                </div>

                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                    streakData.tier >= 6 ? 'bg-purple-100 text-purple-700 border border-purple-200 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]'
                    : streakData.tier >= 5 ? 'bg-blue-100 text-blue-700 border border-blue-200 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]'
                    : streakData.tier >= 4 ? 'bg-amber-100 text-amber-700 border border-amber-200 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]'
                    : streakData.tier >= 3 ? 'bg-yellow-100 text-yellow-700 border border-yellow-200 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]'
                    : streakData.isActive ? 'bg-orange-100 text-orange-700 border border-orange-200 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]'
                    : 'clay-pill text-slate-500'
                  }`}>
                    {streakData.label}
                  </span>
                  {!streakData.isActive && (
                    <span className="text-xs text-slate-400 font-medium">Start today! 💪</span>
                  )}
                </div>
              </div>
            </div>

            {/* Next milestone progress bar (Below streak info) */}
            {streakData.nextMilestone && streakData.isActive && (
              <div className="mt-3 w-full max-w-[270px]">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 mb-1">
                  <span className="flex items-center gap-1">
                    <span>Next:</span>
                    <span>{streakData.nextMilestone.nextEmoji}</span>
                    <span className="font-bold text-slate-700">{streakData.nextMilestone.nextLabel}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-medium">
                    {streakData.nextMilestone.daysLeft} more day{streakData.nextMilestone.daysLeft !== 1 ? 's' : ''} to unlock
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden shadow-[inset_0_1.5px_2px_rgba(0,0,0,0.08)]">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      streakData.tier >= 5 ? 'bg-gradient-to-r from-purple-500 to-violet-400 shadow-[0_2px_6px_rgba(168,85,247,0.4)]'
                      : streakData.tier >= 4 ? 'bg-gradient-to-r from-amber-500 to-yellow-400 shadow-[0_2px_6px_rgba(245,158,11,0.4)]'
                      : streakData.tier >= 3 ? 'bg-gradient-to-r from-yellow-500 to-amber-400 shadow-[0_2px_6px_rgba(234,179,8,0.4)]'
                      : 'bg-gradient-to-r from-orange-500 to-amber-400 shadow-[0_2px_6px_rgba(249,115,22,0.4)]'
                    }`}
                    style={{ width: `${streakData.nextMilestone.progress}%` }}
                  />
                </div>
              </div>
            )}
            {!streakData.nextMilestone && streakData.isActive && (
              <div className="mt-2.5 flex items-center gap-1.5 text-xs font-bold text-purple-600">
                <span>Maximum Tier Unlocked!</span>
                <span className="text-base">👑</span>
              </div>
            )}
          </div>

          {/* RIGHT (8 cols): 4 Smart Attendance Stat Pods + Sunday & Holiday Earned Strip */}
          <div className="xl:col-span-8 w-full">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 w-full">
              {[
                { 
                  prefix: 'Weekday', 
                  suffix: 'Present',
                  value: data?.monthSummary?.present || 0, 
                  icon: CheckCircle2, 
                  color: 'text-emerald-600', 
                  bg: 'bg-emerald-50 text-emerald-600' 
                },
                { 
                  prefix: 'Weekday', 
                  suffix: 'Absent',
                  value: data?.monthSummary?.absent || 0, 
                  icon: XCircle, 
                  color: 'text-rose-600', 
                  bg: 'bg-rose-50 text-rose-600' 
                },
                { 
                  prefix: 'Sunday', 
                  suffix: 'Present',
                  value: data?.monthSummary?.sundayPresent || 0, 
                  icon: CheckCircle2, 
                  color: 'text-emerald-600', 
                  bg: 'bg-emerald-50 text-emerald-600' 
                },
                { 
                  prefix: 'Sunday', 
                  suffix: 'Absent',
                  value: data?.monthSummary?.sundayAbsent || 0, 
                  icon: XCircle, 
                  color: 'text-amber-600', 
                  bg: 'bg-amber-50 text-amber-600' 
                },
              ].map((stat, i) => (
                <div 
                  key={i} 
                  className="clay-pod p-3 flex flex-col justify-between h-[80px] hover:-translate-y-0.5 transition-transform duration-200"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                        {stat.prefix}
                      </span>
                      <span className="text-[11px] sm:text-xs font-extrabold text-slate-700 uppercase tracking-tight whitespace-nowrap">
                        {stat.suffix}
                      </span>
                    </div>
                    <div className={`p-1 rounded-full clay-pill ${stat.bg} shrink-0`}>
                      <stat.icon size={13} className={stat.color} />
                    </div>
                  </div>
                  <div className="text-2xl sm:text-[26px] font-extrabold tracking-tight text-slate-900 leading-none tabular-nums">
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Sunday & Holiday Earned Strip ── */}
            {(() => {
              const { presentRegularDays, paidSundays, paidHolidays, sundaysCount, holidaysCount } = salaryMetrics;
              const totalPaidOff = paidSundays + paidHolidays;
              const totalAvailOff = sundaysCount + holidaysCount;

              // Tier labels matching old system: ≥18 → all, 12-17 → 2, 5-11 → 1, <5 → 0
              const tierLabel =
                presentRegularDays >= 18 ? 'All earned 🎉'
                : presentRegularDays >= 12 ? '2 days earned'
                : presentRegularDays >= 5  ? '1 day earned'
                : 'None yet';

              const nextThreshold =
                presentRegularDays < 5  ? 5
                : presentRegularDays < 12 ? 12
                : presentRegularDays < 18 ? 18
                : null;

              const prevThreshold =
                presentRegularDays < 5  ? 0
                : presentRegularDays < 12 ? 5
                : presentRegularDays < 18 ? 12
                : 18;

              const progressPct = nextThreshold !== null
                ? Math.round(((presentRegularDays - prevThreshold) / (nextThreshold - prevThreshold)) * 100)
                : 100;

              const isFullyEarned = nextThreshold === null;

              const accentColor = isFullyEarned
                ? 'text-emerald-600'
                : presentRegularDays >= 12 ? 'text-amber-600'
                : presentRegularDays >= 5  ? 'text-orange-500'
                : 'text-slate-400';

              const barColor = isFullyEarned
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                : presentRegularDays >= 12 ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                : presentRegularDays >= 5  ? 'bg-gradient-to-r from-orange-400 to-amber-300'
                : 'bg-slate-300';

              const moodIcon = isFullyEarned ? '🏖️' : presentRegularDays >= 12 ? '🌤️' : presentRegularDays >= 5 ? '⛅' : '🌧️';

              return (
                <div className="mt-2.5 clay-pod px-3.5 py-2.5 flex items-center gap-3">
                  <div className={`text-xl shrink-0 leading-none ${isFullyEarned ? '' : 'opacity-75'}`}>
                    {moodIcon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                          Sunday &amp; Holiday Earned
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 whitespace-nowrap ${accentColor}`}>
                          {tierLabel}
                        </span>
                      </div>
                      <span className={`text-sm font-extrabold tabular-nums shrink-0 ${accentColor}`}>
                        {totalPaidOff}
                        <span className="text-[11px] font-bold text-slate-400">/{totalAvailOff}</span>
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-200/80 rounded-full overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    {!isFullyEarned ? (
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                        {presentRegularDays} present · {nextThreshold! - presentRegularDays} more to {nextThreshold === 5 ? 'earn 1st paid day' : nextThreshold === 12 ? 'earn 2 paid days' : 'earn all'}
                      </p>
                    ) : (
                      <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                        All {totalAvailOff} off-day{totalAvailOff !== 1 ? 's' : ''} paid · Great work! 🌟
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Decorative large background emoji */}
        {streakData.isActive && (
          <div className="absolute -right-3 -bottom-4 text-[120px] sm:text-[150px] opacity-[0.04] select-none pointer-events-none leading-none">
            {streakData.emoji}
          </div>
        )}
      </div>

      {/* Row 1: Attendance Calendar & Requests Subgrid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6 items-start">
        <AttendanceCalendarCard
          initialYear={currentYear}
          initialMonth={currentMonthNum}
          todayDate={now}
        />
        <RequestsStatusCard />
      </div>

      {/* Row 2: Claymorphic Weekly Activity & Today's Punch Timeline Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch">
        {/* Left (7 cols): Claymorphic Weekly Activity Card */}
        <div className="lg:col-span-7 flex flex-col">
          <div className="clay-card p-6 sm:p-7 flex flex-col justify-between h-full">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200/60">
              <div className="flex items-center gap-3">
                <div className="p-2.5 clay-pod text-emerald-600 shrink-0">
                  <Activity size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                      Weekly Activity
                    </h3>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                      Last 7 Days
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Logged working hours vs {salaryMetrics.shiftHours}h shift benchmark
                  </p>
                </div>
              </div>

              {/* Quick Summary Badges */}
              <div className="flex items-center gap-2 text-xs">
                <div className="px-3.5 py-1.5 rounded-xl clay-pod flex items-center gap-1.5">
                  <span className="text-slate-500 text-[11px] font-medium">Total:</span>
                  <span className="font-bold text-slate-900">{weeklyStats.totalHours} hrs</span>
                </div>
                <div className="px-3.5 py-1.5 rounded-xl clay-pod flex items-center gap-1.5">
                  <span className="text-slate-500 text-[11px] font-medium">Avg:</span>
                  <span className="font-bold text-slate-900">{weeklyStats.avgHours} h/d</span>
                </div>
              </div>
            </div>

            {/* 7-Day Chart Area */}
            <div className="py-5 my-auto">
              <div className="grid grid-cols-7 gap-2 sm:gap-3.5 items-end h-44 pb-2 pt-3">
                {weeklyDaysData.map((day, idx) => {
                  const isFull = day.percent >= 90;
                  const isPartial = day.hours > 0 && !isFull;

                  return (
                    <div key={idx} className="flex flex-col items-center h-full justify-end group relative">
                      {/* Floating tooltip */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-9 bg-slate-900 text-white text-[11px] font-medium px-2.5 py-1 rounded-lg shadow-lg pointer-events-none whitespace-nowrap z-20 flex items-center gap-1.5">
                        <span>{day.dayLabel}, {day.dateNum}:</span>
                        <span className="font-bold text-emerald-400">{day.hours}h</span>
                        {day.isSunday && <span className="text-slate-400 text-[10px]">(Sunday)</span>}
                      </div>

                      {/* Bar Track */}
                      <div
                        className={`w-full max-w-[38px] sm:max-w-[44px] h-full flex flex-col justify-end p-1 rounded-2xl transition-all ${
                          day.isToday
                            ? 'bg-emerald-50/80 ring-2 ring-emerald-500/30 shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)]'
                            : 'bg-slate-100/80 hover:bg-slate-200/60 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.05)]'
                        }`}
                      >
                        {/* Bar Fill */}
                        <div
                          className={`w-full rounded-xl transition-all duration-700 shadow-sm ${
                            day.isToday
                              ? 'bg-gradient-to-t from-emerald-600 to-emerald-400'
                              : isFull
                              ? 'bg-gradient-to-t from-emerald-500 to-teal-400'
                              : isPartial
                              ? 'bg-gradient-to-t from-teal-400 to-cyan-300'
                              : day.isSunday
                              ? 'bg-slate-300'
                              : 'bg-slate-200'
                          }`}
                          style={{ height: `${Math.max(8, Math.min(100, day.percent))}%` }}
                        />
                      </div>

                      {/* Day Label & Hours */}
                      <div className="text-center mt-2.5 space-y-0.5">
                        <div
                          className={`text-[11px] font-bold ${
                            day.isToday ? 'text-emerald-600' : 'text-slate-800'
                          }`}
                        >
                          {day.dayLabel}
                        </div>
                        <div
                          className={`text-[10px] tabular-nums font-semibold ${
                            day.hours > 0 ? 'text-slate-500' : 'text-slate-400'
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
            <div className="pt-3.5 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] shrink-0" />
                <span>
                  Shift Target Met: <strong className="text-slate-900 font-bold">{weeklyStats.targetMetDays} / 7 days</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-teal-500 shadow-[0_0_8px_rgba(20,184,166,0.5)] shrink-0" />
                <span>
                  Today: <strong className="text-slate-900 font-bold">{formatDuration(todayWorkedMinutes)}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right (5 cols): Claymorphic Today's Punch Timeline & Sequence Card */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="clay-card p-6 sm:p-7 flex flex-col justify-between h-full">
            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-200/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 clay-pod text-emerald-600 shrink-0">
                  <Clock size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                    Today's Punch Timeline
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {punchTimeline.length} {punchTimeline.length === 1 ? 'event' : 'events'} recorded today
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold px-3 py-1 rounded-xl clay-pod text-slate-700">
                {formatDuration(todayWorkedMinutes)} Active
              </span>
            </div>

            {/* Punch Sequence List */}
            <div className="flex-1 py-3.5 my-auto min-h-[160px] flex flex-col justify-center">
              {punchTimeline.length === 0 ? (
                <div className="text-center py-6">
                  <Clock size={32} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-xs font-bold text-slate-600">No punches recorded today yet</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
                    Click Clock In above to begin tracking your work shift
                  </p>
                </div>
              ) : (
                <div className="space-y-0 max-h-52 overflow-y-auto pr-1">
                  {punchTimeline.map((item, index) => {
                    const isLast = index === punchTimeline.length - 1;
                    return (
                      <div key={item.id || index} className="flex items-start gap-3 relative pb-3.5 group">
                        {!isLast && (
                          <div className="absolute left-[13px] top-6 bottom-0 w-[2px] bg-slate-200" />
                        )}
                        <div
                          className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 shadow-sm ${
                            item.type === 'IN'
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-300 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]'
                              : 'bg-rose-50 text-rose-600 border border-rose-300 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]'
                          }`}
                        >
                          {item.type === 'IN' ? <LogIn size={12} /> : <LogOut size={12} />}
                        </div>
                        <div className="flex-1 flex items-center justify-between text-xs min-w-0 pt-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800">Punch #{item.num}</span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                item.type === 'IN'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              {item.type === 'IN' ? 'IN' : 'OUT'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-sans font-bold text-slate-700">{fmt12h(item.time)}</span>
                            {item.sessionText && (
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-md font-semibold ${
                                  item.isCurrentlyActive
                                    ? 'bg-emerald-100 text-emerald-700 animate-pulse'
                                    : 'clay-pill text-slate-600'
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
            <div className="pt-3.5 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500 font-medium">
              <span>Shift: {salaryMetrics.shiftName} ({fmt12h(salaryMetrics.shiftStart)} – {fmt12h(salaryMetrics.shiftEnd)})</span>
              <span>Rate: ₹{salaryMetrics.hourRate}/hr</span>
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
