import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { reportsApi, employeesApi, type TodayAttendanceRecord } from '@/lib/api';
import type { Employee } from '@attendance/shared';
import {
  CalendarCheck,
  Trophy,
  Users,
  LogIn,
  LogOut,
  XCircle,
  Clock,
  ArrowUpRight,
  Search,
  RefreshCw,
  Wallet,
  Sparkles,
  Award,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const AVATAR_PALETTES = [
  'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/60',
  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/80',
  'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300 border-violet-200/80 dark:border-violet-800/60',
  'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300 border-teal-200/80 dark:border-teal-800/60',
  'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60',
  'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/60',
  'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60',
];

function getAvatarPalette(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length] ?? AVATAR_PALETTES[0]!;
}

type Tab = 'attendance' | 'performance';

export function ReportsPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('attendance');

  // ─── ATTENDANCE TAB STATE ─────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [attendanceSearch, setAttendanceSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'IN' | 'LATE' | 'CHECKED_OUT' | 'ABSENT' | 'EARLY'>('ALL');

  // ─── PERFORMANCE TAB STATE ────────────────────────────────────────────────
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [hoveredAttMonth, setHoveredAttMonth] = useState<number | null>(null);
  const [hoveredSalMonth, setHoveredSalMonth] = useState<number | null>(null);
  const [hoveredIncPoint, setHoveredIncPoint] = useState<number | null>(null);

  // ─── 1. FETCH TODAY'S LIVE ATTENDANCE ─────────────────────────────────────
  const {
    data: todayData,
    isLoading: isLoadingAttendance,
    isRefetching: isRefetchingAttendance,
    refetch: refetchAttendance,
  } = useQuery({
    queryKey: ['reports', 'today-attendance', selectedDate],
    queryFn: () => reportsApi.todayAttendance(selectedDate || undefined),
    // Poll every 10 seconds for live punch updates
    refetchInterval: 10_000,
  });

  // ─── 2. FETCH EMPLOYEES LIST FOR PERFORMANCE DROPDOWN ─────────────────────
  const { data: employeesResponse } = useQuery({
    queryKey: ['employees', 'active-list-for-performance'],
    queryFn: () => employeesApi.list({ pageSize: '1000', status: 'ACTIVE' }),
  });

  const employeeList = useMemo(() => {
    const items = employeesResponse?.items || [];
    return [...items].sort((a, b) =>
      (a.firstName || '').localeCompare(b.firstName || '')
    );
  }, [employeesResponse?.items]);

  // Default active employee for performance tab
  const effectiveEmployeeId = useMemo(() => {
    if (selectedEmployeeId) return selectedEmployeeId;
    return employeeList[0]?.id || '';
  }, [selectedEmployeeId, employeeList]);

  // ─── 3. FETCH EMPLOYEE PERFORMANCE DATA ───────────────────────────────────
  const {
    data: perfData,
    isLoading: isLoadingPerf,
    isRefetching: isRefetchingPerf,
    refetch: refetchPerformance,
  } = useQuery({
    queryKey: ['reports', 'performance', effectiveEmployeeId, selectedYear],
    queryFn: () => reportsApi.performance(effectiveEmployeeId || undefined, selectedYear),
    enabled: Boolean(effectiveEmployeeId),
  });

  // ─── 4. SALARY INCREMENT & BASE PAY PROGRESSION TIMELINE ─────────────────
  const { incrementTimelineData, incrementStats } = useMemo(() => {
    if (!perfData) {
      return {
        incrementTimelineData: [] as Array<{
          key: string;
          label: string;
          fullLabel: string;
          salary: number;
          incrementFromPrev: number;
          incrementFromStart: number;
          growthPctFromStart: number;
          isRevisionMonth: boolean;
          revisionNote: string | null;
        }>,
        incrementStats: {
          startingSalary: 0,
          currentSalary: 0,
          totalIncrement: 0,
          growthPct: 0,
          revisionsCount: 0,
        },
      };
    }

    const rawHistory = [...(perfData.salaryHistory || [])].map((h) => ({
      amount: Number(h.amount || 0),
      date: new Date(h.effectiveFrom),
      key: h.effectiveFrom.slice(0, 7),
      note: h.note || null,
      rawDate: h.effectiveFrom,
    })).sort((a, b) => a.date.getTime() - b.date.getTime());

    // Sequence of months
    let startYear = selectedYear;
    let startMonth = 1;

    if (perfData.employee.joiningDate) {
      const jDate = new Date(perfData.employee.joiningDate);
      if (!isNaN(jDate.getTime())) {
        startYear = jDate.getFullYear();
        startMonth = jDate.getMonth() + 1;
      }
    } else if (rawHistory.length > 0 && rawHistory[0]?.date) {
      startYear = rawHistory[0].date.getFullYear();
      startMonth = rawHistory[0].date.getMonth() + 1;
    } else {
      startYear = selectedYear - 1;
      startMonth = 1;
    }

    const now = new Date();
    let endYear = selectedYear;
    let endMonth = 12;

    if (selectedYear === now.getFullYear()) {
      endMonth = Math.max(now.getMonth() + 1, 8);
    }

    if (startYear > endYear || (startYear === endYear && startMonth > endMonth)) {
      startYear = endYear - 1;
      startMonth = 1;
    }

    const months: Array<{ key: string; year: number; month: number; label: string; fullLabel: string }> = [];
    let curY = startYear;
    let curM = startMonth;

    while (curY < endYear || (curY === endYear && curM <= endMonth)) {
      const d = new Date(curY, curM - 1, 1);
      months.push({
        key: `${curY}-${String(curM).padStart(2, '0')}`,
        year: curY,
        month: curM,
        label: d.toLocaleDateString('en-IN', { month: 'short' }),
        fullLabel: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      });
      curM++;
      if (curM > 12) {
        curM = 1;
        curY++;
      }
    }

    // Ensure at least 6 months for aesthetic rendering
    if (months.length < 6) {
      const needed = 6 - months.length;
      for (let i = 0; i < needed; i++) {
        const first = months[0]!;
        let prevM = first.month - 1;
        let prevY = first.year;
        if (prevM < 1) {
          prevM = 12;
          prevY--;
        }
        const d = new Date(prevY, prevM - 1, 1);
        months.unshift({
          key: `${prevY}-${String(prevM).padStart(2, '0')}`,
          year: prevY,
          month: prevM,
          label: d.toLocaleDateString('en-IN', { month: 'short' }),
          fullLabel: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
        });
      }
    }

    const fallbackSalary = perfData.employee.baseSalary || 8000;
    const initialStartingSalary = rawHistory.length > 0 && rawHistory[0]?.amount
      ? rawHistory[0].amount
      : fallbackSalary;

    let runningBaseSalary = initialStartingSalary;

    const timeline = months.map((m, index) => {
      const endOfThisMonth = new Date(m.year, m.month, 0, 23, 59, 59);
      const applicableEntries = rawHistory.filter((h) => h.date <= endOfThisMonth);

      const prevBaseSalary = runningBaseSalary;
      let isRevisionMonth = false;
      let revisionNote: string | null = null;
      let incrementFromPrev = 0;

      if (applicableEntries.length > 0) {
        const latestApplicable = applicableEntries[applicableEntries.length - 1];
        if (latestApplicable && latestApplicable.amount > 0) {
          runningBaseSalary = latestApplicable.amount;
          const thisMonthEntry = rawHistory.find((h) => h.key === m.key);
          if (thisMonthEntry && index > 0 && thisMonthEntry.amount !== prevBaseSalary) {
            isRevisionMonth = true;
            revisionNote = thisMonthEntry.note || 'Increment';
            incrementFromPrev = runningBaseSalary - prevBaseSalary;
          }
        }
      }

      const incrementFromStart = runningBaseSalary - initialStartingSalary;
      const growthPctFromStart = initialStartingSalary > 0
        ? Number(((incrementFromStart / initialStartingSalary) * 100).toFixed(1))
        : 0;

      return {
        key: m.key,
        label: m.label,
        fullLabel: m.fullLabel,
        salary: runningBaseSalary,
        incrementFromPrev,
        incrementFromStart,
        growthPctFromStart,
        isRevisionMonth: isRevisionMonth || (index === 0 && initialStartingSalary > 0),
        revisionNote,
      };
    });

    const startingSalary = timeline[0]?.salary || initialStartingSalary;
    const currentSalary = timeline[timeline.length - 1]?.salary || fallbackSalary;
    const totalIncrement = currentSalary - startingSalary;
    const growthPct = startingSalary > 0
      ? Number(((totalIncrement / startingSalary) * 100).toFixed(1))
      : 0;
    const revisionsCount = rawHistory.length;

    return {
      incrementTimelineData: timeline,
      incrementStats: {
        startingSalary,
        currentSalary,
        totalIncrement,
        growthPct,
        revisionsCount,
      },
    };
  }, [perfData, selectedYear]);

  // ─── FILTERED TODAY'S ATTENDANCE RECORDS ──────────────────────────────────
  const filteredRecords = useMemo(() => {
    if (!todayData?.records) return [];
    return todayData.records.filter((rec) => {
      // Status filter
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'IN' && rec.status !== 'IN' && rec.status !== 'LATE') return false;
        if (statusFilter === 'LATE' && rec.status !== 'LATE') return false;
        if (statusFilter === 'CHECKED_OUT' && rec.status !== 'CHECKED_OUT') return false;
        if (statusFilter === 'ABSENT' && rec.status !== 'ABSENT') return false;
        if (statusFilter === 'EARLY' && rec.earlyLeaveMinutes <= 0) return false;
      }

      // Search filter
      if (attendanceSearch.trim()) {
        const query = attendanceSearch.toLowerCase().trim();
        const matchName = rec.name.toLowerCase().includes(query);
        const matchCode = rec.employeeCode.toLowerCase().includes(query);
        const matchDept = rec.departmentName.toLowerCase().includes(query);
        if (!matchName && !matchCode && !matchDept) return false;
      }

      return true;
    });
  }, [todayData?.records, statusFilter, attendanceSearch]);

  // ─── TABS DEFINITION ──────────────────────────────────────────────────────
  const tabs = [
    { id: 'attendance', label: 'Attendance', icon: <CalendarCheck size={16} /> },
    { id: 'performance', label: 'Performance', icon: <Trophy size={16} /> },
  ] as const;

  return (
    <div className="space-y-5">
      {/* ── Page Header & Tabs ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Reports & Analytics
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Daily attendance punch logs and employee performance report
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-muted/60 p-1 rounded-xl border border-border/60 self-start sm:self-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all',
                tab === t.id
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* TAB 1: TODAY'S LIVE ATTENDANCE                                        */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {tab === 'attendance' && (
        <div className="space-y-4">
          {/* ── 6 Clickable Filter Stat Cards ─────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* TOTAL STAFF */}
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={cn(
                'p-4 rounded-2xl bg-card border text-left transition-all duration-150 flex flex-col justify-between cursor-pointer select-none',
                statusFilter === 'ALL'
                  ? 'border-primary ring-2 ring-primary/20 shadow-xs bg-primary/[0.03]'
                  : 'border-border/60 hover:border-border hover:bg-muted/30'
              )}
            >
              <div className="flex items-center justify-between text-muted-foreground w-full">
                <span className="text-[10px] font-bold uppercase tracking-wider">Total Staff</span>
                <Users size={14} className="text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold tracking-tight text-foreground mt-2">
                {todayData?.summary.totalStaff ?? '--'}
              </div>
            </button>

            {/* PRESENT (IN) */}
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'IN' ? 'ALL' : 'IN')}
              className={cn(
                'p-4 rounded-2xl bg-card border text-left transition-all duration-150 flex flex-col justify-between cursor-pointer select-none',
                statusFilter === 'IN'
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs bg-emerald-500/[0.04]'
                  : 'border-border/60 hover:border-emerald-500/40 hover:bg-emerald-500/[0.02]'
              )}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Present</span>
                <LogIn size={14} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 mt-2">
                {todayData?.summary.presentIn ?? '--'}
              </div>
            </button>

            {/* CHECKED OUT */}
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'CHECKED_OUT' ? 'ALL' : 'CHECKED_OUT')}
              className={cn(
                'p-4 rounded-2xl bg-card border text-left transition-all duration-150 flex flex-col justify-between cursor-pointer select-none',
                statusFilter === 'CHECKED_OUT'
                  ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-xs bg-blue-500/[0.04]'
                  : 'border-border/60 hover:border-blue-500/40 hover:bg-blue-500/[0.02]'
              )}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Checked Out</span>
                <LogOut size={14} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div className="text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400 mt-2">
                {todayData?.summary.checkedOut ?? '--'}
              </div>
            </button>

            {/* ABSENT */}
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'ABSENT' ? 'ALL' : 'ABSENT')}
              className={cn(
                'p-4 rounded-2xl bg-card border text-left transition-all duration-150 flex flex-col justify-between cursor-pointer select-none',
                statusFilter === 'ABSENT'
                  ? 'border-rose-500 ring-2 ring-rose-500/20 shadow-xs bg-rose-500/[0.04]'
                  : 'border-border/60 hover:border-rose-500/40 hover:bg-rose-500/[0.02]'
              )}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Absent</span>
                <XCircle size={14} className="text-rose-600 dark:text-rose-400" />
              </div>
              <div className="text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400 mt-2">
                {todayData?.summary.absent ?? '--'}
              </div>
            </button>

            {/* LATE ARRIVED */}
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'LATE' ? 'ALL' : 'LATE')}
              className={cn(
                'p-4 rounded-2xl bg-card border text-left transition-all duration-150 flex flex-col justify-between cursor-pointer select-none',
                statusFilter === 'LATE'
                  ? 'border-amber-500 ring-2 ring-amber-500/20 shadow-xs bg-amber-500/[0.04]'
                  : 'border-border/60 hover:border-amber-500/40 hover:bg-amber-500/[0.02]'
              )}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Late</span>
                <Clock size={14} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400 mt-2">
                {todayData?.summary.lateArrived ?? '--'}
              </div>
            </button>

            {/* EARLY LEFT */}
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'EARLY' ? 'ALL' : 'EARLY')}
              className={cn(
                'p-4 rounded-2xl bg-card border text-left transition-all duration-150 flex flex-col justify-between cursor-pointer select-none',
                statusFilter === 'EARLY'
                  ? 'border-purple-500 ring-2 ring-purple-500/20 shadow-xs bg-purple-500/[0.04]'
                  : 'border-border/60 hover:border-purple-500/40 hover:bg-purple-500/[0.02]'
              )}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Early Left</span>
                <ArrowUpRight size={14} className="text-purple-600 dark:text-purple-400" />
              </div>
              <div className="text-2xl font-bold tracking-tight text-purple-600 dark:text-purple-400 mt-2">
                {todayData?.summary.earlyLeft ?? '--'}
              </div>
            </button>
          </div>

          {/* ── Search & Date Controls Bar ────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-3 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search staff by name, code, dept..."
                  value={attendanceSearch}
                  onChange={(e) => setAttendanceSearch(e.target.value)}
                  className="pl-8 h-9 text-xs bg-card border-border/70 rounded-xl"
                />
              </div>
              <span className="text-xs text-muted-foreground hidden sm:inline whitespace-nowrap">
                Showing <span className="font-semibold text-foreground">{filteredRecords.length}</span> of {todayData?.summary.totalStaff ?? 0} staff
              </span>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-9 text-xs w-36 bg-card border-border/70 rounded-xl"
              />
              {selectedDate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDate('')}
                  className="h-9 px-2 text-xs"
                  title="Reset to today"
                >
                  Today
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchAttendance()}
                className="h-9 text-xs gap-1.5 bg-card border-border/70 rounded-xl"
                disabled={isRefetchingAttendance}
              >
                <RefreshCw
                  size={12}
                  className={cn(isRefetchingAttendance && 'animate-spin')}
                />
                <span>Refresh</span>
              </Button>
            </div>
          </div>

          {/* ── Sleek & Polished Attendance Table ──────────────────────────── */}
          <Card className="border border-border/60 shadow-xs rounded-2xl overflow-hidden bg-card">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 border-b border-border/60 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-5">Employee</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Shift</th>
                      <th className="py-3 px-4">Punch In</th>
                      <th className="py-3 px-4">Punch Out</th>
                      <th className="py-3 px-5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {isLoadingAttendance ? (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-xs text-muted-foreground">
                          <div className="flex items-center justify-center gap-2">
                            <RefreshCw size={14} className="animate-spin text-primary" />
                            <span>Loading live attendance data...</span>
                          </div>
                        </td>
                      </tr>
                    ) : filteredRecords.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-12 text-center text-xs text-muted-foreground">
                          No employees match the selected criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredRecords.map((rec: TodayAttendanceRecord) => {
                        const avatarPalette = getAvatarPalette(rec.name);
                        return (
                          <tr
                            key={rec.id}
                            className="hover:bg-muted/30 transition-colors"
                          >
                            {/* Employee Name with Dynamic Palette Avatar */}
                            <td className="py-3 px-5">
                              <div className="flex items-center gap-3">
                                <div
                                  className={cn(
                                    'h-8 w-8 rounded-full border flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs',
                                    avatarPalette
                                  )}
                                >
                                  {rec.initial}
                                </div>
                                <div>
                                  <div className="font-semibold text-foreground text-xs leading-tight">
                                    {rec.name}
                                  </div>
                                  <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                                    {rec.employeeCode}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Department */}
                            <td className="py-3 px-4">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-muted/70 text-muted-foreground border border-border/40">
                                {rec.departmentName}
                              </span>
                            </td>

                            {/* Shift */}
                            <td className="py-3 px-4">
                              <div className="text-xs font-medium text-foreground/80">
                                {rec.shiftStart} - {rec.shiftEnd}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {rec.shiftName}
                              </div>
                            </td>

                            {/* Punch In */}
                            <td className="py-3 px-4">
                              {rec.formattedPunchIn ? (
                                <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                                  {rec.formattedPunchIn}
                                </span>
                              ) : (
                                <span className="font-mono text-xs text-muted-foreground/40">—</span>
                              )}
                            </td>

                            {/* Punch Out */}
                            <td className="py-3 px-4">
                              {rec.formattedPunchOut ? (
                                <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded">
                                  {rec.formattedPunchOut}
                                </span>
                              ) : (
                                <span className="font-mono text-xs text-muted-foreground/40">—</span>
                              )}
                            </td>

                            {/* Status */}
                            <td className="py-3 px-5 text-right">
                              {rec.status === 'LATE' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                  <span>Late</span>
                                </span>
                              )}

                              {rec.status === 'IN' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  <span>Present</span>
                                </span>
                              )}

                              {rec.status === 'CHECKED_OUT' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20">
                                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                                  <span>Checked Out</span>
                                </span>
                              )}

                              {rec.status === 'ABSENT' && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-muted/80 text-muted-foreground border border-border/60">
                                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                                  <span>Absent</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: EMPLOYEE PERFORMANCE (Legacy System Reproduction)             */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {tab === 'performance' && (
        <div className="space-y-4">
          {/* Performance Filter Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-card/60 p-3.5 rounded-2xl border border-border/60">
            <div className="flex flex-wrap items-center gap-3">
              {/* Employee Selector */}
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground block">
                  Select Employee
                </span>
                <Select
                  value={effectiveEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  className="w-56 h-9 text-xs bg-background"
                >
                  {employeeList.map((emp: Employee) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName} ({emp.employeeCode})
                    </option>
                  ))}
                </Select>
              </div>

              {/* Year Selector */}
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground block">
                  Select Year
                </span>
                <Select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                  className="w-28 h-9 text-xs bg-background"
                >
                  {[2027, 2026, 2025, 2024, 2023, 2022].map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchPerformance()}
              className="h-9 text-xs gap-1.5 bg-background self-end"
              disabled={isRefetchingPerf}
            >
              <RefreshCw
                size={12}
                className={cn(isRefetchingPerf && 'animate-spin')}
              />
              <span>Refresh Report</span>
            </Button>
          </div>

          {isLoadingPerf || !perfData ? (
            <div className="p-16 text-center text-xs text-muted-foreground bg-card rounded-2xl border border-border/60">
              <RefreshCw size={18} className="animate-spin mx-auto text-primary mb-2" />
              Loading employee performance data...
            </div>
          ) : (
            <div className="space-y-4">
              {/* ── Performance Summary Cards (from Legacy System) ───────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Total Presents in Year */}
                <div className="p-4 rounded-2xl bg-card border border-border/60 shadow-xs">
                  <div className="flex items-center gap-2 text-cyan-500">
                    <CalendarCheck size={16} />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Total Presents ({selectedYear})
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-foreground mt-1">
                    {perfData.summary.totalYearlyPresents} Days
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {perfData.summary.avgMonthlyPresents} days / active month avg
                  </p>
                </div>

                {/* Total Paid Salary in Year */}
                <div className="p-4 rounded-2xl bg-card border border-border/60 shadow-xs">
                  <div className="flex items-center gap-2 text-indigo-500">
                    <Wallet size={16} />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Total Paid Salary ({selectedYear})
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                    ₹{perfData.summary.totalYearlySalary.toLocaleString('en-IN')}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Contract Base: ₹{perfData.employee.baseSalary.toLocaleString('en-IN')}
                  </p>
                </div>

                {/* Last 30 Days Quick Range */}
                <div className="p-4 rounded-2xl bg-card border border-border/60 shadow-xs">
                  <div className="flex items-center gap-2 text-emerald-500">
                    <Clock size={16} />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Last 30 Days
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {perfData.summary.last30DaysPresents} Days
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Recent 30 days present count
                  </p>
                </div>

                {/* Last 3 Months Quick Range */}
                <div className="p-4 rounded-2xl bg-card border border-border/60 shadow-xs">
                  <div className="flex items-center gap-2 text-purple-500">
                    <Award size={16} />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Last 3 Months
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                    {perfData.summary.last3MonthsPresents} Days
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Quarterly attendance volume
                  </p>
                </div>
              </div>

              {/* ── 2-Column Performance Charts Suite ─────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* ── Chart 1: Monthly Attendance (Presents) ─────────────── */}
                <Card className="border border-border/60 shadow-xs rounded-2xl bg-card">
                  <CardHeader className="p-4 border-b border-border/40 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-cyan-500/10 text-cyan-500 flex items-center justify-center">
                          <CalendarCheck size={14} />
                        </div>
                        <CardTitle className="text-sm font-bold">
                          Monthly Attendance ({selectedYear})
                        </CardTitle>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-cyan-500/10 text-cyan-600 border border-cyan-500/20">
                        {perfData.summary.totalYearlyPresents} Total Days
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="relative w-full h-[180px]">
                      <svg
                        viewBox="0 0 460 160"
                        className="w-full h-full overflow-visible"
                        preserveAspectRatio="none"
                      >
                        <defs>
                          <linearGradient id="attBarGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.85" />
                            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.3" />
                          </linearGradient>
                        </defs>

                        {/* Y-axis grid */}
                        {[0, 10, 20, 30].map((val) => {
                          const y = 130 - (val / 31) * 110;
                          return (
                            <g key={val}>
                              <line
                                x1={30}
                                y1={y}
                                x2={450}
                                y2={y}
                                stroke="currentColor"
                                className="text-border/40"
                                strokeDasharray="2 2"
                                strokeWidth="1"
                              />
                              <text
                                x={24}
                                y={y + 3}
                                textAnchor="end"
                                className="text-[8px] fill-muted-foreground font-mono"
                              >
                                {val}d
                              </text>
                            </g>
                          );
                        })}

                        {/* Bars for 12 months */}
                        {perfData.monthlyAttendance.map((m, idx) => {
                          const barWidth = 22;
                          const x = 36 + idx * 34;
                          const barHeight = Math.max((m.presents / 31) * 110, 2);
                          const y = 130 - barHeight;
                          const isHovered = hoveredAttMonth === idx;

                          return (
                            <g
                              key={m.month}
                              className="cursor-pointer"
                              onMouseEnter={() => setHoveredAttMonth(idx)}
                              onMouseLeave={() => setHoveredAttMonth(null)}
                            >
                              <rect
                                x={x}
                                y={y}
                                width={barWidth}
                                height={barHeight}
                                rx={4}
                                fill={m.presents > 0 ? 'url(#attBarGrad)' : 'currentColor'}
                                className={cn(
                                  'transition-all duration-200',
                                  m.presents > 0
                                    ? isHovered
                                      ? 'opacity-100 filter drop-shadow(0 2px 6px rgba(0,212,255,0.4))'
                                      : 'opacity-85'
                                    : 'text-border/30'
                                )}
                              />

                              {/* Month label */}
                              <text
                                x={x + barWidth / 2}
                                y={145}
                                textAnchor="middle"
                                className={cn(
                                  'text-[9px] font-semibold transition-colors',
                                  isHovered ? 'fill-foreground font-bold' : 'fill-muted-foreground'
                                )}
                              >
                                {m.shortName}
                              </text>
                            </g>
                          );
                        })}
                      </svg>

                      {/* Floating Tooltip */}
                      {hoveredAttMonth !== null && perfData.monthlyAttendance[hoveredAttMonth] && (
                        <div
                          className="absolute z-20 pointer-events-none p-2 rounded-xl bg-popover/95 text-popover-foreground shadow-xl border border-border/80 backdrop-blur-md text-[11px] space-y-1 -translate-x-1/2 -translate-y-full"
                          style={{
                            left: `${((36 + hoveredAttMonth * 34 + 11) / 460) * 100}%`,
                            top: `${(Math.max(130 - (perfData.monthlyAttendance[hoveredAttMonth]!.presents / 31) * 110, 20) / 160) * 100 - 8}%`,
                          }}
                        >
                          <div className="font-bold border-b border-border/40 pb-0.5">
                            {perfData.monthlyAttendance[hoveredAttMonth]?.fullName}
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Presents:</span>
                            <span className="font-bold text-cyan-500">
                              {perfData.monthlyAttendance[hoveredAttMonth]?.presents} Days
                            </span>
                          </div>
                          <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                            <span>Absents:</span>
                            <span>{perfData.monthlyAttendance[hoveredAttMonth]?.absents} Days</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* ── Chart 2: Monthly Paid Salary Payouts ───────────────── */}
                <Card className="border border-border/60 shadow-xs rounded-2xl bg-card">
                  <CardHeader className="p-4 border-b border-border/40 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                          <Wallet size={14} />
                        </div>
                        <CardTitle className="text-sm font-bold">
                          Monthly Paid Salary ({selectedYear})
                        </CardTitle>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
                        ₹{perfData.summary.totalYearlySalary.toLocaleString('en-IN')} Total
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="relative w-full h-[180px]">
                      {(() => {
                        const maxSalary = Math.max(
                          ...perfData.monthlySalary.map((s) => s.netSalary),
                          perfData.employee.baseSalary,
                          1000
                        );

                        return (
                          <svg
                            viewBox="0 0 460 160"
                            className="w-full h-full overflow-visible"
                            preserveAspectRatio="none"
                          >
                            <defs>
                              <linearGradient id="salBarGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.85" />
                                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.3" />
                              </linearGradient>
                            </defs>

                            {/* Y-axis grid */}
                            {[0, 0.5, 1].map((pct, idx) => {
                              const y = 130 - pct * 110;
                              const val = Math.round(maxSalary * pct);
                              return (
                                <g key={idx}>
                                  <line
                                    x1={30}
                                    y1={y}
                                    x2={450}
                                    y2={y}
                                    stroke="currentColor"
                                    className="text-border/40"
                                    strokeDasharray="2 2"
                                    strokeWidth="1"
                                  />
                                  <text
                                    x={24}
                                    y={y + 3}
                                    textAnchor="end"
                                    className="text-[8px] fill-muted-foreground font-mono"
                                  >
                                    ₹{val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                                  </text>
                                </g>
                              );
                            })}

                            {/* Bars for 12 months */}
                            {perfData.monthlySalary.map((s, idx) => {
                              const barWidth = 22;
                              const x = 36 + idx * 34;
                              const barHeight = Math.max((s.netSalary / (maxSalary || 1)) * 110, 2);
                              const y = 130 - barHeight;
                              const isHovered = hoveredSalMonth === idx;

                              return (
                                <g
                                  key={s.month}
                                  className="cursor-pointer"
                                  onMouseEnter={() => setHoveredSalMonth(idx)}
                                  onMouseLeave={() => setHoveredSalMonth(null)}
                                >
                                  <rect
                                    x={x}
                                    y={y}
                                    width={barWidth}
                                    height={barHeight}
                                    rx={4}
                                    fill={s.netSalary > 0 ? 'url(#salBarGrad)' : 'currentColor'}
                                    className={cn(
                                      'transition-all duration-200',
                                      s.netSalary > 0
                                        ? isHovered
                                          ? 'opacity-100 filter drop-shadow(0 2px 6px rgba(139,92,246,0.4))'
                                          : 'opacity-85'
                                        : 'text-border/30'
                                    )}
                                  />

                                  {/* Month label */}
                                  <text
                                    x={x + barWidth / 2}
                                    y={145}
                                    textAnchor="middle"
                                    className={cn(
                                      'text-[9px] font-semibold transition-colors',
                                      isHovered ? 'fill-foreground font-bold' : 'fill-muted-foreground'
                                    )}
                                  >
                                    {s.shortName}
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                        );
                      })()}

                      {/* Floating Tooltip for Salary */}
                      {hoveredSalMonth !== null && perfData.monthlySalary[hoveredSalMonth] && (
                        <div
                          className="absolute z-20 pointer-events-none p-2 rounded-xl bg-popover/95 text-popover-foreground shadow-xl border border-border/80 backdrop-blur-md text-[11px] space-y-1 -translate-x-1/2 -translate-y-full"
                          style={{
                            left: `${((36 + hoveredSalMonth * 34 + 11) / 460) * 100}%`,
                            top: '40%',
                          }}
                        >
                          <div className="font-bold border-b border-border/40 pb-0.5">
                            {perfData.monthlySalary[hoveredSalMonth]?.fullName}
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-muted-foreground">Paid Salary:</span>
                            <span className="font-bold text-indigo-500">
                              ₹{(perfData.monthlySalary[hoveredSalMonth]?.netSalary || 0).toLocaleString('en-IN')}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
                            <span>Status:</span>
                            <span className="font-semibold text-foreground">
                              {perfData.monthlySalary[hoveredSalMonth]?.status}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* ── 2-Column Secondary Charts Suite ─────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                {/* ── Chart 3: Salary Increment & Base Pay Progression Graph ── */}
                <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden flex flex-col">
                  <CardHeader className="p-4 border-b border-border/40 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                          <ArrowUpRight size={14} />
                        </div>
                        <CardTitle className="text-sm font-bold">
                          Salary Increment History
                        </CardTitle>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        +{incrementStats.growthPct}% Growth
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 flex-1">
                    {incrementTimelineData.length === 0 ? (
                      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                        No salary history available.
                      </div>
                    ) : (
                      (() => {
                        const maxSalaryVal = Math.max(
                          ...incrementTimelineData.map((d) => d.salary),
                          incrementStats.currentSalary,
                          1000
                        ) * 1.15;
                        
                        const minSalaryVal = Math.max(0, Math.min(...incrementTimelineData.map((d) => d.salary)) * 0.85);
                        const yRange = maxSalaryVal - minSalaryVal;

                        return (
                          <div className="relative w-full h-[180px] select-none flex flex-col pl-6 pr-2">
                            {/* Y-Axis Grid Lines */}
                            <div className="absolute inset-x-6 inset-y-0 pointer-events-none flex flex-col-reverse justify-between">
                              {[0, 0.5, 1].map((pct, idx) => {
                                const val = Math.round(minSalaryVal + yRange * pct);
                                return (
                                  <div key={idx} className="relative w-full border-t border-border/40 flex items-center">
                                    <span className="absolute -left-2 -translate-x-full text-[9px] text-muted-foreground font-medium whitespace-nowrap">
                                      {val >= 1000 ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : val}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Bars Container */}
                            <div className="relative flex-1 w-full flex items-end justify-between gap-1 sm:gap-2 z-10 h-[155px]">
                              {incrementTimelineData.map((d, idx) => {
                                const heightPct = Math.max(4, ((d.salary - minSalaryVal) / (yRange || 1)) * 100);
                                const isRevision = d.isRevisionMonth;
                                
                                return (
                                  <div 
                                    key={d.key} 
                                    className="relative flex flex-col items-center justify-end h-full flex-1 group cursor-pointer"
                                  >
                                    {/* Value Label above pillar */}
                                    <div className="absolute -top-5 text-[9px] font-bold text-foreground whitespace-nowrap transition-transform duration-200 group-hover:-translate-y-1 opacity-0 group-hover:opacity-100">
                                      ₹{d.salary >= 1000 ? `${(d.salary / 1000).toFixed(d.salary % 1000 === 0 ? 0 : 1)}k` : d.salary}
                                    </div>

                                    {/* Bar */}
                                    <div 
                                      className={cn(
                                        "w-full max-w-[28px] rounded-t-sm bg-gradient-to-t from-emerald-500/20 to-emerald-600/90 border border-emerald-500/30 border-b-0 transition-all duration-300 relative",
                                        "group-hover:from-emerald-500/30 group-hover:to-emerald-500 group-hover:border-emerald-500/60"
                                      )}
                                      style={{ height: `${heightPct}%` }}
                                    >
                                      {/* Revision Marker/Badge */}
                                      {isRevision && idx > 0 && d.incrementFromPrev > 0 && (
                                        <div className="absolute -top-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-emerald-500 ring-1 ring-background shadow-sm" />
                                      )}
                                    </div>
                                    
                                    {/* X-axis Label */}
                                    <div className="absolute -bottom-5 text-[9px] font-medium text-muted-foreground whitespace-nowrap text-center w-full truncate">
                                      {d.label}
                                    </div>
                                    
                                    {/* Tooltip on Hover */}
                                    <div className="absolute bottom-full mb-6 z-30 pointer-events-none p-2.5 rounded-xl bg-popover border border-border/80 shadow-xl text-xs space-y-1.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                                      <div className="font-semibold text-muted-foreground pb-1 mb-1 border-b border-border/40">
                                        {d.fullLabel}
                                      </div>
                                      <div className="flex justify-between items-center gap-4">
                                        <span className="text-foreground">Base Salary</span>
                                        <span className="font-bold text-foreground">
                                          ₹{d.salary.toLocaleString('en-IN')}
                                        </span>
                                      </div>
                                      {d.incrementFromPrev > 0 && (
                                        <div className="flex justify-between items-center gap-4 text-emerald-600 dark:text-emerald-400">
                                          <span>Increment</span>
                                          <span className="font-semibold">
                                            +₹{d.incrementFromPrev.toLocaleString('en-IN')}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()
                    )}
                  </CardContent>
                </Card>

                {/* ── Chart 4: Expected vs Working Hours ── */}
                <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden flex flex-col">
                  <CardHeader className="p-4 border-b border-border/40 pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center">
                          <Clock size={14} />
                        </div>
                        <CardTitle className="text-sm font-bold">
                          Expected vs Worked Hours
                        </CardTitle>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase text-muted-foreground">
                        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-rose-500/30" /> Expected</div>
                        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-rose-500" /> Worked</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 flex-1">
                    <div className="relative w-full h-[180px]">
                      {(() => {
                        const hoursData = perfData.monthlyAttendance.map(m => {
                          const expectedDays = m.presents + m.absents + m.leaves;
                          const expected = expectedDays * 8;
                          const worked = (m.presents * 8) + (m.halfDays * 4);
                          return { month: m.shortName, fullName: m.fullName, expected, worked };
                        });
                        
                        const maxHours = Math.max(...hoursData.map(d => d.expected), 160) * 1.1;

                        return (
                          <svg
                            viewBox="0 0 460 160"
                            className="w-full h-full overflow-visible"
                            preserveAspectRatio="none"
                          >
                            <defs>
                              <linearGradient id="workedBarGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.9" />
                                <stop offset="100%" stopColor="#e11d48" stopOpacity="0.7" />
                              </linearGradient>
                            </defs>

                            {/* Y-axis grid */}
                            {[0, 0.5, 1].map((pct, idx) => {
                              const y = 130 - pct * 110;
                              const val = Math.round(maxHours * pct);
                              return (
                                <g key={idx}>
                                  <line
                                    x1={30}
                                    y1={y}
                                    x2={450}
                                    y2={y}
                                    stroke="currentColor"
                                    className="text-border/40"
                                    strokeDasharray="2 2"
                                    strokeWidth="1"
                                  />
                                  <text
                                    x={24}
                                    y={y + 3}
                                    textAnchor="end"
                                    className="text-[8px] fill-muted-foreground font-mono"
                                  >
                                    {val}h
                                  </text>
                                </g>
                              );
                            })}

                            {/* Bars */}
                            {hoursData.map((d, idx) => {
                              const barWidth = 14;
                              const expHeight = Math.max((d.expected / maxHours) * 110, 2);
                              const expY = 130 - expHeight;
                              const expX = 36 + idx * 34;

                              const wrkHeight = Math.max((d.worked / maxHours) * 110, 2);
                              const wrkY = 130 - wrkHeight;
                              const wrkX = expX + 10; 

                              return (
                                <g key={idx} className="cursor-pointer group">
                                  <rect
                                    x={expX}
                                    y={expY}
                                    width={barWidth}
                                    height={expHeight}
                                    rx={3}
                                    className="fill-rose-500/25"
                                  />
                                  <rect
                                    x={wrkX}
                                    y={wrkY}
                                    width={barWidth}
                                    height={wrkHeight}
                                    rx={3}
                                    fill="url(#workedBarGrad)"
                                    className="transition-all duration-200 group-hover:brightness-110"
                                  />
                                  <text
                                    x={expX + 10}
                                    y={145}
                                    textAnchor="middle"
                                    className="text-[9px] font-semibold fill-muted-foreground group-hover:fill-foreground transition-colors"
                                  >
                                    {d.month}
                                  </text>
                                  <title>{d.fullName}&#10;Expected: {d.expected} hrs&#10;Worked: {d.worked} hrs</title>
                                </g>
                              );
                            })}
                          </svg>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* ── Monthly Performance Breakdown Table ───────────────────── */}
              <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden">
                <CardHeader className="p-4 border-b border-border/40">
                  <CardTitle className="text-sm font-bold">
                    {selectedYear} Monthly Performance Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/30 border-b border-border/40 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        <tr>
                          <th className="py-2.5 px-4">Month</th>
                          <th className="py-2.5 px-4 text-center">Presents</th>
                          <th className="py-2.5 px-4 text-center">Absents</th>
                          <th className="py-2.5 px-4 text-center">Leaves</th>
                          <th className="py-2.5 px-4 text-right">Paid Salary</th>
                          <th className="py-2.5 px-4 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {perfData.monthlyAttendance.map((att, idx) => {
                          const sal = perfData.monthlySalary[idx];
                          return (
                            <tr key={att.month} className="hover:bg-muted/20 transition-colors">
                              <td className="py-2.5 px-4 font-semibold text-foreground">
                                {att.fullName}
                              </td>
                              <td className="py-2.5 px-4 text-center font-bold text-cyan-600 dark:text-cyan-400">
                                {att.presents} d
                              </td>
                              <td className="py-2.5 px-4 text-center text-muted-foreground">
                                {att.absents} d
                              </td>
                              <td className="py-2.5 px-4 text-center text-muted-foreground">
                                {att.leaves} d
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono font-bold text-foreground">
                                {sal && sal.netSalary > 0
                                  ? `₹${sal.netSalary.toLocaleString('en-IN')}`
                                  : '—'}
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                {sal?.status === 'PAID' ? (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                    PAID
                                  </span>
                                ) : sal?.status === 'PENDING' ? (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                    PENDING
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/60 text-[10px]">
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
