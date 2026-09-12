import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { attendanceApi, employeesApi, holidaysApi, attendanceRequestsApi, type AttendanceRequestItem } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { Attendance } from '@attendance/shared';
import { 
  Calendar as CalendarIcon, Clock, CheckCircle2, 
  CalendarDays, IndianRupee, Pencil, Send, AlertCircle,
  Plus, Trash2, List, ChevronLeft, ChevronRight, Lightbulb
} from 'lucide-react';
import { cn } from '@/lib/utils';

function monthRange(month: string): { from: string; to: string; year: number; mon: number; totalDays: number } {
  const parts = month.split('-').map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const mon = parts[1] ?? new Date().getMonth() + 1;
  const totalDays = new Date(year, mon, 0).getDate();
  const from = `${month}-01`;
  const to = `${month}-${String(totalDays).padStart(2, '0')}`;
  return { from, to, year, mon, totalDays };
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function extractTime(isoString?: string | null): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatIsoTo12h(isoString?: string | null): string {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '--:--';
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

function formatTimeTo12h(timeStr?: string | null): string {
  if (!timeStr || timeStr === '--') return '--:--';
  if (timeStr.includes('T') || timeStr.includes('Z')) {
    return formatIsoTo12h(timeStr);
  }
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr || '0', 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

function combineDateAndTime(dateStr: string, timeStr?: string, isNextDay = false): string | null {
  if (!timeStr || !timeStr.trim()) return null;
  const parts = timeStr.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const dateParts = dateStr.slice(0, 10).split('-').map(Number);
  const yr = dateParts[0] ?? new Date().getFullYear();
  const mo = dateParts[1] ?? 1;
  const dy = (dateParts[2] ?? 1) + (isNextDay ? 1 : 0);
  const d = new Date(yr, mo - 1, dy, h, m, 0, 0);
  return d.toISOString();
}

export function MyAttendancePage(): JSX.Element {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { from, to, year, mon, totalDays } = monthRange(month);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['attendance', 'me', month],
    queryFn: () => attendanceApi.mine(from, to),
  });

  const { data: summary } = useQuery({
    queryKey: ['attendance', 'me', 'summary', month],
    queryFn: () => attendanceApi.monthlySummary(`${month}-01`),
  });

  const { data: employee } = useQuery({
    queryKey: ['employee', 'me'],
    queryFn: employeesApi.me,
  });

  const { data: holidaysList = [] } = useQuery<any[]>({
    queryKey: ['holidays', year],
    queryFn: () => holidaysApi.list({ year: String(year) }) as Promise<any[]>,
  });

  // Query employee's own punch correction requests for this month
  const { data: myRequests = [] } = useQuery({
    queryKey: ['attendance', 'requests', 'mine', from, to],
    queryFn: () => attendanceRequestsApi.mine(from, to),
  });

  const requestsByDate = useMemo(() => {
    const map = new Map<string, AttendanceRequestItem>();
    myRequests.forEach((req) => {
      const dStr = req.attendanceDate ? req.attendanceDate.slice(0, 10) : '';
      if (dStr) map.set(dStr, req);
    });
    return map;
  }, [myRequests]);

  const [viewMode, setViewMode] = useState<'calendar' | 'table'>('calendar');

  const startDayOffset = useMemo(() => {
    return new Date(year, mon - 1, 1).getDay(); // Sunday = 0, Mon = 1 ...
  }, [year, mon]);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const attendanceByDate = useMemo(() => {
    const map = new Map<string, Attendance>();
    rows.forEach((r) => {
      if (!r.attendanceDate) return;
      const key = new Date(r.attendanceDate).toLocaleDateString('en-CA');
      map.set(key, r);
    });
    return map;
  }, [rows]);

  const holidaysByDate = useMemo(() => {
    const map = new Map<string, any>();
    holidaysList.forEach((h: any) => {
      if (!h.date) return;
      map.set(h.date.slice(0, 10), h);
    });
    return map;
  }, [holidaysList]);

  const handlePrevMonth = () => {
    const prev = new Date(year, mon - 2, 1);
    setMonth(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
    const next = new Date(year, mon, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  // Edit Punch Request Modal State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  const [selectedAttendance, setSelectedAttendance] = useState<Attendance | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<AttendanceRequestItem | null>(null);
  const [editPunchPairs, setEditPunchPairs] = useState<Array<{ punchIn: string; punchOut: string }>>([
    { punchIn: '', punchOut: '' },
  ]);
  const [reason, setReason] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [isEditingPunch, setIsEditingPunch] = useState(false);

  const createRequestMutation = useMutation({
    mutationFn: (body: {
      attendanceDate: string;
      punchInAt?: string | null;
      punchOutAt?: string | null;
      punchPairs?: Array<{ punchInAt: string; punchOutAt?: string | null }>;
      reason?: string;
    }) => attendanceRequestsApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance', 'requests', 'mine'] });
      setFeedbackMsg('Request submitted successfully! Admin will review your punches.');
      setTimeout(() => {
        setFeedbackMsg('');
        setIsEditingPunch(false);
        setEditModalOpen(false);
      }, 1500);
    },
  });

  const handleOpenEditModal = (r?: Attendance | null, dateStrParam?: string, reqParam?: AttendanceRequestItem | null) => {
    let dStr = dateStrParam || '';
    if (r) {
      if (typeof r.attendanceDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.attendanceDate)) {
        dStr = r.attendanceDate.slice(0, 10);
      } else {
        const dObj = new Date(r.attendanceDate);
        const yr = dObj.getFullYear();
        const mo = String(dObj.getMonth() + 1).padStart(2, '0');
        const dy = String(dObj.getDate()).padStart(2, '0');
        dStr = `${yr}-${mo}-${dy}`;
      }
    }
    const req = reqParam !== undefined ? reqParam : (dStr ? requestsByDate.get(dStr) : null);
    setSelectedDateStr(dStr);
    setSelectedAttendance(r ?? null);
    setSelectedRequest(req ?? null);
    setFeedbackMsg('');
    setIsEditingPunch(false);

    // Pre-populate punch sessions
    const pairs: Array<{ punchIn: string; punchOut: string }> = [];

    if (req && req.status === 'PENDING') {
      setReason(req.reason || '');
      if (Array.isArray(req.punchPairs) && req.punchPairs.length > 0) {
        for (const p of req.punchPairs) {
          pairs.push({ punchIn: extractTime(p.punchInAt), punchOut: extractTime(p.punchOutAt) });
        }
      } else {
        pairs.push({ punchIn: extractTime(req.punchInAt), punchOut: extractTime(req.punchOutAt) });
      }
    } else if (r) {
      setReason('');
      if (Array.isArray(r.punchPairs) && r.punchPairs.length > 0) {
        for (const p of (r.punchPairs as any[])) {
          pairs.push({ punchIn: extractTime(p.punchInAt), punchOut: extractTime(p.punchOutAt) });
        }
      } else if (r.punchInAt || r.punchOutAt) {
        pairs.push({ punchIn: extractTime(r.punchInAt), punchOut: extractTime(r.punchOutAt) });
      }
    } else {
      setReason('');
    }

    if (pairs.length === 0) {
      pairs.push({ punchIn: '', punchOut: '' });
    }

    setEditPunchPairs(pairs);
    setEditModalOpen(true);
  };

  const handleSubmitRequest = () => {
    const validPairs = editPunchPairs.filter((p) => p.punchIn.trim() || p.punchOut.trim());
    if (validPairs.length === 0) {
      alert('Please enter at least one punch in time.');
      return;
    }

    const convertedPairs = validPairs.map((p) => {
      const isNext = Boolean(p.punchIn && p.punchOut && p.punchOut < p.punchIn);
      return {
        punchInAt: combineDateAndTime(selectedDateStr, p.punchIn, false) || '',
        punchOutAt: combineDateAndTime(selectedDateStr, p.punchOut, isNext),
      };
    });

    const firstPair = convertedPairs[0];
    const lastPair = convertedPairs[convertedPairs.length - 1];

    createRequestMutation.mutate({
      attendanceDate: selectedDateStr,
      punchInAt: firstPair?.punchInAt,
      punchOutAt: lastPair?.punchOutAt,
      punchPairs: convertedPairs,
      reason: reason.trim() || undefined,
    });
  };

  // Calculate rate and eligibility
  const rateMetrics = useMemo(() => {
    const monthlySalary = Number(employee?.baseSalary || 0);
    let shiftHours = 9.0;
    const latestShift = (employee as any)?.employeeShifts?.[0]?.shift;
    if (latestShift?.startTime && latestShift?.endTime) {
      const [sh, sm] = latestShift.startTime.split(':').map(Number);
      const [eh, em] = latestShift.endTime.split(':').map(Number);
      let diffMinutes = ((eh || 0) * 60 + (em || 0)) - ((sh || 0) * 60 + (sm || 0));
      if (diffMinutes <= 0) diffMinutes += 24 * 60;
      shiftHours = diffMinutes / 60;
    }

    const perDaySalaryExact = totalDays > 0 ? monthlySalary / totalDays : 0;
    const hourRateExact = shiftHours > 0 ? perDaySalaryExact / shiftHours : 0;

    // Count present regular days in this month
    const daySecondsMap = new Map<string, number>();
    rows.forEach((log: any) => {
      const dStr = new Date(log.attendanceDate).toLocaleDateString('en-CA');
      let secs = 0;
      if (Array.isArray(log.punchPairs) && log.punchPairs.length > 0) {
        for (const pair of log.punchPairs) {
          if (pair?.punchInAt && pair?.punchOutAt) {
            const diff = (new Date(pair.punchOutAt).getTime() - new Date(pair.punchInAt).getTime()) / 1000;
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

    let presentRegularDays = 0;
    let totalWorkedSecs = 0;
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(year, mon - 1, d);
      const isSun = dateObj.getDay() === 0;
      const isHol = holidaysList.some((h: any) => h.date?.slice(0, 10) === dateStr);
      const secs = daySecondsMap.get(dateStr) || 0;
      if (!isSun && !isHol && secs > 0) {
        presentRegularDays++;
      }
      totalWorkedSecs += secs;
    }

    const getPaidCount = (presentDays: number, totalOff: number) => {
      if (presentDays >= 18) return totalOff;
      if (presentDays >= 12) return Math.min(2, totalOff);
      if (presentDays >= 5) return Math.min(1, totalOff);
      return 0;
    };

    // Sundays in this month
    let sundaysCount = 0;
    for (let d = 1; d <= totalDays; d++) {
      if (new Date(year, mon - 1, d).getDay() === 0) sundaysCount++;
    }
    const thisMonthHolidays = holidaysList.filter((h: any) => {
      if (!h.date) return false;
      const hDate = new Date(h.date);
      return hDate.getFullYear() === year && (hDate.getMonth() + 1) === mon && hDate.getDay() !== 0;
    });
    const holidaysCount = thisMonthHolidays.length;

    const paidSundays = getPaidCount(presentRegularDays, sundaysCount);
    const paidHolidays = getPaidCount(presentRegularDays, holidaysCount);
    const totalPaidOffDays = paidSundays + paidHolidays;

    const basicSalary = (totalWorkedSecs / 3600) * hourRateExact;
    const sundayHolidayPay = totalPaidOffDays * perDaySalaryExact;
    const monthEstimatedSalary = Math.round(basicSalary + sundayHolidayPay);

    return {
      monthlySalary,
      perDaySalary: Number(perDaySalaryExact.toFixed(2)),
      hourRate: Number(hourRateExact.toFixed(2)),
      presentRegularDays,
      paidSundays,
      paidHolidays,
      totalPaidOffDays,
      monthEstimatedSalary,
      totalWorkedHours: Number((totalWorkedSecs / 3600).toFixed(1)),
    };
  }, [employee, rows, totalDays, year, mon, holidaysList]);

  const columns: DataTableColumn<Attendance>[] = [
    { 
      key: 'attendanceDate', 
      header: 'Date', 
      render: (r) => {
        const dObj = new Date(r.attendanceDate);
        const isSun = dObj.getDay() === 0;
        return (
          <div className="flex items-center gap-2">
            <CalendarIcon size={14} className={cn(isSun ? "text-purple-500" : "text-muted-foreground")} />
            <span className={cn("font-medium", isSun && "text-purple-600 font-semibold")}>
              {dObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          </div>
        );
      } 
    },
    {
      key: 'punchInAt',
      header: 'Punch In',
      render: (r) => {
        const pairs = Array.isArray(r.punchPairs) && r.punchPairs.length > 0
          ? (r.punchPairs as Array<{ punchInAt?: string | null; punchOutAt?: string | null }>)
          : r.punchInAt ? [{ punchInAt: r.punchInAt, punchOutAt: r.punchOutAt }] : [];

        if (pairs.length === 0) {
          return <span className="text-muted-foreground">--:--</span>;
        }

        return (
          <div className="flex flex-col gap-1 py-0.5">
            {pairs.map((p, idx) => (
              <div key={idx} className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-500 font-medium">
                <Clock size={13} className="shrink-0 text-emerald-500" />
                <span>{p.punchInAt ? new Date(p.punchInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--:--'}</span>
                {pairs.length > 1 && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-600 font-mono font-bold">
                    #{idx + 1}
                  </span>
                )}
              </div>
            ))}
          </div>
        );
      },
    },
    {
      key: 'punchOutAt',
      header: 'Punch Out',
      render: (r) => {
        const pairs = Array.isArray(r.punchPairs) && r.punchPairs.length > 0
          ? (r.punchPairs as Array<{ punchInAt?: string | null; punchOutAt?: string | null }>)
          : r.punchInAt ? [{ punchInAt: r.punchInAt, punchOutAt: r.punchOutAt }] : [];

        if (pairs.length === 0) {
          return <span className="text-muted-foreground">--:--</span>;
        }

        return (
          <div className="flex flex-col gap-1 py-0.5">
            {pairs.map((p, idx) => (
              <div key={idx} className="flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-500 font-medium">
                <Clock size={13} className="shrink-0 text-orange-500" />
                <span>{p.punchOutAt ? new Date(p.punchOutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--:--'}</span>
                {pairs.length > 1 && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-orange-500/10 text-orange-600 font-mono font-bold">
                    #{idx + 1}
                  </span>
                )}
              </div>
            ))}
          </div>
        );
      },
    },
    { 
      key: 'workedMinutes', 
      header: 'Working Time',
      render: (r) => {
        let mins = r.workedMinutes || 0;
        if (Array.isArray(r.punchPairs) && r.punchPairs.length > 0) {
          const pairSecs = (r.punchPairs as any[]).reduce((sum, p) => {
            if (p?.punchInAt && p?.punchOutAt) {
              const diff = (new Date(p.punchOutAt).getTime() - new Date(p.punchInAt).getTime()) / 1000;
              return sum + (diff > 0 ? diff : 0);
            }
            return sum;
          }, 0);
          if (pairSecs > 0) {
            mins = Math.round(pairSecs / 60);
          }
        }
        if (!mins) return <span className="text-muted-foreground">--</span>;
        return <span className="font-semibold text-foreground">{formatDuration(mins)}</span>;
      }
    },
    { 
      key: 'overtimeMinutes', 
      header: 'Overtime',
      render: (r) => r.overtimeMinutes > 0 ? (
        <span className="text-emerald-600 font-medium">+{r.overtimeMinutes}m</span>
      ) : <span className="text-muted-foreground">--</span>
    },
    { 
      key: 'status', 
      header: 'Status', 
      render: (r) => <StatusBadge status={r.status} /> 
    },

    {
      key: 'action',
      header: 'Correction',
      render: (r) => {
        const dObj = new Date(r.attendanceDate);
        const dateStr = dObj.toLocaleDateString('en-CA');
        const req = requestsByDate.get(dateStr);

        if (req?.status === 'PENDING') {
          return (
            <Badge
              onClick={() => handleOpenEditModal(r, undefined, req)}
              className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[11px] gap-1 px-2.5 py-1 font-medium cursor-pointer hover:bg-amber-500/25 transition-colors"
            >
              <Clock size={11} />
              <span>Pending Admin</span>
            </Badge>
          );
        }

        if (req?.status === 'APPROVED') {
          return (
            <div className="flex items-center gap-1.5">
              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] gap-1 px-2 py-0.5 font-medium">
                <CheckCircle2 size={10} /> Approved
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleOpenEditModal(r, undefined, req)}
                className="h-6 w-6 p-0 text-muted-foreground hover:text-primary rounded-md"
                title="Edit again"
              >
                <Pencil size={11} />
              </Button>
            </div>
          );
        }

        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleOpenEditModal(r, undefined, req)}
            className="h-7 text-xs px-2.5 rounded-lg border-border/70 hover:border-primary/50 text-foreground gap-1.5 font-medium hover:bg-primary/5"
          >
            <Pencil size={12} className="text-primary" />
            <span>Edit Punch</span>
          </Button>
        );
      },
    }
  ];

  return (
    <div className="space-y-5">
      {/* Header with Navigation and All-in-One Compact Summary Capsule */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-border/50">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">My Attendance</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Review your attendance logs, punch times, and daily earnings.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* All-in-One Compact Summary Capsule */}
          <div className="inline-flex items-center flex-wrap sm:flex-nowrap gap-2 sm:gap-2.5 px-3 py-1.5 rounded-xl border border-border/70 bg-card shadow-xs text-xs font-medium">
            {/* Present */}
            <div className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold" title="Present Days">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span>{summary?.present ?? 0}</span>
              <span className="text-muted-foreground font-normal text-[11px] hidden sm:inline">Present</span>
            </div>

            <div className="hidden sm:block w-[1px] h-3.5 bg-border/60" />

            {/* Absent */}
            <div className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-semibold" title="Absent Days">
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
              <span>{summary?.absent ?? 0}</span>
              <span className="text-muted-foreground font-normal text-[11px] hidden sm:inline">Absent</span>
            </div>

            <div className="hidden sm:block w-[1px] h-3.5 bg-border/60" />

            {/* Half Day */}
            <div className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold" title="Half Days">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span>{summary?.halfDay ?? 0}</span>
              <span className="text-muted-foreground font-normal text-[11px] hidden sm:inline">Half Day</span>
            </div>

            <div className="hidden sm:block w-[1px] h-3.5 bg-border/60" />

            {/* Leave */}
            <div className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold" title="Leave Days">
              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <span>{summary?.leave ?? 0}</span>
              <span className="text-muted-foreground font-normal text-[11px] hidden sm:inline">Leave</span>
            </div>

            <div className="hidden sm:block w-[1px] h-3.5 bg-border/60" />

            {/* Holiday */}
            <div className="inline-flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-semibold" title="Holidays">
              <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
              <span>{summary?.holiday ?? 0}</span>
              <span className="text-muted-foreground font-normal text-[11px] hidden sm:inline">Holiday</span>
            </div>

            <div className="hidden sm:block w-[1px] h-3.5 bg-border/60" />

            {/* Est. Earnings */}
            <div className="inline-flex items-center gap-1 text-foreground font-bold" title="Estimated Earnings">
              <IndianRupee size={12} className="text-emerald-600 dark:text-emerald-400" />
              <span>{rateMetrics.monthEstimatedSalary.toLocaleString()}</span>
            </div>
          </div>

          {/* Sleek Month Navigator (Calendar Filter) */}
          <div className="flex items-center bg-card border border-border/70 rounded-xl shadow-xs p-0.5">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Previous Month"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="relative px-2">
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer"
              />
            </div>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Next Month"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Attendance Log Card: Calendar View & Table View */}
      <Card className="border border-border/70 shadow-sm rounded-2xl bg-card overflow-hidden">
        <CardHeader className="p-4 sm:px-6 sm:py-4 border-b border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-bold text-foreground">Attendance & Daily Log</CardTitle>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            <div className="text-xs font-semibold text-muted-foreground bg-muted/60 border border-border/50 px-3 py-1.5 rounded-xl">
              Total Worked: <span className="text-foreground font-bold">{rateMetrics.totalWorkedHours} hrs</span>
            </div>

            {/* View Mode Toggle: Calendar / Table */}
            <div className="flex items-center bg-muted/60 p-0.5 rounded-xl border border-border/60 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
                  viewMode === 'calendar'
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <CalendarDays size={14} />
                <span>Calendar</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
                  viewMode === 'table'
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <List size={14} />
                <span>Table</span>
              </button>
            </div>
          </div>
        </CardHeader>

        {/* Card Content: Either Calendar Grid (Image 2 style) or DataTable */}
        {viewMode === 'calendar' ? (
          <div className="p-4 sm:p-5">
            {/* Days of Week Header: SUN, MON, TUE, WED, THU, FRI, SAT */}
            <div className="grid grid-cols-7 gap-2 sm:gap-2.5 mb-2.5 text-center">
              {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((dName, idx) => (
                <div
                  key={dName}
                  className={`text-xs font-bold py-1.5 rounded-lg uppercase tracking-wider ${
                    idx === 0
                      ? 'text-rose-500 bg-rose-500/5 dark:bg-rose-950/20'
                      : 'text-muted-foreground/80'
                  }`}
                >
                  {dName}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-2 sm:gap-2.5">
              {/* Empty offset days */}
              {Array.from({ length: startDayOffset }).map((_, idx) => (
                <div
                  key={`empty-${idx}`}
                  className="min-h-[110px] sm:min-h-[120px] rounded-2xl border border-dashed border-border/30 bg-muted/5"
                />
              ))}

              {/* Day cells 1 to totalDays */}
              {Array.from({ length: totalDays }).map((_, idx) => {
                const day = idx + 1;
                const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dObj = new Date(year, mon - 1, day);
                const isSunday = dObj.getDay() === 0;
                const holiday = holidaysByDate.get(dateStr);
                const isHoliday = Boolean(holiday);
                const row = attendanceByDate.get(dateStr);
                const req = requestsByDate.get(dateStr);
                const isToday = dateStr === todayStr;
                const isPast = dateStr < todayStr;

                // Extract punch pairs
                const hasPunchIn = Boolean(row?.punchInAt);
                const hasPunchOut = Boolean(row?.punchOutAt);
                const pairs = Array.isArray(row?.punchPairs) && row.punchPairs.length > 0
                  ? row.punchPairs
                  : hasPunchIn || hasPunchOut
                  ? [{ punchInAt: row?.punchInAt, punchOutAt: row?.punchOutAt }]
                  : [];

                const isMissingOut = hasPunchIn && !hasPunchOut && !isToday;

                // Calculate worked minutes
                let cellWorkedMins = row?.workedMinutes || 0;
                if (Array.isArray(row?.punchPairs) && row.punchPairs.length > 0) {
                  const pairSecs = (row.punchPairs as any[]).reduce((sum, p) => {
                    if (p?.punchInAt && p?.punchOutAt) {
                      const diff = (new Date(p.punchOutAt).getTime() - new Date(p.punchInAt).getTime()) / 1000;
                      return sum + (diff > 0 ? diff : 0);
                    }
                    return sum;
                  }, 0);
                  if (pairSecs > 0) {
                    cellWorkedMins = Math.round(pairSecs / 60);
                  }
                } else if (row?.punchInAt && row?.punchOutAt) {
                  const diff = (new Date(row.punchOutAt).getTime() - new Date(row.punchInAt).getTime()) / 1000;
                  if (diff > 0) cellWorkedMins = Math.round(diff / 60);
                }

                // Determine daily earnings badge & text
                let statusBadge: React.ReactNode = null;
                let centerContent: React.ReactNode = null;
                let bottomTimings: React.ReactNode = null;
                let cardBorderClass = 'border-border/60 bg-card hover:border-primary/50';
                let dailySalaryBadge: React.ReactNode = null;

                if (isHoliday) {
                  cardBorderClass = 'border-amber-300/80 dark:border-amber-700/60 bg-amber-50/20 dark:bg-amber-950/10 hover:border-amber-400';
                  statusBadge = (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100/80 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300/60">
                      HOLIDAY
                    </span>
                  );
                  if (rateMetrics.paidHolidays > 0) {
                    // Holiday Pay (removed amount display)
                  }
                  centerContent = (
                    <div className="py-1 text-center">
                      <span className="text-xs font-semibold text-amber-900 dark:text-amber-200 line-clamp-1">
                        {holiday?.name || 'Holiday'}
                      </span>
                    </div>
                  );
                } else if (isSunday) {
                  cardBorderClass = 'border-slate-200 dark:border-zinc-800 bg-slate-50/30 dark:bg-zinc-900/20 hover:border-slate-300';
                  statusBadge = (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400 border border-border/60">
                      Off
                    </span>
                  );
                  if (rateMetrics.paidSundays > 0) {
                    // Sunday Pay (removed amount display)
                  }
                } else if (row?.status === 'LEAVE') {
                  cardBorderClass = 'border-blue-300/80 dark:border-blue-700/60 bg-blue-50/20 dark:bg-blue-950/10 hover:border-blue-400';
                  statusBadge = (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-100/80 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300/60">
                      Leave
                    </span>
                  );
                  dailySalaryBadge = (
                    <div className="text-center text-xs font-semibold text-blue-600 dark:text-blue-400">
                      Approved Leave
                    </div>
                  );
                } else if (isMissingOut) {
                  // No Out in amber pill
                  cardBorderClass = 'border-amber-400/80 dark:border-amber-600/60 bg-amber-50/25 dark:bg-amber-950/15 hover:border-amber-500';
                  statusBadge = (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300/70">
                      No Out
                    </span>
                  );
                  if (cellWorkedMins > 0) {
                    dailySalaryBadge = (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[10px] text-amber-600/80 dark:text-amber-400/80 font-medium">
                          {formatDuration(cellWorkedMins)}
                        </span>
                      </div>
                    );
                  } else {
                    dailySalaryBadge = (
                      <div className="text-right text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                        Missing Out
                      </div>
                    );
                  }
                  bottomTimings = (
                    <div className="space-y-0.5 pt-1">
                      {pairs.map((p, pIdx) => (
                        <div key={pIdx} className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                          <span>{formatTimeTo12h(p.punchInAt)}</span>
                          <span className="text-amber-600 dark:text-amber-400 font-semibold">
                            {p.punchOutAt ? formatTimeTo12h(p.punchOutAt) : '--:--'}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                } else if (pairs.length > 0 && (row?.punchInAt || cellWorkedMins > 0)) {
                  // Present in mint green pill
                  cardBorderClass = 'border-emerald-400/80 dark:border-emerald-700/60 bg-emerald-50/15 dark:bg-emerald-950/10 hover:border-emerald-500';
                  statusBadge = (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300/60">
                      Present
                    </span>
                  );
                  dailySalaryBadge = (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {formatDuration(cellWorkedMins)}
                      </span>
                    </div>
                  );
                  bottomTimings = (
                    <div className="space-y-0.5 pt-1">
                      {pairs.map((p, pIdx) => (
                        <div key={pIdx} className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                          <span>{formatTimeTo12h(p.punchInAt)}</span>
                          <span>{p.punchOutAt ? formatTimeTo12h(p.punchOutAt) : '--:--'}</span>
                        </div>
                      ))}
                    </div>
                  );
                } else if (isPast && !isSunday && !isHoliday) {
                  // ABSENT in pink/rose pill
                  cardBorderClass = 'border-rose-300/80 dark:border-rose-700/60 bg-rose-50/20 dark:bg-rose-950/10 hover:border-rose-400';
                  statusBadge = (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-100/80 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300/60">
                      ABSENT
                    </span>
                  );
                  dailySalaryBadge = (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[10px] text-rose-500/80 dark:text-rose-400/80 font-medium">
                        Absent
                      </span>
                    </div>
                  );
                }

                const hasPendingRequest = req && req.status === 'PENDING';

                return (
                  <div
                    key={dateStr}
                    onClick={() => handleOpenEditModal(row, dateStr, req)}
                    className={`min-h-[110px] sm:min-h-[120px] rounded-2xl border p-2.5 sm:p-3 flex flex-col justify-between transition-all cursor-pointer relative group select-none hover:shadow-md hover:scale-[1.01] ${cardBorderClass} ${
                      isToday ? 'ring-2 ring-primary/40' : ''
                    }`}
                    title="Click date to add, edit or delete punches"
                  >
                    {/* Header: Date number & status badge */}
                    <div className="flex items-start justify-between gap-1">
                      <span className={`text-xs sm:text-sm font-bold ${isToday ? 'text-primary font-black' : 'text-foreground'}`}>
                        {day}
                      </span>

                      <div className="flex items-center gap-1">
                        {hasPendingRequest && (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/40"
                            title="Correction request under review"
                          >
                            Pending
                          </span>
                        )}
                        {statusBadge}
                      </div>
                    </div>

                    {/* Center details / Daily Salary */}
                    <div className="my-auto py-0.5">
                      {dailySalaryBadge}
                      {centerContent}
                    </div>

                    {/* Bottom punch timings and hover action */}
                    <div>
                      {bottomTimings}

                      {/* Hover action hint */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-primary flex items-center justify-end gap-0.5 pt-1 font-medium">
                        <Pencil size={10} />
                        <span>Edit / Add</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <CardContent className="p-0">
            <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} isLoading={isLoading} />
          </CardContent>
        )}
      </Card>

      {/* Attendance Correction Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl border-border/70 shadow-2xl p-6 bg-card">
          <DialogHeader className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
                <Clock size={18} />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-foreground">
                  {selectedAttendance?.status === 'LEAVE' ? 'Attendance Details' : 'Punch Details & Correction'}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {selectedAttendance?.status === 'LEAVE'
                    ? 'Official attendance record and leave status for this day.'
                    : 'Forgot to punch or need to adjust times? Submit your request to Admin.'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Date & Status banner */}
          <div className="p-3 bg-muted/40 rounded-xl border border-border/50 flex items-center justify-between my-2 text-xs">
            <div className="flex items-center gap-2">
              <CalendarIcon size={14} className="text-primary" />
              <span className="font-bold text-foreground">
                {selectedDateStr
                  ? new Date(selectedDateStr).toLocaleDateString('en-IN', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  : ''}
              </span>
            </div>
            {selectedAttendance ? (
              <StatusBadge status={selectedAttendance.status} />
            ) : (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                No Record
              </span>
            )}
          </div>

          {/* Top Section: Punch Timings on Record with High Visibility */}
          {(() => {
            const isLeave = selectedAttendance?.status === 'LEAVE';
            const currentPairs = selectedAttendance
              ? Array.isArray(selectedAttendance.punchPairs) && selectedAttendance.punchPairs.length > 0
                ? (selectedAttendance.punchPairs as Array<{ punchInAt?: string | null; punchOutAt?: string | null }>)
                : selectedAttendance.punchInAt
                ? [{ punchInAt: selectedAttendance.punchInAt, punchOutAt: selectedAttendance.punchOutAt }]
                : []
              : [];
            const workedMins = selectedAttendance?.workedMinutes || 0;

            if (isLeave) {
              return (
                <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-blue-900 dark:text-blue-200 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-xs sm:text-sm">
                      <CalendarDays className="text-blue-600 dark:text-blue-400 shrink-0" size={16} />
                      <span>Approved Leave Day</span>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                      On Leave
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-blue-700/90 dark:text-blue-300/90 leading-relaxed pt-0.5">
                    You were officially on leave for this date. No attendance punch was required or recorded.
                  </p>
                </div>
              );
            }

            if (currentPairs.length > 0) {
              return (
                <div className="p-3.5 rounded-2xl bg-muted/40 border border-border/80 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Clock size={13} className="text-primary" /> Punches on Record
                    </span>
                    {workedMins > 0 && (
                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                        {formatDuration(workedMins)}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {currentPairs.map((p, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-background border border-border/70 shadow-2xs"
                      >
                        <span className="text-xs font-bold text-foreground">Session #{idx + 1}</span>
                        <div className="flex items-center gap-2.5 font-mono text-xs sm:text-sm font-bold">
                          <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground uppercase font-sans font-medium">In:</span>
                            {p.punchInAt ? formatTimeTo12h(p.punchInAt) : '--:--'}
                          </span>
                          <span className="text-muted-foreground/60 text-xs">➔</span>
                          <span className="text-orange-600 dark:text-orange-400 flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground uppercase font-sans font-medium">Out:</span>
                            {p.punchOutAt ? formatTimeTo12h(p.punchOutAt) : '--:--'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 font-semibold">
                  <AlertCircle size={16} className="text-rose-600 shrink-0" />
                  <span>No punches recorded for this day (Marked Absent)</span>
                </div>
              </div>
            );
          })()}

          {/* Existing Pending Alert if any */}
          {selectedRequest?.status === 'PENDING' && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs my-2 font-medium">
              <AlertCircle size={14} className="shrink-0 text-amber-600" />
              <span>A correction request is already pending Admin approval.</span>
            </div>
          )}

          {/* Option Below to Edit / Adjust Punches */}
          {!isEditingPunch ? (
            <div className="pt-2">
              {selectedAttendance?.status === 'LEAVE' ? (
                <div className="text-center pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditingPunch(true)}
                    className="rounded-xl text-xs font-semibold gap-1.5 border-dashed border-primary/40 text-primary hover:bg-primary/5"
                  >
                    <Pencil size={13} />
                    <span>Did you work on this leave day? Request Punch</span>
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditingPunch(true)}
                  className="w-full h-10 rounded-xl text-xs font-bold gap-2 border-primary/40 text-primary hover:bg-primary/5 hover:border-primary shadow-2xs"
                >
                  <Pencil size={14} />
                  <span>
                    {(Array.isArray(selectedAttendance?.punchPairs) && selectedAttendance.punchPairs.length > 0) || selectedAttendance?.punchInAt
                      ? 'Edit / Adjust This Punch'
                      : 'Request Punch Entry for this Day'}
                  </span>
                </Button>
              )}
            </div>
          ) : (
            /* Punch Edit Form */
            <div className="space-y-3 pt-2 border-t border-border/50 mt-2 animate-in fade-in-50 duration-150">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-bold text-foreground">Adjust Punch Timings</Label>
                  <span className="text-[10px] text-muted-foreground block">
                    Enter actual punch times for Admin review
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground font-medium">
                    {editPunchPairs.length} session{editPunchPairs.length > 1 ? 's' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsEditingPunch(false)}
                    className="text-[11px] font-semibold text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    Cancel Edit
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {editPunchPairs.map((pair, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl border border-border/70 bg-background/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-primary">Session #{idx + 1}</span>
                      {editPunchPairs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setEditPunchPairs(editPunchPairs.filter((_, i) => i !== idx))}
                          className="text-rose-500 hover:text-rose-600 p-0.5 rounded text-xs hover:bg-rose-500/10 transition-colors"
                          title="Remove session"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                          <Clock size={10} className="text-emerald-500" /> Punch In
                        </span>
                        <Input
                          type="time"
                          value={pair.punchIn}
                          onChange={(e) => {
                            const next = [...editPunchPairs];
                            if (next[idx]) {
                              next[idx] = { ...next[idx], punchIn: e.target.value };
                              setEditPunchPairs(next);
                            }
                          }}
                          className="h-8 rounded-lg border-border/70 text-xs font-medium"
                        />
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                          <Clock size={10} className="text-orange-500" /> Punch Out
                        </span>
                        <Input
                          type="time"
                          value={pair.punchOut}
                          onChange={(e) => {
                            const next = [...editPunchPairs];
                            if (next[idx]) {
                              next[idx] = { ...next[idx], punchOut: e.target.value };
                              setEditPunchPairs(next);
                            }
                          }}
                          className="h-8 rounded-lg border-border/70 text-xs font-medium"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Session button */}
              {editPunchPairs.length < 8 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditPunchPairs([...editPunchPairs, { punchIn: '', punchOut: '' }])}
                  className="w-full h-8 text-xs font-semibold rounded-xl border-dashed border-primary/40 text-primary hover:bg-primary/5 gap-1.5"
                >
                  <Plus size={13} />
                  <span>Add Another Punch Session</span>
                </Button>
              )}

              {/* Bold High-Visibility Tip Callout */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-950 dark:text-amber-100 shadow-xs">
                <Lightbulb size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <span className="font-extrabold uppercase tracking-wide mr-1 text-amber-800 dark:text-amber-300">Tip:</span>
                  <span className="font-bold">
                    Enter all punch-in and punch-out times for the day. Multiple sessions will be summed for your salary.
                  </span>
                </div>
              </div>

              {/* Reason Textarea */}
              <div className="space-y-1.5">
                <Label htmlFor="reason" className="text-xs font-semibold text-foreground">
                  Reason / Note for Admin
                </Label>
                <textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="e.g., Forgot to punch in at shift start, biometric scanner was restarting..."
                  className="w-full text-xs rounded-xl border border-input bg-background p-2.5 outline-none focus:ring-2 focus:ring-primary resize-none transition-all placeholder:text-muted-foreground/60"
                />
              </div>
            </div>
          )}

          {/* Feedback Message */}
          {feedbackMsg && (
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center gap-2 mt-3 animate-in fade-in">
              <CheckCircle2 size={14} className="shrink-0" />
              <span>{feedbackMsg}</span>
            </div>
          )}

          {/* Dialog Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-4 mt-2 border-t border-border/50">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setIsEditingPunch(false);
                setEditModalOpen(false);
              }}
              disabled={createRequestMutation.isPending}
              className="rounded-xl text-xs h-9"
            >
              {isEditingPunch ? 'Cancel' : 'Close'}
            </Button>
            {isEditingPunch && (
              <Button
                type="button"
                size="sm"
                onClick={handleSubmitRequest}
                disabled={createRequestMutation.isPending}
                className="rounded-xl text-xs h-9 gap-1.5 bg-primary text-primary-foreground font-semibold shadow-sm hover:bg-primary/90"
              >
                <Send size={13} />
                <span>{createRequestMutation.isPending ? 'Submitting...' : 'Send Request to Admin'}</span>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
