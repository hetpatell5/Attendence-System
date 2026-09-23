import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
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
  Award,
  TrendingUp,
} from 'lucide-react';
import { cn, compareEmployeesByName, to12h } from '@/lib/utils';

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
type ChartRange = '6m' | 'alltime';

interface StockChartPoint {
  xLabel: string;
  value: number;
  secondaryValue?: number;
  dateLabel: string;
  displayValue: string;
  secondaryDisplayValue?: string;
  isMarker?: boolean;
  markerNote?: string;
}

function StockAreaChart({
  points,
  lineColor,
  areaGradientId,
  yTickFormatter,
  secondaryLineColor,
}: {
  points: StockChartPoint[];
  lineColor: string;
  areaGradientId: string;
  yTickFormatter?: (v: number) => string;
  secondaryLineColor?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div className="h-[180px] w-full flex items-center justify-center text-xs text-muted-foreground">
        No data available
      </div>
    );
  }

  const W = 460;
  const H = 160;
  const padL = 38;
  const padR = 12;
  const padT = 24;
  const padB = 22;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const allVals = points.flatMap((p) =>
    [p.value, p.secondaryValue].filter((v): v is number => v !== undefined)
  );
  const minVal = Math.max(0, Math.min(...allVals) * 0.9);
  const maxVal = Math.max(...allVals, 1) * 1.1;
  const yRange = maxVal - minVal || 1;

  const n = points.length;
  const xs = points.map((_, i) => padL + (i / Math.max(n - 1, 1)) * chartW);
  const ys = points.map((p) => padT + chartH - ((p.value - minVal) / yRange) * chartH);

  const linePts = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
  const areaPts = `${padL},${padT + chartH} ` + linePts + ` ${padL + chartW},${padT + chartH}`;

  const hasSecondary = points.some((p) => p.secondaryValue !== undefined);
  const secYs = hasSecondary
    ? points.map((p) => padT + chartH - (((p.secondaryValue ?? 0) - minVal) / yRange) * chartH)
    : [];
  const secLinePts = hasSecondary ? xs.map((x, i) => `${x},${secYs[i]}`).join(' ') : '';

  const activeIdx = hoverIdx !== null ? hoverIdx : n - 1;
  const activePoint = points[activeIdx];

  const yTicks = [0, 0.5, 1].map((pct) => {
    const val = minVal + yRange * pct;
    const y = padT + chartH - pct * chartH;
    return {
      y,
      label: yTickFormatter ? yTickFormatter(val) : Math.round(val).toString(),
    };
  });

  return (
    <div className="relative w-full h-[180px] bg-white dark:bg-card rounded-xl border border-border/60 shadow-xs p-1.5 select-none overflow-hidden">
      {/* Top-Right Floating Badge */}
      <div className="absolute top-2 right-2.5 z-20 flex items-center gap-1.5 bg-slate-900 text-white dark:bg-black/90 dark:text-white border border-slate-700/50 dark:border-white/15 px-2.5 py-1 rounded-md text-[11px] font-mono shadow-md backdrop-blur-md max-w-[calc(100%-20px)] truncate">
        <span className="font-bold text-white tracking-tight">
          {activePoint?.displayValue}
        </span>
        {activePoint?.secondaryDisplayValue && (
          <span className="text-white/70 text-[10px] pl-1.5 border-l border-white/20">
            {activePoint.secondaryDisplayValue}
          </span>
        )}
        <span className="text-white/50 text-[10px] font-sans ml-1">
          {activePoint?.dateLabel}
        </span>
        {activePoint?.markerNote && (
          <span className="text-emerald-400 text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 border border-emerald-500/30">
            {activePoint.markerNote}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full overflow-visible"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * W;
          const clampedX = Math.max(padL, Math.min(padL + chartW, relX));
          const ratio = (clampedX - padL) / chartW;
          const idx = Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))));
          setHoverIdx(idx);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={areaGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines with labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={t.y}
              x2={W - padR}
              y2={t.y}
              stroke="currentColor"
              className="text-slate-200 dark:text-border/40"
              strokeDasharray="3 3"
              strokeWidth="0.8"
            />
            <text
              x={padL - 4}
              y={t.y + 3}
              textAnchor="end"
              className="text-[8px] fill-slate-400 dark:fill-muted-foreground font-mono"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Gradient Area Fill */}
        <polygon points={areaPts} fill={`url(#${areaGradientId})`} />

        {/* Secondary Line (if present, e.g. Expected Hours dashed line) */}
        {hasSecondary && (
          <polyline
            points={secLinePts}
            fill="none"
            stroke={secondaryLineColor || '#f43f5e'}
            strokeWidth="1.2"
            strokeDasharray="4 2"
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeOpacity="0.75"
          />
        )}

        {/* Primary Curve Line */}
        <polyline
          points={linePts}
          fill="none"
          stroke={lineColor}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Key Markers / Revision Dots */}
        {points.map((p, i) => (
          <g key={i}>
            {p.isMarker && (
              <circle
                cx={xs[i]}
                cy={ys[i]}
                r={3.5}
                fill={lineColor}
                stroke="#ffffff"
                strokeWidth="1.2"
              />
            )}
          </g>
        ))}

        {/* Crosshair guide line & dot when hovered */}
        {hoverIdx !== null && (
          <g>
            <line
              x1={xs[hoverIdx]}
              y1={padT}
              x2={xs[hoverIdx]}
              y2={padT + chartH}
              stroke="currentColor"
              className="text-slate-400 dark:text-white"
              strokeOpacity="0.5"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            {hasSecondary && (
              <circle
                cx={xs[hoverIdx]}
                cy={secYs[hoverIdx]}
                r={3}
                fill={secondaryLineColor || '#f43f5e'}
                stroke="#ffffff"
                strokeWidth="1"
              />
            )}
            <circle
              cx={xs[hoverIdx]}
              cy={ys[hoverIdx]}
              r={4.5}
              fill={lineColor}
              stroke="#ffffff"
              strokeWidth="2"
            />
          </g>
        )}

        {/* X-axis labels at bottom */}
        {points.map((p, i) => {
          const show =
            i === 0 ||
            i === n - 1 ||
            (n > 6 && i % Math.ceil(n / 5) === 0);
          if (!show) return null;
          return (
            <text
              key={i}
              x={xs[i]}
              y={H - 5}
              textAnchor="middle"
              className="text-[8px] fill-slate-400 dark:fill-muted-foreground font-mono"
            >
              {p.xLabel}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function getBarTooltipStyle(idx: number, total: number): React.CSSProperties {
  const gap = Math.floor(420 / Math.max(total, 1));
  const barLeftPct = ((36 + idx * gap) / 460) * 100;
  const barRightPct = ((36 + idx * gap + 38) / 460) * 100;
  const barCenterPct = (barLeftPct + barRightPct) / 2;

  // If hovering the rightmost bar (e.g. August in 6M view), position cleanly to the LEFT of the bar
  if (idx >= total - 1) {
    return {
      top: '8px',
      right: `calc(100% - ${Math.max(barLeftPct - 2, 20)}%)`,
      left: 'auto',
      maxWidth: 'min(210px, calc(100% - 24px))',
    };
  }

  // If next to rightmost on the right half:
  if (idx === total - 2 && barLeftPct > 60) {
    return {
      top: '8px',
      right: `calc(100% - ${Math.max(barLeftPct - 2, 25)}%)`,
      left: 'auto',
      maxWidth: 'min(210px, calc(100% - 24px))',
    };
  }

  // If leftmost bar (e.g. March), position cleanly to the RIGHT of the bar
  if (idx === 0) {
    return {
      top: '8px',
      left: `${Math.min(barRightPct + 2, 80)}%`,
      right: 'auto',
      maxWidth: 'min(210px, calc(100% - 24px))',
    };
  }

  // For middle bars: center horizontally over the bar
  return {
    top: '8px',
    left: `${barCenterPct}%`,
    transform: 'translateX(-50%)',
    maxWidth: 'min(210px, calc(100% - 24px))',
  };
}

export function ReportsPage(): JSX.Element {
  const [searchParams] = useSearchParams();

  // Read query params on mount to support deep-linking from EmployeesPage
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab');
    return t === 'performance' ? 'performance' : 'attendance';
  });

  // ─── ATTENDANCE TAB STATE ─────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [attendanceSearch, setAttendanceSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'IN' | 'LATE' | 'CHECKED_OUT' | 'ABSENT' | 'EARLY'>('ALL');

  // ─── PERFORMANCE TAB STATE ────────────────────────────────────────────────
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(
    searchParams.get('employeeId') || ''
  );
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [hoveredAttMonth, setHoveredAttMonth] = useState<number | null>(null);
  const [hoveredSalMonth, setHoveredSalMonth] = useState<number | null>(null);
  const [hoveredIncMonth, setHoveredIncMonth] = useState<number | null>(null);
  const [hoveredHrsMonth, setHoveredHrsMonth] = useState<number | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>('6m');

  // When employeeId query param arrives (e.g. from EmployeesPage), pick it up
  useEffect(() => {
    const empId = searchParams.get('employeeId');
    if (empId) setSelectedEmployeeId(empId);
    const t = searchParams.get('tab');
    if (t === 'performance') setTab('performance');
  }, []);

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
    return [...items].sort(compareEmployeesByName);
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

  // ─── 5. CHART DATA COMPUTATIONS (6M vs ALL TIME) ─────────────────────────
  // Determine past 6 completed months range:
  // For 2026 (current month = Sep = 9): March (3) to August (8) — exactly 6 months!
  const sixMonthsRange = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    if (selectedYear === currentYear) {
      const endM = Math.max(1, currentMonth - 1); // 8 (August)
      const startM = Math.max(1, endM - 5);       // 3 (March)
      return { startMonth: startM, endMonth: endM };
    } else if (selectedYear < currentYear) {
      return { startMonth: 7, endMonth: 12 };
    } else {
      return { startMonth: 1, endMonth: 6 };
    }
  }, [selectedYear]);

  // Chart 1 Data: Monthly Attendance
  const attDisplayData = useMemo(() => {
    if (!perfData) return [];
    if (chartRange === '6m') {
      return perfData.monthlyAttendance.filter(
        (m) => m.month >= sixMonthsRange.startMonth && m.month <= sixMonthsRange.endMonth
      );
    }
    return perfData.monthlyAttendance.filter((m) => !m.isFutureMonth);
  }, [perfData, chartRange, sixMonthsRange]);

  // Chart 2 Data: Monthly Paid Salary
  const salDisplayData = useMemo(() => {
    if (!perfData) return [];
    if (chartRange === '6m') {
      return perfData.monthlySalary.filter(
        (s) => s.month >= sixMonthsRange.startMonth && s.month <= sixMonthsRange.endMonth
      );
    }
    return perfData.monthlySalary.filter((_, i) => !perfData.monthlyAttendance[i]?.isFutureMonth);
  }, [perfData, chartRange, sixMonthsRange]);

  // Chart 3 Data: Salary Increment History
  const incDisplayData = useMemo(() => {
    if (!incrementTimelineData || incrementTimelineData.length === 0) return [];
    if (chartRange === '6m') {
      const startKey = `${selectedYear}-${String(sixMonthsRange.startMonth).padStart(2, '0')}`;
      const endKey = `${selectedYear}-${String(sixMonthsRange.endMonth).padStart(2, '0')}`;
      const filtered = incrementTimelineData.filter((d) => d.key >= startKey && d.key <= endKey);
      if (filtered.length > 0) return filtered;
      return incrementTimelineData.slice(-6);
    }
    return incrementTimelineData;
  }, [incrementTimelineData, chartRange, selectedYear, sixMonthsRange]);

  // Chart 4 Data: Expected vs Worked Hours
  const hrsDisplayData = useMemo(() => {
    if (!perfData) return [];
    const source = chartRange === '6m'
      ? perfData.monthlyAttendance.filter(
          (m) => m.month >= sixMonthsRange.startMonth && m.month <= sixMonthsRange.endMonth
        )
      : perfData.monthlyAttendance.filter((m) => !m.isFutureMonth);

    return source.map((m) => {
      const expected = m.expectedHours !== undefined && m.expectedHours > 0
        ? m.expectedHours
        : Math.round((m.presents + m.absents + m.leaves) * 8.5);

      const worked = m.workedHours !== undefined && m.workedHours > 0
        ? m.workedHours
        : Number(((m.presents * 8.5) + ((m.halfDays ?? 0) * 4.25)).toFixed(1));

      return {
        month: m.shortName,
        fullName: m.fullName,
        expected,
        worked,
      };
    });
  }, [perfData, chartRange, sixMonthsRange]);

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
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl border border-gray-200 dark:border-gray-700 self-start sm:self-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all',
                tab === t.id
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
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
                                {to12h(rec.shiftStart)} – {to12h(rec.shiftEnd)}
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
                      {emp.firstName} {emp.lastName}
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
                    ₹{Math.round(perfData.summary.totalYearlySalary).toLocaleString('en-IN')}
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

              {/* ── Performance Trends & Charts Suite Header ───────────────────────── */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 pb-1">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <TrendingUp size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Performance Trends & Insights</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {chartRange === '6m'
                        ? `Showing past 6 completed months (Mar – Aug ${selectedYear})`
                        : `Showing all-time performance history (${selectedYear})`}
                    </p>
                  </div>
                </div>

                {/* Unified Range Switch on Top-Right Corner */}
                <div className="flex bg-muted/80 p-0.5 rounded-xl border border-border/60 shadow-xs self-start sm:self-auto">
                  {(['6m', 'alltime'] as ChartRange[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setChartRange(r)}
                      className={cn(
                        'px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer',
                        chartRange === r
                          ? 'bg-foreground text-background shadow-xs'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {r === '6m' ? 'Last 6M' : 'All Time'}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── 2x2 Performance Charts Suite ─────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* ── Chart 1: Monthly Attendance (Presents) ─────────────── */}
                <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-visible">
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
                        {chartRange === '6m'
                          ? `${attDisplayData.reduce((s, m) => s + m.presents, 0)} Total Days`
                          : `${perfData.summary.totalYearlyPresents} Total Days`}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    {chartRange === 'alltime' ? (
                      <StockAreaChart
                        points={attDisplayData.map((m) => ({
                          xLabel: m.shortName,
                          value: m.presents,
                          dateLabel: m.fullName,
                          displayValue: `${m.presents} Days`,
                        }))}
                        lineColor="#00d4ff"
                        areaGradientId="attStockGrad"
                        yTickFormatter={(v) => `${Math.round(v)}d`}
                      />
                    ) : (
                      // Bar chart for Last 6M (March to August)
                      <div className="relative w-full h-[180px]">
                        {(() => {
                          const n = attDisplayData.length;
                          const gap = Math.floor(420 / Math.max(n, 1));
                          const barW = Math.min(38, gap - 12);
                          return (
                            <svg viewBox="0 0 460 160" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="attBarGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.9" />
                                  <stop offset="100%" stopColor="#0284c7" stopOpacity="0.4" />
                                </linearGradient>
                              </defs>
                              {[0, 10, 20, 30].map((val) => {
                                const y = 130 - (val / 31) * 110;
                                return (
                                  <g key={val}>
                                    <line x1={30} y1={y} x2={450} y2={y} stroke="currentColor" className="text-border/40" strokeDasharray="2 2" strokeWidth="1" />
                                    <text x={24} y={y + 3} textAnchor="end" className="text-[8px] fill-muted-foreground font-mono">{val}d</text>
                                  </g>
                                );
                              })}
                              {attDisplayData.map((m, idx) => {
                                const x = 36 + idx * gap;
                                const barHeight = Math.max((m.presents / 31) * 110, m.presents > 0 ? 3 : 0);
                                const y = 130 - barHeight;
                                const isHov = hoveredAttMonth === idx;
                                return (
                                  <g key={m.month} className="cursor-pointer group" onMouseEnter={() => setHoveredAttMonth(idx)} onMouseLeave={() => setHoveredAttMonth(null)}>
                                    <rect
                                      x={x}
                                      y={y}
                                      width={barW}
                                      height={barHeight}
                                      rx={3}
                                      fill={m.presents > 0 ? 'url(#attBarGrad)' : 'currentColor'}
                                      className={cn('transition-all duration-200', m.presents > 0 ? (isHov ? 'opacity-100 brightness-110' : 'opacity-85') : 'text-border/30')}
                                    />
                                    <text x={x + barW / 2} y={145} textAnchor="middle" className={cn('text-[9px] font-semibold transition-colors', isHov ? 'fill-foreground font-bold' : 'fill-muted-foreground')}>
                                      {m.shortName}
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          );
                        })()}
                        {hoveredAttMonth !== null && attDisplayData[hoveredAttMonth] && (
                          <div
                            className="absolute z-20 pointer-events-none p-2.5 rounded-xl bg-popover/95 text-popover-foreground shadow-xl border border-border/80 backdrop-blur-md text-[11px] space-y-1"
                            style={getBarTooltipStyle(hoveredAttMonth, attDisplayData.length)}
                          >
                            <div className="font-bold border-b border-border/40 pb-0.5">{attDisplayData[hoveredAttMonth]?.fullName}</div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Presents:</span><span className="font-bold text-cyan-500">{attDisplayData[hoveredAttMonth]?.presents} Days</span></div>
                            <div className="flex justify-between gap-3 text-[10px] text-muted-foreground"><span>Absents:</span><span>{attDisplayData[hoveredAttMonth]?.absents} Days</span></div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* ── Chart 2: Monthly Paid Salary Payouts ───────────────── */}
                <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-visible">
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
                        ₹{Math.round(
                          chartRange === '6m'
                            ? salDisplayData.reduce((s, m) => s + m.netSalary, 0)
                            : perfData.summary.totalYearlySalary
                        ).toLocaleString('en-IN')}{' '}
                        Total
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    {chartRange === 'alltime' ? (
                      <StockAreaChart
                        points={salDisplayData.map((s) => ({
                          xLabel: s.shortName,
                          value: s.netSalary,
                          dateLabel: s.fullName,
                          displayValue: `₹${Math.round(s.netSalary).toLocaleString('en-IN')}`,
                        }))}
                        lineColor="#8b5cf6"
                        areaGradientId="salStockGrad"
                        yTickFormatter={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${Math.round(v)}`)}
                      />
                    ) : (
                      <div className="relative w-full h-[180px]">
                        {(() => {
                          const maxSalary = Math.max(
                            ...salDisplayData.map((s) => s.netSalary),
                            perfData.employee.baseSalary,
                            1000
                          );
                          const n = salDisplayData.length;
                          const gap = Math.floor(420 / Math.max(n, 1));
                          const barWidth = Math.min(38, gap - 12);
                          return (
                            <svg viewBox="0 0 460 160" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="salBarGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.9" />
                                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.4" />
                                </linearGradient>
                              </defs>
                              {[0, 0.5, 1].map((pct, idx) => {
                                const y = 130 - pct * 110;
                                const val = Math.round(maxSalary * pct);
                                return (
                                  <g key={idx}>
                                    <line x1={30} y1={y} x2={450} y2={y} stroke="currentColor" className="text-border/40" strokeDasharray="2 2" strokeWidth="1" />
                                    <text x={24} y={y + 3} textAnchor="end" className="text-[8px] fill-muted-foreground font-mono">
                                      ₹{val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                                    </text>
                                  </g>
                                );
                              })}
                              {salDisplayData.map((s, idx) => {
                                const x = 36 + idx * gap;
                                const barHeight = Math.max((s.netSalary / (maxSalary || 1)) * 110, s.netSalary > 0 ? 3 : 0);
                                const y = 130 - barHeight;
                                const isHov = hoveredSalMonth === idx;
                                return (
                                  <g
                                    key={s.month}
                                    className="cursor-pointer group"
                                    onMouseEnter={() => setHoveredSalMonth(idx)}
                                    onMouseLeave={() => setHoveredSalMonth(null)}
                                  >
                                    <rect
                                      x={x}
                                      y={y}
                                      width={barWidth}
                                      height={barHeight}
                                      rx={3}
                                      fill={s.netSalary > 0 ? 'url(#salBarGrad)' : 'currentColor'}
                                      className={cn('transition-all duration-200', s.netSalary > 0 ? (isHov ? 'opacity-100 brightness-110' : 'opacity-85') : 'text-border/30')}
                                    />
                                    <text
                                      x={x + barWidth / 2}
                                      y={145}
                                      textAnchor="middle"
                                      className={cn('text-[9px] font-semibold transition-colors', isHov ? 'fill-foreground font-bold' : 'fill-muted-foreground')}
                                    >
                                      {s.shortName}
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          );
                        })()}
                        {hoveredSalMonth !== null && salDisplayData[hoveredSalMonth] && (
                          <div
                            className="absolute z-20 pointer-events-none p-2.5 rounded-xl bg-popover/95 text-popover-foreground shadow-xl border border-border/80 backdrop-blur-md text-[11px] space-y-1"
                            style={getBarTooltipStyle(hoveredSalMonth, salDisplayData.length)}
                          >
                            <div className="font-bold border-b border-border/40 pb-0.5">{salDisplayData[hoveredSalMonth]?.fullName}</div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Paid:</span><span className="font-bold text-indigo-500">₹{Math.round(salDisplayData[hoveredSalMonth]!.netSalary).toLocaleString('en-IN')}</span></div>
                            <div className="flex justify-between gap-3 text-[10px] text-muted-foreground"><span>Status:</span><span className="font-semibold text-foreground">{salDisplayData[hoveredSalMonth]?.status}</span></div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* ── 2-Column Secondary Charts Suite ─────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                {/* ── Chart 3: Salary Increment & Base Pay Progression Graph ── */}
                <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-visible flex flex-col">
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
                    {incDisplayData.length === 0 ? (
                      <div className="h-[180px] w-full flex items-center justify-center text-xs text-muted-foreground">
                        No salary history available.
                      </div>
                    ) : chartRange === 'alltime' ? (
                      <StockAreaChart
                        points={incDisplayData.map((d) => ({
                          xLabel: d.label,
                          value: d.salary,
                          dateLabel: d.fullLabel,
                          displayValue: `₹${d.salary.toLocaleString('en-IN')}`,
                          isMarker: d.isRevisionMonth,
                          markerNote: d.incrementFromPrev > 0 ? `+₹${d.incrementFromPrev.toLocaleString('en-IN')}` : undefined,
                        }))}
                        lineColor="#10b981"
                        areaGradientId="incStockGrad"
                        yTickFormatter={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${Math.round(v)}`)}
                      />
                    ) : (
                      <div className="relative w-full h-[180px]">
                        {(() => {
                          const maxSalaryVal = Math.max(...incDisplayData.map((d) => d.salary), incrementStats.currentSalary, 1000) * 1.12;
                          const minSalaryVal = Math.max(0, Math.min(...incDisplayData.map((d) => d.salary)) * 0.85);
                          const yRange = maxSalaryVal - minSalaryVal || 1;
                          const n = incDisplayData.length;
                          const gap = Math.floor(420 / Math.max(n, 1));
                          const barW = Math.min(38, gap - 12);
                          return (
                            <svg viewBox="0 0 460 160" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="incBarGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.9" />
                                  <stop offset="100%" stopColor="#059669" stopOpacity="0.4" />
                                </linearGradient>
                              </defs>
                              {[0, 0.5, 1].map((pct, idx) => {
                                const y = 130 - pct * 110;
                                const val = Math.round(minSalaryVal + yRange * pct);
                                return (
                                  <g key={idx}>
                                    <line x1={30} y1={y} x2={450} y2={y} stroke="currentColor" className="text-border/40" strokeDasharray="2 2" strokeWidth="1" />
                                    <text x={24} y={y + 3} textAnchor="end" className="text-[8px] fill-muted-foreground font-mono">
                                      ₹{val >= 1000 ? `${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : val}
                                    </text>
                                  </g>
                                );
                              })}
                              {incDisplayData.map((d, idx) => {
                                const x = 36 + idx * gap;
                                const barHeight = Math.max(((d.salary - minSalaryVal) / yRange) * 110, 4);
                                const y = 130 - barHeight;
                                const isHov = hoveredIncMonth === idx;
                                return (
                                  <g
                                    key={d.key}
                                    className="cursor-pointer group"
                                    onMouseEnter={() => setHoveredIncMonth(idx)}
                                    onMouseLeave={() => setHoveredIncMonth(null)}
                                  >
                                    <rect
                                      x={x}
                                      y={y}
                                      width={barW}
                                      height={barHeight}
                                      rx={3}
                                      fill="url(#incBarGrad)"
                                      className={cn('transition-all duration-200', isHov ? 'opacity-100 brightness-110' : 'opacity-85')}
                                    />
                                    {d.isRevisionMonth && idx > 0 && d.incrementFromPrev > 0 && (
                                      <circle cx={x + barW - 4} cy={y + 4} r={3} fill="#10b981" stroke="#ffffff" strokeWidth="1.2" />
                                    )}
                                    <text
                                      x={x + barW / 2}
                                      y={145}
                                      textAnchor="middle"
                                      className={cn('text-[9px] font-semibold transition-colors', isHov ? 'fill-foreground font-bold' : 'fill-muted-foreground')}
                                    >
                                      {d.label}
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          );
                        })()}
                        {hoveredIncMonth !== null && incDisplayData[hoveredIncMonth] && (
                          <div
                            className="absolute z-20 pointer-events-none p-2.5 rounded-xl bg-popover/95 text-popover-foreground shadow-xl border border-border/80 backdrop-blur-md text-[11px] space-y-1"
                            style={getBarTooltipStyle(hoveredIncMonth, incDisplayData.length)}
                          >
                            <div className="font-bold border-b border-border/40 pb-0.5">{incDisplayData[hoveredIncMonth]?.fullLabel}</div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Base Salary:</span><span className="font-bold text-emerald-500">₹{incDisplayData[hoveredIncMonth]?.salary.toLocaleString('en-IN')}</span></div>
                            {incDisplayData[hoveredIncMonth]!.incrementFromPrev > 0 && (
                              <div className="flex justify-between gap-3 text-[10px] text-emerald-600 dark:text-emerald-400"><span>Increment:</span><span>+₹{incDisplayData[hoveredIncMonth]!.incrementFromPrev.toLocaleString('en-IN')}</span></div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* ── Chart 4: Expected vs Working Hours ── */}
                <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-visible flex flex-col">
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
                        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-rose-500/25 border border-rose-500/60" /> Expected</div>
                        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-rose-500" /> Worked</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 flex-1">
                    {hrsDisplayData.length === 0 ? (
                      <div className="h-[180px] w-full flex items-center justify-center text-xs text-muted-foreground">
                        No hours data available.
                      </div>
                    ) : chartRange === 'alltime' ? (
                      <StockAreaChart
                        points={hrsDisplayData.map((d) => ({
                          xLabel: d.month,
                          value: d.worked,
                          secondaryValue: d.expected,
                          dateLabel: d.fullName,
                          displayValue: `Worked: ${d.worked} hrs`,
                          secondaryDisplayValue: `Expected: ${d.expected} hrs`,
                        }))}
                        lineColor="#e11d48"
                        secondaryLineColor="#f43f5e"
                        areaGradientId="hrsStockGrad"
                        yTickFormatter={(v) => `${Math.round(v)}h`}
                      />
                    ) : (
                      <div className="relative w-full h-[180px]">
                        {(() => {
                          const maxHours = Math.max(...hrsDisplayData.map((d) => Math.max(d.expected, d.worked)), 160) * 1.1;
                          const n = hrsDisplayData.length;
                          const slotW = Math.floor(420 / Math.max(n, 1));
                          const pairW = Math.min(slotW - 4, 38);
                          const singleW = Math.floor(pairW / 2) - 1;

                          return (
                            <svg viewBox="0 0 460 160" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="wrkBarGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.9" />
                                  <stop offset="100%" stopColor="#e11d48" stopOpacity="0.7" />
                                </linearGradient>
                              </defs>
                              {[0, 0.5, 1].map((pct, idx) => {
                                const y = 130 - pct * 110;
                                const val = Math.round(maxHours * pct);
                                return (
                                  <g key={idx}>
                                    <line x1={30} y1={y} x2={450} y2={y} stroke="currentColor" className="text-border/40" strokeDasharray="2 2" strokeWidth="1" />
                                    <text x={24} y={y + 3} textAnchor="end" className="text-[8px] fill-muted-foreground font-mono">{val}h</text>
                                  </g>
                                );
                              })}
                              {hrsDisplayData.map((d, idx) => {
                                const slotX = 36 + idx * slotW;
                                const expX = slotX;
                                const wrkX = slotX + singleW + 2;
                                const expH = Math.max((d.expected / maxHours) * 110, d.expected > 0 ? 2 : 0);
                                const wrkH = Math.max((d.worked / maxHours) * 110, d.worked > 0 ? 2 : 0);
                                const expY = 130 - expH;
                                const wrkY = 130 - wrkH;
                                const isHov = hoveredHrsMonth === idx;
                                return (
                                  <g
                                    key={idx}
                                    className="cursor-pointer group"
                                    onMouseEnter={() => setHoveredHrsMonth(idx)}
                                    onMouseLeave={() => setHoveredHrsMonth(null)}
                                  >
                                    {/* Expected bar (outline) */}
                                    <rect
                                      x={expX}
                                      y={expY}
                                      width={singleW}
                                      height={expH}
                                      rx={2}
                                      className="fill-rose-500/20"
                                      stroke="#f43f5e"
                                      strokeWidth="0.8"
                                      strokeOpacity="0.6"
                                    />
                                    {/* Worked bar (solid) — will be taller if worked > expected */}
                                    <rect
                                      x={wrkX}
                                      y={wrkY}
                                      width={singleW}
                                      height={wrkH}
                                      rx={2}
                                      fill="url(#wrkBarGrad)"
                                      className={cn('transition-all duration-200', isHov ? 'brightness-110' : '')}
                                    />
                                    <text
                                      x={slotX + pairW / 2}
                                      y={145}
                                      textAnchor="middle"
                                      className={cn('text-[9px] font-semibold transition-colors', isHov ? 'fill-foreground font-bold' : 'fill-muted-foreground')}
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
                        {hoveredHrsMonth !== null && hrsDisplayData[hoveredHrsMonth] && (
                          <div
                            className="absolute z-20 pointer-events-none p-2.5 rounded-xl bg-popover/95 text-popover-foreground shadow-xl border border-border/80 backdrop-blur-md text-[11px] space-y-1"
                            style={getBarTooltipStyle(hoveredHrsMonth, hrsDisplayData.length)}
                          >
                            <div className="font-bold border-b border-border/40 pb-0.5">{hrsDisplayData[hoveredHrsMonth]?.fullName}</div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Expected:</span><span className="font-bold text-rose-400">{hrsDisplayData[hoveredHrsMonth]?.expected} hrs</span></div>
                            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Worked:</span><span className="font-bold text-rose-500">{hrsDisplayData[hoveredHrsMonth]?.worked} hrs</span></div>
                          </div>
                        )}
                      </div>
                    )}
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
                        {perfData.monthlyAttendance
                          .filter((att) => !att.isFutureMonth)
                          .map((att) => {
                          // Index by month number, not array position — monthlySalary is
                          // still the full unfiltered 12-month array, so a filtered index
                          // here would point at the wrong month's salary.
                          const sal = perfData.monthlySalary[att.month - 1];
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
                                  ? `₹${Math.round(sal.netSalary).toLocaleString('en-IN')}`
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
