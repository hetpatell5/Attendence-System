import { useState, useMemo } from 'react';
import { 
  TrendingUp, BarChart3, PieChart, Activity, 
  Clock
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { SalaryRecord } from '@attendance/shared';

interface SalaryAnalyticsChartsProps {
  pastRecords: SalaryRecord[];
  currentMetrics: {
    monthlySalary: number;
    estimatedNetPay: number;
    basicSalary: number;
    sundayHolidayPay: number;
    totalHours: number;
    hourRate: number;
    perDaySalary: number;
    presentRegularDays: number;
    totalPaidOffDays: number;
    paidSundays: number;
    paidHolidays: number;
    totalDaysInMonth: number;
  };
  monthAttendance: any[];
  holidaysList: any[];
  currentYear: number;
  currentMonthNum: number;
}

export function SalaryAnalyticsCharts({
  pastRecords,
  currentMetrics,
  monthAttendance,
  holidaysList,
  currentYear,
  currentMonthNum,
}: SalaryAnalyticsChartsProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<'trend' | 'daily'>('trend');
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);
  const [hoveredDonutSegment, setHoveredDonutSegment] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // 1. Multi-Month Trend Data (Chronological past records + Current running month)
  // ---------------------------------------------------------------------------
  const trendData = useMemo(() => {
    const list: Array<{
      key: string;
      label: string;
      fullLabel: string;
      netPay: number;
      basicPay: number;
      offDayPay: number;
      presentDays: number;
      status: 'PAID' | 'PENDING' | 'LIVE';
      isLive?: boolean;
    }> = [];

    // Sort past records chronologically
    const sortedPast = [...pastRecords].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());

    sortedPast.forEach((r) => {
      const d = new Date(r.month);
      const shortLabel = d.toLocaleDateString('en-IN', { month: 'short' });
      const fullLabel = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const netPay = Number(r.netSalary || 0);
      const basicPay = Number(r.basicSalary || 0);
      const offDayPay = Number((r as any).sundayHolidayPay || (r as any).totalAllowances || 0);
      const presentDays = Number(r.presentDays || 0);
      const status = r.status === 'PAID' || (r.status as string) === 'paid' ? 'PAID' : 'PENDING';

      list.push({
        key: r.id || r.month,
        label: shortLabel,
        fullLabel,
        netPay,
        basicPay,
        offDayPay,
        presentDays,
        status,
      });
    });

    // Append Current Running Month as LIVE
    const currentD = new Date(currentYear, currentMonthNum - 1, 1);
    const currShortLabel = `${currentD.toLocaleDateString('en-IN', { month: 'short' })} (Live)`;
    const currFullLabel = `${currentD.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} (Live Running)`;

    list.push({
      key: 'current-live',
      label: currShortLabel,
      fullLabel: currFullLabel,
      netPay: currentMetrics.estimatedNetPay,
      basicPay: currentMetrics.basicSalary,
      offDayPay: currentMetrics.sundayHolidayPay,
      presentDays: currentMetrics.presentRegularDays,
      status: 'LIVE',
      isLive: true,
    });

    return list;
  }, [pastRecords, currentMetrics, currentYear, currentMonthNum]);

  // Key KPI stats
  const kpiStats = useMemo(() => {
    const validSalaries = trendData.map((d) => d.netPay).filter((v) => v > 0);
    const totalEarnings = trendData.reduce((sum, d) => sum + d.netPay, 0);
    const avgSalary = validSalaries.length > 0 ? Math.round(totalEarnings / validSalaries.length) : 0;
    const peakRecord = [...trendData].sort((a, b) => b.netPay - a.netPay)[0];

    // Current month projection
    const todayDate = new Date().getDate();
    const daysElapsed = Math.max(1, Math.min(todayDate, currentMetrics.totalDaysInMonth));
    const projectedMonthNet = daysElapsed > 0 
      ? Math.round((currentMetrics.estimatedNetPay / daysElapsed) * currentMetrics.totalDaysInMonth)
      : currentMetrics.estimatedNetPay;

    return {
      totalEarnings,
      avgSalary,
      peakRecord,
      projectedMonthNet,
    };
  }, [trendData, currentMetrics]);

  // ---------------------------------------------------------------------------
  // 2. SVG Line & Area Chart Coordinates
  // ---------------------------------------------------------------------------
  const chartHeight = 220;
  const chartWidth = 600;
  const padding = { top: 20, right: 30, bottom: 40, left: 45 };

  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const maxNetPay = useMemo(() => {
    const maxVal = Math.max(...trendData.map((d) => d.netPay), currentMetrics.monthlySalary, 1000);
    return Math.ceil(maxVal / 1000) * 1000;
  }, [trendData, currentMetrics.monthlySalary]);

  const points = useMemo(() => {
    if (trendData.length === 0) return [];
    const stepX = trendData.length > 1 ? innerWidth / (trendData.length - 1) : innerWidth / 2;

    return trendData.map((d, i) => {
      const x = padding.left + (trendData.length > 1 ? i * stepX : innerWidth / 2);
      const y = padding.top + innerHeight - (d.netPay / (maxNetPay || 1)) * innerHeight;
      return { x, y, data: d, index: i };
    });
  }, [trendData, innerWidth, innerHeight, maxNetPay, padding]);

  // Generate smooth SVG Path using cubic Bézier
  const { linePath, areaPath } = useMemo(() => {
    if (!points || points.length === 0) return { linePath: '', areaPath: '' };
    const firstPoint = points[0];
    if (!firstPoint) return { linePath: '', areaPath: '' };

    if (points.length === 1) {
      return {
        linePath: `M ${firstPoint.x - 20} ${firstPoint.y} L ${firstPoint.x + 20} ${firstPoint.y}`,
        areaPath: `M ${firstPoint.x - 20} ${firstPoint.y} L ${firstPoint.x + 20} ${firstPoint.y} L ${firstPoint.x + 20} ${padding.top + innerHeight} L ${firstPoint.x - 20} ${padding.top + innerHeight} Z`,
      };
    }

    let dStr = `M ${firstPoint.x} ${firstPoint.y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      if (!p0 || !p1) continue;
      const cpX1 = p0.x + (p1.x - p0.x) / 2;
      const cpY1 = p0.y;
      const cpX2 = p0.x + (p1.x - p0.x) / 2;
      const cpY2 = p1.y;
      dStr += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
    }

    const firstX = firstPoint.x;
    const lastPoint = points[points.length - 1];
    const lastX = lastPoint ? lastPoint.x : firstX;
    const baseY = padding.top + innerHeight;
    const areaStr = `${dStr} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;

    return { linePath: dStr, areaPath: areaStr };
  }, [points, innerHeight, padding]);

  // ---------------------------------------------------------------------------
  // 3. Current Month Salary Composition (Donut Chart)
  // ---------------------------------------------------------------------------
  const donutData = useMemo(() => {
    const total = currentMetrics.estimatedNetPay;
    const basic = currentMetrics.basicSalary;
    const offDay = currentMetrics.sundayHolidayPay;

    if (total <= 0) {
      return {
        hasData: false,
        total: 0,
        basic: 0,
        offDay: 0,
        basicPct: 0,
        offDayPct: 0,
        radius: 68,
        circumference: 427.256,
        basicStroke: 0,
        offDayStroke: 0,
      };
    }

    const basicPct = Math.min(100, Math.round((basic / total) * 100));
    const offDayPct = Math.max(0, 100 - basicPct);

    // Circumference for r=68 is 2 * Math.PI * 68 = 427.256
    const radius = 68;
    const circumference = 2 * Math.PI * radius;

    const basicStroke = (basicPct / 100) * circumference;
    const offDayStroke = (offDayPct / 100) * circumference;

    return {
      hasData: true,
      total,
      basic,
      offDay,
      basicPct,
      offDayPct,
      radius,
      circumference,
      basicStroke,
      offDayStroke,
    };
  }, [currentMetrics]);

  // ---------------------------------------------------------------------------
  // 4. Current Month Day-by-Day Earnings Progression
  // ---------------------------------------------------------------------------
  const dailyBreakdown = useMemo(() => {
    const list: Array<{
      day: number;
      dateStr: string;
      weekday: string;
      earned: number;
      hours: number;
      type: 'present' | 'sunday' | 'holiday' | 'off' | 'absent' | 'future';
      cumulative: number;
    }> = [];

    const todayStr = new Date().toISOString().slice(0, 10);
    const daySecondsMap = new Map<string, number>();

    monthAttendance.forEach((log: any) => {
      const dStr = new Date(log.attendanceDate).toLocaleDateString('en-CA');
      let secs = 0;
      if (Array.isArray(log.punchPairs) && log.punchPairs.length > 0) {
        for (const p of log.punchPairs) {
          if (p?.punchInAt && p?.punchOutAt) {
            const diff = (new Date(p.punchOutAt).getTime() - new Date(p.punchInAt).getTime()) / 1000;
            if (diff > 0) secs += diff;
          }
        }
      } else if (log.punchInAt && log.punchOutAt) {
        const diff = (new Date(log.punchOutAt).getTime() - new Date(log.punchInAt).getTime()) / 1000;
        if (diff > 0) secs += diff;
      } else if (log.workedMinutes) {
        secs = log.workedMinutes * 60;
      }
      daySecondsMap.set(dStr, (daySecondsMap.get(dStr) || 0) + secs);
    });

    let runningTotal = 0;

    for (let d = 1; d <= currentMetrics.totalDaysInMonth; d++) {
      const dateStr = `${currentYear}-${String(currentMonthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dObj = new Date(currentYear, currentMonthNum - 1, d);
      const isSun = dObj.getDay() === 0;
      const isHol = holidaysList.some((h: any) => h.date?.slice(0, 10) === dateStr);
      const weekday = dObj.toLocaleDateString('en-IN', { weekday: 'narrow' });
      const secs = daySecondsMap.get(dateStr) || 0;
      const hours = Number((secs / 3600).toFixed(1));
      const isFuture = dateStr > todayStr;

      let earned = 0;
      let type: 'present' | 'sunday' | 'holiday' | 'off' | 'absent' | 'future' = 'future';

      if (isFuture) {
        type = 'future';
      } else if (isSun) {
        if (currentMetrics.paidSundays > 0) {
          earned = currentMetrics.perDaySalary;
          type = 'sunday';
        } else {
          type = 'off';
        }
      } else if (isHol) {
        if (currentMetrics.paidHolidays > 0) {
          earned = currentMetrics.perDaySalary;
          type = 'holiday';
        } else {
          type = 'off';
        }
      } else if (hours > 0) {
        earned = Math.round(hours * currentMetrics.hourRate);
        type = 'present';
      } else {
        type = 'absent';
      }

      runningTotal += earned;

      list.push({
        day: d,
        dateStr,
        weekday,
        earned,
        hours,
        type,
        cumulative: Math.round(runningTotal),
      });
    }

    return list;
  }, [monthAttendance, currentYear, currentMonthNum, currentMetrics, holidaysList]);

  const maxDailyEarned = useMemo(() => {
    return Math.max(...dailyBreakdown.map((d) => d.earned), currentMetrics.perDaySalary, 500);
  }, [dailyBreakdown, currentMetrics.perDaySalary]);

  return (
    <div className="space-y-4">
      {/* Visual Analytics Header & Quick Stat Chips */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Activity size={17} />
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
              <span>Salary Analytics & Visual Tracking</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                Interactive
              </span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Monitor monthly earnings progression, income distribution, and daily salary velocity.
            </p>
          </div>
        </div>

        {/* View Switcher: Monthly Trend vs Daily Accrual */}
        <div className="flex items-center bg-muted/50 p-0.5 rounded-xl border border-border/60 text-xs self-start md:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('trend')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
              activeTab === 'trend'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <TrendingUp size={13} />
            <span>Monthly Trend & Mix</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('daily')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
              activeTab === 'daily'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <BarChart3 size={13} />
            <span>Daily Velocity ({dailyBreakdown.length}d)</span>
          </button>
        </div>
      </div>

      {/* KPI Performance Metric Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-card border border-border/60 shadow-xs">
          <span className="text-[11px] text-muted-foreground font-medium">Cumulative Tracked</span>
          <div className="text-base font-bold text-foreground mt-0.5">
            ₹{kpiStats.totalEarnings.toLocaleString()}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <span className="text-emerald-600 font-semibold">{trendData.length} cycles</span> tracked
          </p>
        </div>

        <div className="p-3 rounded-xl bg-card border border-border/60 shadow-xs">
          <span className="text-[11px] text-muted-foreground font-medium">Monthly Average</span>
          <div className="text-base font-bold text-foreground mt-0.5">
            ₹{kpiStats.avgSalary.toLocaleString()}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Avg net payout / cycle
          </p>
        </div>

        <div className="p-3 rounded-xl bg-card border border-border/60 shadow-xs">
          <span className="text-[11px] text-muted-foreground font-medium">Month Run-Rate</span>
          <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
            ₹{kpiStats.projectedMonthNet.toLocaleString()}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Estimated end-of-month net
          </p>
        </div>

        <div className="p-3 rounded-xl bg-card border border-border/60 shadow-xs">
          <span className="text-[11px] text-muted-foreground font-medium">Peak Salary Cycle</span>
          <div className="text-base font-bold text-primary mt-0.5">
            ₹{(kpiStats.peakRecord?.netPay || 0).toLocaleString()}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {kpiStats.peakRecord?.fullLabel || '--'}
          </p>
        </div>
      </div>

      {/* Main Charts Viewport */}
      {activeTab === 'trend' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Chart 1: Smooth Area Line Chart (2 Cols) */}
          <Card className="lg:col-span-2 border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden flex flex-col justify-between">
            <CardHeader className="p-4 sm:p-5 border-b border-border/50 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm sm:text-base font-bold text-foreground flex items-center gap-1.5">
                    <span>Net Salary Trajectory</span>
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Month-over-month finalized net pay and current live estimate
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-xs" />
                    <span className="text-muted-foreground text-[11px] font-medium">Net Payout</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary/40" />
                    <span className="text-muted-foreground text-[11px] font-medium">Base Ref</span>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-4 sm:p-5 pt-3">
              {/* SVG Area & Line Chart */}
              <div className="relative w-full h-[220px] select-none">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full h-full overflow-visible"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="salaryGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
                    const y = padding.top + innerHeight * (1 - pct);
                    const val = Math.round(maxNetPay * pct);
                    return (
                      <g key={idx}>
                        <line
                          x1={padding.left}
                          y1={y}
                          x2={padding.left + innerWidth}
                          y2={y}
                          stroke="currentColor"
                          className="text-border/40"
                          strokeDasharray={pct === 0 ? undefined : '3 3'}
                          strokeWidth="1"
                        />
                        <text
                          x={padding.left - 6}
                          y={y + 3}
                          textAnchor="end"
                          className="text-[9px] fill-muted-foreground font-mono"
                        >
                          ₹{val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Monthly Base Reference Line */}
                  {currentMetrics.monthlySalary > 0 && (
                    <line
                      x1={padding.left}
                      y1={padding.top + innerHeight - (currentMetrics.monthlySalary / maxNetPay) * innerHeight}
                      x2={padding.left + innerWidth}
                      y2={padding.top + innerHeight - (currentMetrics.monthlySalary / maxNetPay) * innerHeight}
                      stroke="currentColor"
                      className="text-primary/40"
                      strokeDasharray="4 4"
                      strokeWidth="1.5"
                    />
                  )}

                  {/* Area Fill */}
                  {areaPath && (
                    <path
                      d={areaPath}
                      fill="url(#salaryGradient)"
                      className="transition-all duration-300"
                    />
                  )}

                  {/* Smooth Bézier Line */}
                  {linePath && (
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Points & Interactive Hover Circles */}
                  {points.map((p, idx) => {
                    const isHovered = hoveredPointIndex === idx;
                    const isLive = p.data.isLive;

                    return (
                      <g key={p.data.key} className="cursor-pointer">
                        {/* Hover Halo Ring */}
                        {isHovered && (
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r="11"
                            fill="#10b981"
                            opacity="0.25"
                            className="animate-ping"
                          />
                        )}

                        {/* Outer Circle */}
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={isHovered ? 6 : 4.5}
                          fill={isLive ? '#f59e0b' : '#10b981'}
                          stroke="white"
                          strokeWidth="2"
                          className="transition-all duration-200"
                          onMouseEnter={() => setHoveredPointIndex(idx)}
                          onMouseLeave={() => setHoveredPointIndex(null)}
                        />

                        {/* Month X-Axis Label */}
                        <text
                          x={p.x}
                          y={padding.top + innerHeight + 18}
                          textAnchor="middle"
                          className={`text-[10px] ${
                            isLive ? 'fill-amber-600 font-bold' : 'fill-muted-foreground font-medium'
                          }`}
                        >
                          {p.data.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* Floating Interactive Tooltip */}
                {hoveredPointIndex !== null && points[hoveredPointIndex] && (
                  <div
                    className="absolute z-20 pointer-events-none p-2.5 rounded-xl bg-popover/95 text-popover-foreground shadow-lg border border-border/70 backdrop-blur-md text-xs space-y-1 transition-all duration-150 -translate-x-1/2 -translate-y-full"
                    style={{
                      left: `${(points[hoveredPointIndex].x / chartWidth) * 100}%`,
                      top: `${(points[hoveredPointIndex].y / chartHeight) * 100 - 8}%`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-3 font-semibold pb-1 border-b border-border/50">
                      <span>{points[hoveredPointIndex].data.fullLabel}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                          points[hoveredPointIndex].data.isLive
                            ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {points[hoveredPointIndex].data.status}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4 text-muted-foreground text-[11px]">
                      <span>Net Salary:</span>
                      <span className="font-bold text-foreground">
                        ₹{points[hoveredPointIndex].data.netPay.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4 text-muted-foreground text-[11px]">
                      <span>Working Days:</span>
                      <span className="font-medium text-foreground">
                        {points[hoveredPointIndex].data.presentDays} Days
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Chart 2: Modern Donut / Mix Breakdown (1 Col) */}
          <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden flex flex-col justify-between">
            <CardHeader className="p-4 sm:p-5 border-b border-border/50 pb-3">
              <CardTitle className="text-sm sm:text-base font-bold text-foreground flex items-center gap-1.5">
                <PieChart size={15} className="text-primary" />
                <span>Earnings Composition</span>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Current month payout breakdown
              </CardDescription>
            </CardHeader>

            <CardContent className="p-4 sm:p-5 flex flex-col items-center justify-center">
              {donutData.hasData ? (
                <div className="relative w-44 h-44 flex items-center justify-center my-2">
                  <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 200 200">
                    {/* Background Ring */}
                    <circle
                      cx="100"
                      cy="100"
                      r={donutData.radius}
                      stroke="currentColor"
                      strokeWidth="16"
                      fill="transparent"
                      className="text-muted/30"
                    />

                    {/* Basic Hourly Segment */}
                    <circle
                      cx="100"
                      cy="100"
                      r={donutData.radius}
                      stroke="#10b981"
                      strokeWidth={hoveredDonutSegment === 'basic' ? '20' : '16'}
                      strokeDasharray={`${donutData.basicStroke} ${donutData.circumference}`}
                      strokeDashoffset="0"
                      strokeLinecap="round"
                      fill="transparent"
                      className="transition-all duration-300 cursor-pointer"
                      onMouseEnter={() => setHoveredDonutSegment('basic')}
                      onMouseLeave={() => setHoveredDonutSegment(null)}
                    />

                    {/* Sunday / Holiday Segment */}
                    {donutData.offDay > 0 && (
                      <circle
                        cx="100"
                        cy="100"
                        r={donutData.radius}
                        stroke="#8b5cf6"
                        strokeWidth={hoveredDonutSegment === 'offday' ? '20' : '16'}
                        strokeDasharray={`${donutData.offDayStroke} ${donutData.circumference}`}
                        strokeDashoffset={-donutData.basicStroke}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-300 cursor-pointer"
                        onMouseEnter={() => setHoveredDonutSegment('offday')}
                        onMouseLeave={() => setHoveredDonutSegment(null)}
                      />
                    )}
                  </svg>

                  {/* Center Text */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">Estimated</span>
                    <span className="text-lg font-bold text-foreground tracking-tight">
                      ₹{donutData.total.toLocaleString()}
                    </span>
                    <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Live Running
                    </span>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  <Clock size={24} className="mx-auto mb-1.5 opacity-40" />
                  <span>No earnings accumulated yet for this month</span>
                </div>
              )}

              {/* Minimalist Legend */}
              <div className="w-full space-y-1.5 pt-3 border-t border-border/40 text-xs">
                <div 
                  className={`flex items-center justify-between p-1.5 rounded-lg transition-colors cursor-pointer ${
                    hoveredDonutSegment === 'basic' ? 'bg-emerald-500/10' : 'hover:bg-muted/40'
                  }`}
                  onMouseEnter={() => setHoveredDonutSegment('basic')}
                  onMouseLeave={() => setHoveredDonutSegment(null)}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-foreground font-medium">Basic Hours</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-foreground">₹{currentMetrics.basicSalary.toLocaleString()}</span>
                    <span className="text-[10px] text-muted-foreground ml-1.5">({donutData.basicPct || 0}%)</span>
                  </div>
                </div>

                <div 
                  className={`flex items-center justify-between p-1.5 rounded-lg transition-colors cursor-pointer ${
                    hoveredDonutSegment === 'offday' ? 'bg-purple-500/10' : 'hover:bg-muted/40'
                  }`}
                  onMouseEnter={() => setHoveredDonutSegment('offday')}
                  onMouseLeave={() => setHoveredDonutSegment(null)}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-purple-500 shrink-0" />
                    <span className="text-foreground font-medium">Sun & Holiday Pay</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-foreground">₹{currentMetrics.sundayHolidayPay.toLocaleString()}</span>
                    <span className="text-[10px] text-muted-foreground ml-1.5">({donutData.offDayPct || 0}%)</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        /* View 2: Day-by-Day Salary Velocity & Cumulative Progression */
        <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden">
          <CardHeader className="p-4 sm:p-5 border-b border-border/50 pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm sm:text-base font-bold text-foreground flex items-center gap-1.5">
                  <BarChart3 size={16} className="text-primary" />
                  <span>Day-by-Day Earnings Progression ({currentMetrics.totalDaysInMonth} Days)</span>
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  Bar heights indicate daily amount earned; green is present, purple is paid Sunday/Holiday.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Present
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-purple-500" /> Paid Off-Day
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-rose-400" /> Absent
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/30" /> Off / Future
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-5">
            {/* Daily Bar Grid */}
            <div className="flex items-end gap-1 sm:gap-1.5 h-36 w-full pt-6 pb-2 px-1">
              {dailyBreakdown.map((d, idx) => {
                const heightPct = d.earned > 0 ? Math.max(8, (d.earned / maxDailyEarned) * 100) : 4;
                const isHovered = hoveredDayIndex === idx;

                let barColor = 'bg-muted/40';
                if (d.type === 'present') barColor = 'bg-emerald-500 hover:bg-emerald-600';
                else if (d.type === 'sunday' || d.type === 'holiday') barColor = 'bg-purple-500 hover:bg-purple-600';
                else if (d.type === 'absent') barColor = 'bg-rose-400/60';

                return (
                  <div
                    key={d.day}
                    className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
                    onMouseEnter={() => setHoveredDayIndex(idx)}
                    onMouseLeave={() => setHoveredDayIndex(null)}
                  >
                    {/* Hover Floating Tooltip */}
                    {isHovered && (
                      <div className="absolute bottom-full mb-2 z-30 pointer-events-none p-2 rounded-xl bg-popover text-popover-foreground border border-border shadow-md text-center text-[10px] whitespace-nowrap -translate-x-1/2 left-1/2">
                        <div className="font-bold">Day {d.day} ({d.weekday})</div>
                        <div className="text-emerald-600 dark:text-emerald-400 font-black">
                          {d.earned > 0 ? `₹${d.earned}` : d.type === 'absent' ? 'Absent (₹0)' : 'Off / Future'}
                        </div>
                        {d.hours > 0 && (
                          <div className="text-muted-foreground text-[9px]">{d.hours} hrs worked</div>
                        )}
                        <div className="text-muted-foreground text-[9px] border-t border-border/50 pt-0.5 mt-0.5">
                          Cumulative: ₹{d.cumulative.toLocaleString()}
                        </div>
                      </div>
                    )}

                    {/* Bar */}
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-t-md transition-all duration-200 ${barColor} ${
                        isHovered ? 'ring-2 ring-primary/60 scale-y-[1.05]' : ''
                      }`}
                    />

                    {/* Day Number */}
                    <span className={`text-[9px] mt-1 font-mono ${isHovered ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                      {d.day}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Bottom Cumulative Progress Bar */}
            <div className="mt-4 pt-3 border-t border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Current Cumulative Accrual:</span>
                <span className="font-extrabold text-foreground text-sm">
                  ₹{currentMetrics.estimatedNetPay.toLocaleString()}
                </span>
                <span className="text-muted-foreground text-[11px]">
                  of ₹{currentMetrics.monthlySalary.toLocaleString()} base
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-muted/50 h-2 rounded-full overflow-hidden border border-border/40">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.round((currentMetrics.estimatedNetPay / (currentMetrics.monthlySalary || 1)) * 100))}%`,
                    }}
                  />
                </div>
                <span className="font-bold text-foreground text-[11px]">
                  {Math.min(100, Math.round((currentMetrics.estimatedNetPay / (currentMetrics.monthlySalary || 1)) * 100))}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
