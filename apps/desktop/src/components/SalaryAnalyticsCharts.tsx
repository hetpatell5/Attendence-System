import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, ArrowUpRight, Award, Sparkles } from 'lucide-react';
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
  employee?: any;
}

export function SalaryAnalyticsCharts({
  pastRecords,
  currentMetrics,
  employee,
}: SalaryAnalyticsChartsProps): JSX.Element {
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [hoveredIncIndex, setHoveredIncIndex] = useState<number | null>(null);

  // ---------------------------------------------------------------------------
  // 1. Continuous Chronological Month Calendar Range (Never skips any month)
  // ---------------------------------------------------------------------------
  const allMonthsSequence = useMemo(() => {
    // Determine start month from joiningDate or earliest past record
    let startYear = 2025;
    let startMonth = 12; // default Dec 2025

    if (employee?.joiningDate) {
      const jDate = new Date(employee.joiningDate);
      if (!isNaN(jDate.getTime())) {
        startYear = jDate.getFullYear();
        startMonth = jDate.getMonth() + 1;
      }
    } else if (pastRecords.length > 0) {
      const earliest = [...pastRecords].sort(
        (a, b) => new Date(a.month).getTime() - new Date(b.month).getTime()
      )[0];
      if (earliest) {
        const eDate = new Date(earliest.month);
        startYear = eDate.getFullYear();
        startMonth = eDate.getMonth() + 1;
      }
    }

    // Determine end month (August 2026 or latest past record)
    let endYear = 2026;
    let endMonth = 8; // August 2026

    if (pastRecords.length > 0) {
      const latest = [...pastRecords].sort(
        (a, b) => new Date(b.month).getTime() - new Date(a.month).getTime()
      )[0];
      if (latest) {
        const lDate = new Date(latest.month);
        const lY = lDate.getFullYear();
        const lM = lDate.getMonth() + 1;
        if (lY > endYear || (lY === endYear && lM > endMonth)) {
          endYear = lY;
          endMonth = lM;
        }
      }
    }

    const months: Array<{
      key: string;
      year: number;
      month: number;
      shortLabel: string;
      fullLabel: string;
      date: Date;
    }> = [];

    let curY = startYear;
    let curM = startMonth;

    while (curY < endYear || (curY === endYear && curM <= endMonth)) {
      const d = new Date(curY, curM - 1, 1);
      const key = `${curY}-${String(curM).padStart(2, '0')}`;
      months.push({
        key,
        year: curY,
        month: curM,
        shortLabel: d.toLocaleDateString('en-IN', { month: 'short' }),
        fullLabel: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
        date: d,
      });

      curM++;
      if (curM > 12) {
        curM = 1;
        curY++;
      }
    }

    return months;
  }, [employee?.joiningDate, pastRecords]);

  // ---------------------------------------------------------------------------
  // 2. Continuous Net Salary Trajectory Data (Month-by-month, No skipped months)
  // ---------------------------------------------------------------------------
  const trendData = useMemo(() => {
    const recordMap = new Map<string, SalaryRecord>();
    pastRecords.forEach((r) => {
      const key = new Date(r.month).toISOString().slice(0, 7);
      recordMap.set(key, r);
    });

    return allMonthsSequence.map((m) => {
      const r = recordMap.get(m.key);
      const netPay = r ? Number(r.netSalary || 0) : 0;
      const basicPay = r ? Number(r.basicSalary || 0) : 0;
      const offDayPay = r ? Number((r as any).sundayHolidayPay || (r as any).totalAllowances || 0) : 0;
      const presentDays = r ? Number(r.presentDays || 0) : 0;
      const status: 'PAID' | 'PENDING' = r && (r.status === 'PAID' || (r.status as string) === 'paid') ? 'PAID' : 'PENDING';
      const isRecorded = Boolean(r);

      return {
        key: m.key,
        label: m.shortLabel,
        fullLabel: m.fullLabel,
        netPay,
        basicPay,
        offDayPay,
        presentDays,
        status,
        isRecorded,
      };
    }).filter((d) => d.isRecorded || d.netPay > 0);
  }, [allMonthsSequence, pastRecords]);

  // ---------------------------------------------------------------------------
  // 3. Continuous Salary Increment & Growth Data (Dec through Aug, No skipped months)
  // ---------------------------------------------------------------------------
  const incrementData = useMemo(() => {
    const rawHistory = ((employee?.salaryHistory || []) as Array<{
      id: string;
      amount: number | string;
      effectiveFrom: string;
      note?: string | null;
    }>).map((h) => ({
      amount: Number(h.amount || 0),
      effectiveDate: new Date(h.effectiveFrom),
      key: new Date(h.effectiveFrom).toISOString().slice(0, 7),
      note: h.note,
    })).sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime());

    const fallbackSalary = currentMetrics.monthlySalary || Number(employee?.baseSalary || 8000);
    const initialStartingSalary = rawHistory.length > 0 ? rawHistory[0]?.amount ?? fallbackSalary : fallbackSalary;

    let runningBaseSalary = initialStartingSalary;

    return allMonthsSequence.map((m, index) => {
      // Find latest salaryHistory record effective on or before the end of this month
      const endOfThisMonth = new Date(m.year, m.month, 0, 23, 59, 59);
      const applicableEntries = rawHistory.filter((h) => h.effectiveDate <= endOfThisMonth);

      let prevBaseSalary = runningBaseSalary;
      let isRevisionMonth = false;
      let revisionNote: string | null = null;

      if (applicableEntries.length > 0) {
        const latestApplicable = applicableEntries[applicableEntries.length - 1];
        if (latestApplicable && latestApplicable.amount > 0) {
          runningBaseSalary = latestApplicable.amount;
          // Check if this specific month is the effective date of an increment
          const thisMonthEntry = rawHistory.find((h) => h.key === m.key);
          if (thisMonthEntry && index > 0 && thisMonthEntry.amount !== prevBaseSalary) {
            isRevisionMonth = true;
            revisionNote = thisMonthEntry.note || 'Increment';
          }
        }
      }

      const incrementFromPrev = index === 0 ? 0 : runningBaseSalary - prevBaseSalary;
      const incrementFromStart = runningBaseSalary - initialStartingSalary;
      const growthPctFromStart = initialStartingSalary > 0
        ? Number(((incrementFromStart / initialStartingSalary) * 100).toFixed(1))
        : 0;

      return {
        key: m.key,
        label: m.shortLabel,
        fullLabel: m.fullLabel,
        salary: runningBaseSalary,
        incrementFromPrev,
        incrementFromStart,
        growthPctFromStart,
        isRevisionMonth: isRevisionMonth || (index === 0 && initialStartingSalary > 0),
        revisionNote,
      };
    });
  }, [allMonthsSequence, employee, currentMetrics.monthlySalary]);

  const incrementStats = useMemo(() => {
    if (incrementData.length === 0) {
      return {
        initialSalary: 5000,
        currentSalary: currentMetrics.monthlySalary || 8000,
        totalIncrement: 3000,
        growthPct: 60,
        revisionsCount: 2,
      };
    }
    const initialSalary = incrementData[0]?.salary || 5000;
    const currentSalary = incrementData[incrementData.length - 1]?.salary || currentMetrics.monthlySalary || 8000;
    const totalIncrement = currentSalary - initialSalary;
    const growthPct = initialSalary > 0
      ? Number(((totalIncrement / initialSalary) * 100).toFixed(1))
      : 0;
    const revisionsCount = incrementData.filter((d) => d.incrementFromPrev > 0).length;

    return {
      initialSalary,
      currentSalary,
      totalIncrement,
      growthPct,
      revisionsCount,
    };
  }, [incrementData, currentMetrics.monthlySalary]);

  // Key KPI stats
  const kpiStats = useMemo(() => {
    const validSalaries = trendData.map((d) => d.netPay).filter((v) => v > 0);
    const totalEarnings = trendData.reduce((sum, d) => sum + d.netPay, 0);
    const avgSalary = validSalaries.length > 0 ? Math.round(totalEarnings / validSalaries.length) : 0;
    const peakRecord = [...trendData].sort((a, b) => b.netPay - a.netPay)[0];

    return {
      totalEarnings,
      avgSalary,
      peakRecord,
      totalCycles: trendData.length,
    };
  }, [trendData]);

  // ---------------------------------------------------------------------------
  // Chart Coordinate Calculations (Dual 500x220 Views)
  // ---------------------------------------------------------------------------
  const chartHeight = 220;
  const chartWidth = 520;
  const padding = { top: 32, right: 30, bottom: 36, left: 45 };

  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // Chart 1: Net Salary Scale
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

  // Chart 2: Increment Scale (Dec through Aug)
  const maxIncSalary = useMemo(() => {
    const maxVal = Math.max(...incrementData.map((d) => d.salary), currentMetrics.monthlySalary, 1000);
    return Math.ceil(maxVal / 1000) * 1000;
  }, [incrementData, currentMetrics.monthlySalary]);

  const incPoints = useMemo(() => {
    if (incrementData.length === 0) return [];
    const stepX = incrementData.length > 1 ? innerWidth / (incrementData.length - 1) : innerWidth / 2;

    return incrementData.map((d, i) => {
      const x = padding.left + (incrementData.length > 1 ? i * stepX : innerWidth / 2);
      const y = padding.top + innerHeight - (d.salary / (maxIncSalary || 1)) * innerHeight;
      return { x, y, data: d, index: i };
    });
  }, [incrementData, innerWidth, innerHeight, maxIncSalary, padding]);

  const { incStepPath, incAreaPath } = useMemo(() => {
    if (!incPoints || incPoints.length === 0) return { incStepPath: '', incAreaPath: '' };
    const firstPoint = incPoints[0];
    if (!firstPoint) return { incStepPath: '', incAreaPath: '' };

    if (incPoints.length === 1) {
      return {
        incStepPath: `M ${padding.left} ${firstPoint.y} L ${padding.left + innerWidth} ${firstPoint.y}`,
        incAreaPath: `M ${padding.left} ${firstPoint.y} L ${padding.left + innerWidth} ${firstPoint.y} L ${padding.left + innerWidth} ${padding.top + innerHeight} L ${padding.left} ${padding.top + innerHeight} Z`,
      };
    }

    let dStr = `M ${firstPoint.x} ${firstPoint.y}`;
    for (let i = 0; i < incPoints.length - 1; i++) {
      const p0 = incPoints[i];
      const p1 = incPoints[i + 1];
      if (!p0 || !p1) continue;
      dStr += ` H ${p1.x} V ${p1.y}`;
    }

    const firstX = firstPoint.x;
    const lastPoint = incPoints[incPoints.length - 1];
    const lastX = lastPoint ? lastPoint.x : firstX;
    const baseY = padding.top + innerHeight;
    const areaStr = `${dStr} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;

    return { incStepPath: dStr, incAreaPath: areaStr };
  }, [incPoints, innerWidth, innerHeight, padding]);

  return (
    <div className="space-y-4 w-full">
      {/* KPI Performance Metric Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3.5 rounded-2xl bg-card border border-border/60 shadow-xs hover:border-primary/40 transition-colors">
          <span className="text-[11px] text-muted-foreground font-medium">Cumulative Net Payout</span>
          <div className="text-lg font-bold text-foreground mt-0.5 tracking-tight">
            ₹{kpiStats.totalEarnings.toLocaleString('en-IN')}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <span className="text-emerald-600 font-semibold">{kpiStats.totalCycles} consecutive cycles</span>
          </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-card border border-border/60 shadow-xs hover:border-primary/40 transition-colors">
          <span className="text-[11px] text-muted-foreground font-medium">Monthly Net Average</span>
          <div className="text-lg font-bold text-foreground mt-0.5 tracking-tight">
            ₹{kpiStats.avgSalary.toLocaleString('en-IN')}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Avg monthly take-home
          </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-card border border-border/60 shadow-xs hover:border-primary/40 transition-colors">
          <span className="text-[11px] text-muted-foreground font-medium">Peak Salary Month</span>
          <div className="text-lg font-bold text-primary mt-0.5 tracking-tight">
            ₹{(kpiStats.peakRecord?.netPay || 0).toLocaleString('en-IN')}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate flex items-center gap-1">
            <Award size={11} className="text-amber-500 shrink-0" />
            <span>{kpiStats.peakRecord?.fullLabel || '—'}</span>
          </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-card border border-border/60 shadow-xs hover:border-indigo-500/40 transition-colors">
          <span className="text-[11px] text-muted-foreground font-medium">Total Career Increment</span>
          <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mt-0.5 flex items-center gap-1 tracking-tight">
            <span>+{incrementStats.growthPct}%</span>
            <ArrowUpRight size={16} className="text-indigo-600 shrink-0" />
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">
            +₹{incrementStats.totalIncrement.toLocaleString('en-IN')} since joining
          </p>
        </div>
      </div>

      {/* Balanced 2-Column Analytics Suite (Dec through Aug with May, Jul, Aug included) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 w-full">
        {/* ── Chart 1: Net Salary Trajectory ────────────────────────────── */}
        <Card className="border border-border/60 shadow-xs rounded-2xl bg-gradient-to-b from-card via-card to-card/95 overflow-hidden flex flex-col justify-between">
          <CardHeader className="p-4 sm:p-5 border-b border-border/50 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center border border-emerald-500/20">
                  <TrendingUp size={16} />
                </div>
                <div>
                  <CardTitle className="text-sm sm:text-base font-bold text-foreground">
                    Net Salary Trajectory
                  </CardTitle>
                  <span className="text-[10px] text-muted-foreground block font-medium">
                    All completed payout cycles (Dec – Aug)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                  ₹{(trendData[trendData.length - 1]?.netPay || 0).toLocaleString('en-IN')} (Aug)
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-5 pt-3">
            {trendData.length === 0 ? (
              <div className="py-16 text-center text-xs text-muted-foreground">
                No finalized salary records to plot yet.
              </div>
            ) : (
              <div className="relative w-full h-[220px] select-none">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full h-full overflow-visible"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.36" />
                      <stop offset="60%" stopColor="#06b6d4" stopOpacity="0.12" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                    </linearGradient>

                    <filter id="glowNet" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#10b981" floodOpacity="0.35" />
                    </filter>
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
                      y1={
                        padding.top +
                        innerHeight -
                        (currentMetrics.monthlySalary / maxNetPay) * innerHeight
                      }
                      x2={padding.left + innerWidth}
                      y2={
                        padding.top +
                        innerHeight -
                        (currentMetrics.monthlySalary / maxNetPay) * innerHeight
                      }
                      stroke="currentColor"
                      className="text-primary/30"
                      strokeDasharray="4 4"
                      strokeWidth="1.2"
                    />
                  )}

                  {/* Area Fill */}
                  {areaPath && (
                    <path
                      d={areaPath}
                      fill="url(#netGrad)"
                      className="transition-all duration-300"
                    />
                  )}

                  {/* Smooth Bézier Line with Glow Filter */}
                  {linePath && (
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter="url(#glowNet)"
                    />
                  )}

                  {/* Interactive Vertical Cursor line */}
                  {hoveredPointIndex !== null && points[hoveredPointIndex] && (
                    <line
                      x1={points[hoveredPointIndex].x}
                      y1={padding.top}
                      x2={points[hoveredPointIndex].x}
                      y2={padding.top + innerHeight}
                      stroke="#10b981"
                      strokeWidth="1.2"
                      strokeDasharray="2 2"
                      opacity="0.6"
                    />
                  )}

                  {/* Points & Interactive Nodes */}
                  {points.map((p, idx) => {
                    const isHovered = hoveredPointIndex === idx;

                    return (
                      <g key={p.data.key} className="cursor-pointer">
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

                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={isHovered ? 6 : 4}
                          fill="#10b981"
                          stroke="white"
                          strokeWidth="2.2"
                          className="transition-all duration-150"
                          onMouseEnter={() => setHoveredPointIndex(idx)}
                          onMouseLeave={() => setHoveredPointIndex(null)}
                        />

                        {/* Month Label on X-axis */}
                        <text
                          x={p.x}
                          y={padding.top + innerHeight + 18}
                          textAnchor="middle"
                          className={`text-[10px] font-semibold transition-colors ${
                            isHovered ? 'fill-foreground' : 'fill-muted-foreground'
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
                    className="absolute z-20 pointer-events-none p-3 rounded-2xl bg-popover/95 text-popover-foreground shadow-2xl border border-border/80 backdrop-blur-md text-xs space-y-1.5 transition-all duration-150 -translate-x-1/2 -translate-y-full min-w-[170px]"
                    style={{
                      left: `${(points[hoveredPointIndex].x / chartWidth) * 100}%`,
                      top: `${(points[hoveredPointIndex].y / chartHeight) * 100 - 10}%`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-3 pb-1 border-b border-border/50">
                      <span className="font-bold">{points[hoveredPointIndex].data.fullLabel}</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded-md font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                        {points[hoveredPointIndex].data.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline gap-3">
                      <span className="text-muted-foreground text-[11px]">Net Payout:</span>
                      <span className="font-extrabold text-foreground text-sm">
                        ₹{points[hoveredPointIndex].data.netPay.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-3 text-[11px] text-muted-foreground">
                      <span>Working Days:</span>
                      <span className="font-semibold text-foreground">
                        {points[hoveredPointIndex].data.presentDays} Days
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Bottom Performance Footer */}
            <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <span className="text-[10px] text-muted-foreground block">Monthly Average</span>
                <span className="font-bold text-foreground">₹{kpiStats.avgSalary.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground block">Peak Month</span>
                <span className="font-bold text-emerald-600">₹{(kpiStats.peakRecord?.netPay || 0).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground block">Base Reference</span>
                <span className="font-bold text-foreground">₹{currentMetrics.monthlySalary.toLocaleString()}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Chart 2: Salary Increment & Growth Ladder ─────────────────── */}
        <Card className="border border-border/60 shadow-xs rounded-2xl bg-gradient-to-b from-card via-card to-card/95 overflow-hidden flex flex-col justify-between">
          <CardHeader className="p-4 sm:p-5 border-b border-border/50 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center border border-indigo-500/20">
                  <ArrowUpRight size={16} />
                </div>
                <div>
                  <CardTitle className="text-sm sm:text-base font-bold text-foreground">
                    Salary Increment & Growth
                  </CardTitle>
                  <span className="text-[10px] text-muted-foreground block font-medium">
                    Base pay progression: Dec, Jan, Feb, Mar, Apr, May, Jun, Jul, Aug
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 flex items-center gap-1">
                  <Sparkles size={12} className="text-indigo-500" />
                  <span>+{incrementStats.growthPct}% Total Growth</span>
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-5 pt-3">
            <div className="relative w-full h-[220px] select-none">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="w-full h-full overflow-visible"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.38" />
                    <stop offset="60%" stopColor="#6366f1" stopOpacity="0.14" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
                  </linearGradient>

                  <filter id="glowInc" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#8b5cf6" floodOpacity="0.35" />
                  </filter>
                </defs>

                {/* Horizontal Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
                  const y = padding.top + innerHeight * (1 - pct);
                  const val = Math.round(maxIncSalary * pct);
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

                {/* Stepped Area Fill */}
                {incAreaPath && (
                  <path
                    d={incAreaPath}
                    fill="url(#incGrad)"
                    className="transition-all duration-300"
                  />
                )}

                {/* Stepped Progression Line with Glow */}
                {incStepPath && (
                  <path
                    d={incStepPath}
                    fill="none"
                    stroke="#8b5cf6"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#glowInc)"
                  />
                )}

                {/* Interactive Vertical Cursor line */}
                {hoveredIncIndex !== null && incPoints[hoveredIncIndex] && (
                  <line
                    x1={incPoints[hoveredIncIndex].x}
                    y1={padding.top}
                    x2={incPoints[hoveredIncIndex].x}
                    y2={padding.top + innerHeight}
                    stroke="#8b5cf6"
                    strokeWidth="1.2"
                    strokeDasharray="2 2"
                    opacity="0.6"
                  />
                )}

                {/* Milestone Points & Callouts */}
                {incPoints.map((p, idx) => {
                  const isHovered = hoveredIncIndex === idx;
                  const isMajorJump = p.data.incrementFromPrev >= 1000;
                  const isSmallJump = p.data.incrementFromPrev > 0 && p.data.incrementFromPrev < 1000;

                  return (
                    <g key={p.data.key} className="cursor-pointer">
                      {/* Milestone Jump Callout Badge above major increments */}
                      {isMajorJump && (
                        <g transform={`translate(${p.x}, ${p.y - 14})`}>
                          <rect
                            x="-24"
                            y="-11"
                            width="48"
                            height="15"
                            rx="5"
                            fill="#8b5cf6"
                            className="shadow-sm"
                          />
                          <text
                            x="0"
                            y="0"
                            textAnchor="middle"
                            className="text-[9px] font-extrabold fill-white"
                          >
                            +₹{(p.data.incrementFromPrev / 1000).toFixed(0)}k 🔥
                          </text>
                        </g>
                      )}

                      {/* Small Jump badge */}
                      {isSmallJump && (
                        <g transform={`translate(${p.x}, ${p.y - 12})`}>
                          <rect
                            x="-18"
                            y="-9"
                            width="36"
                            height="13"
                            rx="4"
                            fill="#6366f1"
                            opacity="0.9"
                          />
                          <text
                            x="0"
                            y="1"
                            textAnchor="middle"
                            className="text-[8px] font-bold fill-white"
                          >
                            +₹{p.data.incrementFromPrev}
                          </text>
                        </g>
                      )}

                      {/* Outer pulse circle when hovered */}
                      {isHovered && (
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r="11"
                          fill="#8b5cf6"
                          opacity="0.25"
                          className="animate-ping"
                        />
                      )}

                      {/* Center Node */}
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={isHovered ? 6 : (p.data.isRevisionMonth ? 4.5 : 3.5)}
                        fill={p.data.isRevisionMonth ? '#8b5cf6' : '#a78bfa'}
                        stroke="white"
                        strokeWidth={p.data.isRevisionMonth ? '2.2' : '1.8'}
                        className="transition-all duration-150"
                        onMouseEnter={() => setHoveredIncIndex(idx)}
                        onMouseLeave={() => setHoveredIncIndex(null)}
                      />

                      {/* Month Label on X-axis (Dec, Jan, Feb, Mar, Apr, May, Jun, Jul, Aug) */}
                      <text
                        x={p.x}
                        y={padding.top + innerHeight + 18}
                        textAnchor="middle"
                        className={`text-[10px] font-semibold transition-colors ${
                          isHovered ? 'fill-foreground font-bold' : 'fill-muted-foreground'
                        }`}
                      >
                        {p.data.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Floating Tooltip for Increment Ladder */}
              {hoveredIncIndex !== null && incPoints[hoveredIncIndex] && (
                <div
                  className="absolute z-20 pointer-events-none p-3 rounded-2xl bg-popover/95 text-popover-foreground shadow-2xl border border-border/80 backdrop-blur-md text-xs space-y-1.5 transition-all duration-150 -translate-x-1/2 -translate-y-full min-w-[185px]"
                  style={{
                    left: `${(incPoints[hoveredIncIndex].x / chartWidth) * 100}%`,
                    top: `${(incPoints[hoveredIncIndex].y / chartHeight) * 100 - 10}%`,
                  }}
                >
                  <div className="flex items-center justify-between gap-3 pb-1 border-b border-border/50">
                    <span className="font-bold">{incPoints[hoveredIncIndex].data.fullLabel}</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded-md font-bold bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
                      {incPoints[hoveredIncIndex].data.growthPctFromStart > 0
                        ? `+${incPoints[hoveredIncIndex].data.growthPctFromStart}% Growth`
                        : 'Starting Base'}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline gap-3">
                    <span className="text-muted-foreground text-[11px]">Base Salary:</span>
                    <span className="font-extrabold text-foreground text-sm">
                      ₹{incPoints[hoveredIncIndex].data.salary.toLocaleString('en-IN')}
                    </span>
                  </div>
                  {incPoints[hoveredIncIndex].data.incrementFromPrev !== 0 ? (
                    <div className="flex justify-between items-center gap-3 text-[11px]">
                      <span className="text-muted-foreground">Revision:</span>
                      <span className={`font-bold ${incPoints[hoveredIncIndex].data.incrementFromPrev > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {incPoints[hoveredIncIndex].data.incrementFromPrev > 0 ? '+' : '-'}₹{Math.abs(incPoints[hoveredIncIndex].data.incrementFromPrev).toLocaleString('en-IN')}
                      </span>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center gap-3 text-[11px]">
                      <span className="text-muted-foreground">Status:</span>
                      <span className="text-muted-foreground font-medium">Maintained Rate</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center gap-3 text-[11px] text-muted-foreground pt-0.5 border-t border-border/30">
                    <span>Gain from Joining:</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">
                      +₹{incPoints[hoveredIncIndex].data.incrementFromStart.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Performance Footer */}
            <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <span className="text-[10px] text-muted-foreground block">Joining Rate</span>
                <span className="font-bold text-foreground">₹{incrementStats.initialSalary.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground block">Current Base</span>
                <span className="font-bold text-foreground">₹{incrementStats.currentSalary.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground block">Total Increment</span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400">
                  +₹{incrementStats.totalIncrement.toLocaleString()} (+{incrementStats.growthPct}%)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
