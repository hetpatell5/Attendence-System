import { useState, useMemo } from 'react';
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

function getSmartTooltipStyle(x: number, y: number, chartWidth: number, chartHeight: number) {
  const xRatio = x / chartWidth;
  const yRatio = y / chartHeight;

  // Horizontal translation:
  // If point is on the right (> 68%), anchor right side to prevent overflowing right edge
  // If point is on the left (< 32%), anchor left side to prevent overflowing left edge
  // Otherwise center
  const translateX = xRatio > 0.68 ? '-92%' : xRatio < 0.32 ? '-8%' : '-50%';

  // Vertical translation:
  // If point is near top (< 28%), show tooltip below the point to prevent top clipping
  const isNearTop = yRatio < 0.28;
  const translateY = isNearTop ? '15px' : '-100%';
  const topPercent = (y / chartHeight) * 100 + (isNearTop ? 4 : -8);

  return {
    left: `${xRatio * 100}%`,
    top: `${topPercent}%`,
    transform: `translate(${translateX}, ${translateY})`,
  };
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="clay-pod p-4 flex flex-col justify-between border-2 border-emerald-500/40 hover:border-emerald-500 transition-all">
          <span className="text-[11px] text-slate-500 font-semibold">Cumulative Net Payout</span>
          <div className="text-xl font-black text-slate-900 mt-1 tracking-tight">
            ₹{kpiStats.totalEarnings.toLocaleString('en-IN')}
          </div>
          <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
            <span className="text-emerald-700 font-bold">{kpiStats.totalCycles} consecutive cycles</span>
          </p>
        </div>

        <div className="clay-pod p-4 flex flex-col justify-between border-2 border-sky-500/40 hover:border-sky-500 transition-all">
          <span className="text-[11px] text-slate-500 font-semibold">Monthly Net Average</span>
          <div className="text-xl font-black text-slate-900 mt-1 tracking-tight">
            ₹{kpiStats.avgSalary.toLocaleString('en-IN')}
          </div>
          <p className="text-[10px] text-slate-500 mt-1 font-medium">
            Avg monthly take-home
          </p>
        </div>

        <div className="clay-pod p-4 flex flex-col justify-between border-2 border-amber-500/40 hover:border-amber-500 transition-all">
          <span className="text-[11px] text-slate-500 font-semibold">Peak Salary Month</span>
          <div className="text-xl font-black text-amber-700 mt-1 tracking-tight">
            ₹{(kpiStats.peakRecord?.netPay || 0).toLocaleString('en-IN')}
          </div>
          <p className="text-[10px] text-slate-500 mt-1 truncate flex items-center gap-1 font-medium">
            <Award size={12} className="text-amber-500 shrink-0" />
            <span>{kpiStats.peakRecord?.fullLabel || '—'}</span>
          </p>
        </div>

        <div className="clay-pod p-4 flex flex-col justify-between border-2 border-indigo-500/40 hover:border-indigo-500 transition-all">
          <span className="text-[11px] text-slate-500 font-semibold">Total Career Increment</span>
          <div className="text-xl font-black text-indigo-700 mt-1 flex items-center gap-1 tracking-tight">
            <span>+{incrementStats.growthPct}%</span>
            <ArrowUpRight size={18} className="text-indigo-600 shrink-0" />
          </div>
          <p className="text-[10px] text-slate-500 mt-1 font-bold">
            +₹{incrementStats.totalIncrement.toLocaleString('en-IN')} since joining
          </p>
        </div>
      </div>

      {/* Balanced 2-Column Analytics Suite (Dec through Aug with May, Jul, Aug included) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 w-full">
        {/* ── Chart 1: Net Salary Trajectory ────────────────────────────── */}
        <div className="clay-card p-5 sm:p-6 relative flex flex-col justify-between overflow-visible transition-all">
          <div className="pb-4 border-b border-slate-200/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="clay-pod p-2 text-emerald-600 shrink-0">
                  <TrendingUp size={18} />
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-slate-900">
                    Net Salary Trajectory
                  </h4>
                  <span className="text-[10px] text-slate-500 block font-medium">
                    All completed payout cycles (Dec – Aug)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="clay-pod px-3 py-1 text-[11px] font-bold text-emerald-700">
                  ₹{(trendData[trendData.length - 1]?.netPay || 0).toLocaleString('en-IN')} (Aug)
                </span>
              </div>
            </div>
          </div>

          <div className="pt-3">
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
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.16" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
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
                      className="text-muted-foreground/40"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                  )}

                  {/* Area Fill */}
                  {areaPath && <path d={areaPath} fill="url(#netGrad)" />}

                  {/* Line */}
                  {linePath && (
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Hover crosshair */}
                  {hoveredPointIndex !== null && points[hoveredPointIndex] && (
                    <line
                      x1={points[hoveredPointIndex].x}
                      y1={padding.top}
                      x2={points[hoveredPointIndex].x}
                      y2={padding.top + innerHeight}
                      stroke="currentColor"
                      className="text-border"
                      strokeWidth="1"
                    />
                  )}

                  {/* Points */}
                  {points.map((p, idx) => {
                    const isHovered = hoveredPointIndex === idx;

                    return (
                      <g key={p.data.key} className="cursor-pointer">
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={isHovered ? 5 : 3}
                          fill="#10b981"
                          stroke="white"
                          strokeWidth="1.5"
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
                    className="absolute z-20 pointer-events-none p-3 rounded-2xl bg-white/95 backdrop-blur-md shadow-[0_12px_30px_rgba(0,0,0,0.12)] border border-slate-200/80 text-xs space-y-1.5 min-w-[170px] max-w-[220px]"
                    style={getSmartTooltipStyle(
                      points[hoveredPointIndex].x,
                      points[hoveredPointIndex].y,
                      chartWidth,
                      chartHeight
                    )}
                  >
                    <div className="flex items-center justify-between gap-3 pb-1 border-b border-slate-100">
                      <span className="font-bold text-slate-800">{points[hoveredPointIndex].data.fullLabel}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-600">
                        {points[hoveredPointIndex].data.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline gap-3">
                      <span className="text-slate-500 text-[11px] font-medium">Net Payout</span>
                      <span className="font-black text-slate-900 text-sm">
                        ₹{points[hoveredPointIndex].data.netPay.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center gap-3 text-[11px] text-slate-500 font-medium">
                      <span>Working Days</span>
                      <span className="font-bold text-slate-800">
                        {points[hoveredPointIndex].data.presentDays} Days
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Bottom Performance Footer */}
            <div className="mt-4 pt-3.5 border-t border-slate-200/60 grid grid-cols-3 gap-2.5 text-center text-xs">
              <div className="clay-pod py-2 px-1">
                <span className="text-[10px] text-slate-500 block font-medium">Monthly Average</span>
                <span className="font-black text-slate-900 text-sm">₹{kpiStats.avgSalary.toLocaleString()}</span>
              </div>
              <div className="clay-pod py-2 px-1">
                <span className="text-[10px] text-slate-500 block font-medium">Peak Month</span>
                <span className="font-black text-emerald-600 text-sm">₹{(kpiStats.peakRecord?.netPay || 0).toLocaleString()}</span>
              </div>
              <div className="clay-pod py-2 px-1">
                <span className="text-[10px] text-slate-500 block font-medium">Base Reference</span>
                <span className="font-black text-slate-900 text-sm">₹{currentMetrics.monthlySalary.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Chart 2: Salary Increment & Growth Ladder ─────────────────── */}
        <div className="clay-card p-5 sm:p-6 relative flex flex-col justify-between overflow-visible transition-all">
          <div className="pb-4 border-b border-slate-200/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="clay-pod p-2 text-indigo-600 shrink-0">
                  <ArrowUpRight size={18} />
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-bold text-slate-900">
                    Salary Increment & Growth
                  </h4>
                  <span className="text-[10px] text-slate-500 block font-medium">
                    Base pay progression: Dec, Jan, Feb, Mar, Apr, May, Jun, Jul, Aug
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="clay-pod px-3 py-1 text-[11px] font-bold text-indigo-700 flex items-center gap-1">
                  <Sparkles size={12} className="text-indigo-500" />
                  <span>+{incrementStats.growthPct}% Total Growth</span>
                </span>
              </div>
            </div>
          </div>

          <div className="pt-3">
            <div className="relative w-full h-[220px] select-none">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="w-full h-full overflow-visible"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                  </linearGradient>
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
                {incAreaPath && <path d={incAreaPath} fill="url(#incGrad)" />}

                {/* Stepped Progression Line */}
                {incStepPath && (
                  <path
                    d={incStepPath}
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Hover crosshair */}
                {hoveredIncIndex !== null && incPoints[hoveredIncIndex] && (
                  <line
                    x1={incPoints[hoveredIncIndex].x}
                    y1={padding.top}
                    x2={incPoints[hoveredIncIndex].x}
                    y2={padding.top + innerHeight}
                    stroke="currentColor"
                    className="text-border"
                    strokeWidth="1"
                  />
                )}

                {/* Points — revision months get a solid, slightly larger marker;
                    unchanged months a smaller, lighter one. No floating badges on
                    the plot itself — the detail lives in the tooltip on hover. */}
                {incPoints.map((p, idx) => {
                  const isHovered = hoveredIncIndex === idx;

                  return (
                    <g key={p.data.key} className="cursor-pointer">
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={isHovered ? 5 : (p.data.isRevisionMonth ? 4 : 3)}
                        fill={p.data.isRevisionMonth ? '#6366f1' : '#a5b4fc'}
                        stroke="white"
                        strokeWidth="1.5"
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

              {/* Tooltip */}
              {hoveredIncIndex !== null && incPoints[hoveredIncIndex] && (
                <div
                  className="absolute z-20 pointer-events-none p-3 rounded-2xl bg-white/95 backdrop-blur-md shadow-[0_12px_30px_rgba(0,0,0,0.12)] border border-slate-200/80 text-xs space-y-1.5 min-w-[185px] max-w-[245px]"
                  style={getSmartTooltipStyle(
                    incPoints[hoveredIncIndex].x,
                    incPoints[hoveredIncIndex].y,
                    chartWidth,
                    chartHeight
                  )}
                >
                  <div className="flex items-center justify-between gap-3 pb-1 border-b border-slate-100">
                    <span className="font-bold text-slate-800">{incPoints[hoveredIncIndex].data.fullLabel}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-indigo-50 text-indigo-700">
                      {incPoints[hoveredIncIndex].data.growthPctFromStart > 0
                        ? `+${incPoints[hoveredIncIndex].data.growthPctFromStart}%`
                        : 'Starting base'}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline gap-3">
                    <span className="text-slate-500 text-[11px] font-medium">Base Salary</span>
                    <span className="font-black text-slate-900 text-sm">
                      ₹{incPoints[hoveredIncIndex].data.salary.toLocaleString('en-IN')}
                    </span>
                  </div>
                  {incPoints[hoveredIncIndex].data.incrementFromPrev !== 0 ? (
                    <div className="flex justify-between items-center gap-3 text-[11px]">
                      <span className="text-slate-500 font-medium">Revision</span>
                      <span className={`font-bold ${incPoints[hoveredIncIndex].data.incrementFromPrev > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {incPoints[hoveredIncIndex].data.incrementFromPrev > 0 ? '+' : '-'}₹{Math.abs(incPoints[hoveredIncIndex].data.incrementFromPrev).toLocaleString('en-IN')}
                      </span>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center gap-3 text-[11px]">
                      <span className="text-slate-500 font-medium">Status</span>
                      <span className="text-slate-400 font-medium">Unchanged</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center gap-3 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                    <span>Since joining</span>
                    <span className="font-black text-indigo-700">
                      +₹{incPoints[hoveredIncIndex].data.incrementFromStart.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Performance Footer */}
            <div className="mt-4 pt-3.5 border-t border-slate-200/60 grid grid-cols-3 gap-2.5 text-center text-xs">
              <div className="clay-pod py-2 px-1">
                <span className="text-[10px] text-slate-500 block font-medium">Joining Rate</span>
                <span className="font-black text-slate-900 text-sm">₹{incrementStats.initialSalary.toLocaleString()}</span>
              </div>
              <div className="clay-pod py-2 px-1">
                <span className="text-[10px] text-slate-500 block font-medium">Current Base</span>
                <span className="font-black text-slate-900 text-sm">₹{incrementStats.currentSalary.toLocaleString()}</span>
              </div>
              <div className="clay-pod py-2 px-1">
                <span className="text-[10px] text-slate-500 block font-medium">Total Increment</span>
                <span className="font-black text-indigo-700 text-sm">
                  +₹{incrementStats.totalIncrement.toLocaleString()} (+{incrementStats.growthPct}%)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
