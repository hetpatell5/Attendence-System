import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { attendanceApi, employeesApi, holidaysApi } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar as CalendarIcon, Search, ChevronDown, Users, X } from 'lucide-react';

const MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

interface SearchableEmployeeSelectProps {
  employees: any[];
  value: string;
  onChange: (val: string) => void;
}

function SearchableEmployeeSelect({ employees, value, onChange }: SearchableEmployeeSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeEmployees = useMemo(() => {
    return employees.filter(e => e.status === 'ACTIVE');
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    if (!search.trim()) return activeEmployees;
    const q = search.toLowerCase();
    return activeEmployees.filter(emp => {
      const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase();
      const code = (emp.employeeCode || '').toLowerCase();
      return fullName.includes(q) || code.includes(q);
    });
  }, [activeEmployees, search]);

  const selectedEmployee = activeEmployees.find(e => e.id === value);
  const displayLabel = value === 'all'
    ? 'All Employees View'
    : selectedEmployee
      ? `${selectedEmployee.firstName} ${selectedEmployee.lastName} (${selectedEmployee.employeeCode})`
      : 'Select Employee';

  return (
    <div className="relative w-full sm:w-64 font-medium" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setIsOpen(prev => !prev);
          if (!isOpen) setSearch('');
        }}
        className="flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted/40 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
      >
        <span className="truncate text-left">{displayLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ml-2 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 w-full sm:w-80 z-50 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl overflow-hidden animate-in fade-in-0 zoom-in-95">
          {/* Search bar inside employee list filter */}
          <div className="p-2 border-b border-border bg-muted/40">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Search employee by name or code..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 text-xs text-muted-foreground hover:text-foreground p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto p-1 space-y-0.5">
            {/* All Employees View option */}
            {(!search || 'all employees view'.includes(search.toLowerCase())) && (
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                  value === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-foreground'
                }`}
                onClick={() => {
                  onChange('all');
                  setIsOpen(false);
                  setSearch('');
                }}
              >
                <Users className="w-3.5 h-3.5 shrink-0" />
                <span>All Employees View</span>
              </div>
            )}

            {filteredEmployees.length === 0 && search && !'all employees view'.includes(search.toLowerCase()) ? (
              <div className="p-3 text-xs text-center text-muted-foreground">
                No employee found matching "{search}"
              </div>
            ) : (
              filteredEmployees.map(emp => {
                const isSelected = value === emp.id;
                return (
                  <div
                    key={emp.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'hover:bg-muted text-foreground'
                    }`}
                    onClick={() => {
                      onChange(emp.id);
                      setIsOpen(false);
                      setSearch('');
                    }}
                  >
                    <span className="truncate">{emp.firstName} {emp.lastName}</span>
                    <span
                      className={`text-[11px] font-mono shrink-0 ml-2 ${
                        isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                      }`}
                    >
                      {emp.employeeCode}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AttendanceManagementPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialEmployeeId = searchParams.get('employee_id') || 'all';
  // Note: searchParams month might be "08" instead of "8", so we parse and stringify to match MONTHS values without leading zero
  const rawMonth = searchParams.get('month');
  const initialMonth = rawMonth ? parseInt(rawMonth, 10).toString() : (new Date().getMonth() + 1).toString();
  const initialYear = searchParams.get('year') || new Date().getFullYear().toString();
  const initialViewMode = initialEmployeeId !== 'all' ? 'calendar' : 'grid';

  const currentYear = new Date().getFullYear();
  const YEARS = Array.from({ length: 5 }, (_, i) => (currentYear - 2 + i).toString());

  const [viewMode, setViewMode] = useState<'grid' | 'calendar'>(initialViewMode as any);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(initialEmployeeId);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [cardSearch, setCardSearch] = useState('');

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editStatus, setEditStatus] = useState<'PRESENT' | 'ABSENT'>('PRESENT');
  // Each entry = { punchIn: 'HH:MM', punchOut: 'HH:MM' } — max 3 entries
  const [punchPairs, setPunchPairs] = useState<{ punchIn: string; punchOut: string }[]>([]);

  const queryClient = useQueryClient();

  // Date range for the selected month
  const from = `${selectedYear}-${selectedMonth.padStart(2, '0')}-01`;
  const lastDay = new Date(parseInt(selectedYear), parseInt(selectedMonth), 0).getDate();
  const to = `${selectedYear}-${selectedMonth.padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;

  const { data: employeesData } = useQuery({ 
    queryKey: ['employees', 'all'], 
    queryFn: () => employeesApi.list({ pageSize: '1000' }) 
  });

  const { data: attendanceData } = useQuery({
    queryKey: ['attendance', 'all', from, to],
    queryFn: () =>
      attendanceApi.listAll({
        from,
        to,
        pageSize: '10000',
      }),
  });

  const { data: holidaysList = [] } = useQuery({
    queryKey: ['holidays', selectedYear],
    queryFn: () => holidaysApi.list({ year: selectedYear }),
  });

  // Aggregate stats per employee for the grid view
  const employeeSummaries = useMemo(() => {
    if (!employeesData?.items) return [];
    const records = attendanceData?.items || [];
    const todayStr = new Date().toLocaleDateString('en-CA');
    const daysInMonth = lastDay;

    return employeesData.items.map(emp => {
      const empRecords = records.filter(r => r.employeeId === emp.id);
      let present = 0;
      let absent = 0;
      let half = 0;
      let weekOff = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${selectedYear}-${selectedMonth.padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
        if (dateStr > todayStr) continue;

        const dayOfWeek = new Date(parseInt(selectedYear), parseInt(selectedMonth) - 1, d).getDay();
        const isSunday = (dayOfWeek === 0);
        const isHoliday = holidaysList?.some((h: any) => h.date?.slice(0, 10) === dateStr)
          || empRecords.some(r => new Date(r.attendanceDate).toLocaleDateString('en-CA') === dateStr && r.status === 'HOLIDAY');
        const record = empRecords.find(r => new Date(r.attendanceDate).toLocaleDateString('en-CA') === dateStr);
        const hasPunches = Boolean(record?.punchInAt || record?.punchOutAt);
        const isPresent = record?.status === 'PRESENT' || hasPunches;

        if (isHoliday || isSunday) {
          if (isPresent) {
            present++;
          } else {
            weekOff++;
          }
        } else {
          if (isPresent) {
            present++;
          } else if (record?.status === 'HALF_DAY') {
            half++;
          } else {
            absent++;
          }
        }
      }

      return {
        employee: emp,
        presentDays: present,
        absentDays: absent,
        halfDays: half,
        weekOffDays: weekOff,
      };
    });
  }, [employeesData?.items, attendanceData?.items, selectedYear, selectedMonth, lastDay, holidaysList]);

  // Filtered summaries for the grid cards
  const filteredSummaries = useMemo(() => {
    if (!cardSearch.trim()) return employeeSummaries;
    const q = cardSearch.toLowerCase();
    return employeeSummaries.filter(s => {
      const name = `${s.employee.firstName || ''} ${s.employee.lastName || ''}`.toLowerCase();
      const code = (s.employee.employeeCode || '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [employeeSummaries, cardSearch]);

  // Specific employee's records for calendar view
  const calendarRecords = useMemo(() => {
    if (viewMode !== 'calendar' || selectedEmployeeId === 'all') return [];
    return attendanceData?.items?.filter(r => r.employeeId === selectedEmployeeId) || [];
  }, [viewMode, selectedEmployeeId, attendanceData?.items]);

  const calendarStats = useMemo(() => {
    if (viewMode !== 'calendar' || selectedEmployeeId === 'all') {
      return { presentDays: 0, absentDays: 0, halfDays: 0, weekOffDays: 0, sunHolPresent: 0 };
    }

    // Use local date string (IST timezone) for today comparison
    const todayStr = new Date().toLocaleDateString('en-CA');
    const daysInMonth = lastDay;
    let present = 0;
    let absent = 0;
    let half = 0;
    let weekOff = 0;
    let sunHolPresent = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${selectedYear}-${selectedMonth.padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
      if (dateStr > todayStr) continue;

      const dayOfWeek = new Date(parseInt(selectedYear), parseInt(selectedMonth) - 1, d).getDay();
      const isSunday = (dayOfWeek === 0);
      const isHolidayFromList = holidaysList?.some((h: any) => h.date?.slice(0, 10) === dateStr);
      // Use local IST date extraction to fix the 5.5h UTC-shift from mysql2
      const record = calendarRecords.find(r => new Date(r.attendanceDate).toLocaleDateString('en-CA') === dateStr);
      const isHoliday = isHolidayFromList || record?.status === 'HOLIDAY';
      const hasPunchIn = Boolean(record?.punchInAt);
      const isPresent = record?.status === 'PRESENT' || hasPunchIn;

      if (isHoliday || isSunday) {
        if (isPresent) {
          present++;
          sunHolPresent++;
        } else {
          weekOff++;
        }
      } else {
        if (isPresent) {
          present++;
        } else if (record?.status === 'HALF_DAY') {
          half++;
        } else if (record?.status === 'LEAVE') {
          // don't count as absent
        } else {
          absent++;
        }
      }
    }

    return {
      presentDays: present,
      absentDays: absent,
      halfDays: half,
      weekOffDays: weekOff,
      sunHolPresent,
    };
  }, [viewMode, selectedEmployeeId, selectedYear, selectedMonth, lastDay, calendarRecords, holidaysList]);

  const saveAdjustmentMutation = useMutation({
    mutationFn: async () => {
      const dateStr = editTarget.dateStr;

      // Build punchPairs array from UI state — convert local HH:MM to local Date ISO strings
      const builtPairs = editStatus === 'PRESENT'
        ? punchPairs
            .filter(p => p.punchIn) // must have at least an in-time
            .map(p => {
              const [inH, inM] = p.punchIn.split(':').map(Number);
              const inDate = new Date(`${dateStr}T00:00:00`);
              inDate.setHours(inH || 0, inM || 0, 0, 0);

              let outDate: Date | undefined = undefined;
              if (p.punchOut) {
                const [outH, outM] = p.punchOut.split(':').map(Number);
                outDate = new Date(`${dateStr}T00:00:00`);
                outDate.setHours(outH || 0, outM || 0, 0, 0);
              }

              return {
                punchInAt: inDate.toISOString(),
                punchOutAt: outDate ? outDate.toISOString() : undefined,
              };
            })
        : [];

      if (editTarget?.record?.id) {
        return attendanceApi.adjust(editTarget.record.id, {
          status: editStatus,
          punchPairs: builtPairs.length > 0 ? builtPairs : undefined,
          reason: 'Admin adjustment from calendar',
        });
      } else {
        // For new records, use first pair as primary
        const first = builtPairs[0];
        return attendanceApi.createManual({
          employeeId: selectedEmployeeId,
          attendanceDate: new Date(`${dateStr}T00:00:00.000Z`).toISOString(),
          status: editStatus,
          punchInAt:  first?.punchInAt,
          punchOutAt: first?.punchOutAt,
          reason: 'Admin entry from calendar',
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      setEditModalOpen(false);
      setEditTarget(null);
    },
    onError: (error: any) => {
      console.error('Failed to save attendance adjustment:', error);
      alert(`Error saving changes: ${error?.message || 'Failed to save'}`);
    }
  });

  const openEditModal = (dateStr: string, record: any, isFuture: boolean) => {
    if (isFuture) return;
    setEditTarget({ dateStr, record });

    const isRecordPresent = record?.status === 'PRESENT' || Boolean(record?.punchInAt || record?.punchOutAt);
    setEditStatus(isRecordPresent ? 'PRESENT' : 'ABSENT');

    // Helper: DateTime → 'HH:MM' in local timezone (Asia/Kolkata)
    const toHHMM = (iso: string | null | undefined): string => {
      if (!iso) return '';
      const d = new Date(iso);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    };

    // Build pairs from the record (prioritize punchPairs array if available)
    const pairs: { punchIn: string; punchOut: string }[] = [];
    const extras = record?.punchPairs;
    if (Array.isArray(extras) && extras.length > 0) {
      for (const ep of extras) {
        pairs.push({ punchIn: toHHMM(ep.punchInAt), punchOut: toHHMM(ep.punchOutAt) });
      }
    } else if (record?.punchInAt) {
      pairs.push({ punchIn: toHHMM(record.punchInAt), punchOut: toHHMM(record.punchOutAt) });
    }
    // Always show at least one row
    if (pairs.length === 0) pairs.push({ punchIn: '', punchOut: '' });

    setPunchPairs(pairs);
    setEditModalOpen(true);
  };

  const renderGrid = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3.5 mt-6">
      {filteredSummaries.length === 0 ? (
        <div className="col-span-full py-12 text-center text-muted-foreground bg-card border border-dashed rounded-xl">
          <p className="text-sm font-medium">No employees found matching "{cardSearch}".</p>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setCardSearch('')}
            className="mt-2 text-xs text-primary"
          >
            Clear Filter
          </Button>
        </div>
      ) : (
        filteredSummaries.map(summary => {
          const firstInitial = (summary.employee.firstName || '').trim().charAt(0) || '?';
          const lastInitial = (summary.employee.lastName || '').trim().replace(/^[-_]+/, '').charAt(0) || '';
          const initials = `${firstInitial}${lastInitial}`.toUpperCase();

          return (
            <Card 
              key={summary.employee.id} 
              className="group flex flex-col border-border bg-card shadow-sm hover:shadow-md hover:border-primary/40 transition-all rounded-xl overflow-hidden"
            >
              <CardContent className="p-3.5 flex flex-col items-center gap-2.5 flex-1 justify-between">
                {/* Avatar */}
                <div className="w-11 h-11 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary tracking-wider shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                  {initials}
                </div>

                {/* Name & Code */}
                <div className="text-center w-full min-w-0">
                  <h3 
                    className="font-semibold text-sm text-foreground truncate" 
                    title={`${summary.employee.firstName} ${summary.employee.lastName}`}
                  >
                    {summary.employee.firstName} {summary.employee.lastName}
                  </h3>
                  <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                    {summary.employee.employeeCode || '—'}
                  </p>
                </div>

                {/* 2x2 Stat Grid */}
                <div className="grid grid-cols-2 gap-1.5 w-full">
                  {/* Present */}
                  <div className="flex flex-col items-center justify-center py-1.5 px-1 rounded-md bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40">
                    <span className="text-base font-bold text-emerald-600 dark:text-emerald-500 leading-tight">
                      {summary.presentDays}
                    </span>
                    <span className="text-[9px] uppercase text-emerald-700/80 dark:text-emerald-400/80 font-bold tracking-wider mt-0.5">
                      Present
                    </span>
                  </div>

                  {/* Absent */}
                  <div className="flex flex-col items-center justify-center py-1.5 px-1 rounded-md bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40">
                    <span className="text-base font-bold text-rose-600 dark:text-rose-500 leading-tight">
                      {summary.absentDays}
                    </span>
                    <span className="text-[9px] uppercase text-rose-700/80 dark:text-rose-400/80 font-bold tracking-wider mt-0.5">
                      Absent
                    </span>
                  </div>

                  {/* Half Day */}
                  <div className="flex flex-col items-center justify-center py-1.5 px-1 rounded-md bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
                    <span className="text-base font-bold text-amber-600 dark:text-amber-500 leading-tight">
                      {summary.halfDays}
                    </span>
                    <span className="text-[9px] uppercase text-amber-700/80 dark:text-amber-400/80 font-bold tracking-wider mt-0.5">
                      Half Day
                    </span>
                  </div>

                  {/* Week Off */}
                  <div className="flex flex-col items-center justify-center py-1.5 px-1 rounded-md bg-muted/40 border border-border/60">
                    <span className="text-base font-bold text-muted-foreground leading-tight">
                      {summary.weekOffDays}
                    </span>
                    <span className="text-[9px] uppercase text-muted-foreground font-bold tracking-wider mt-0.5">
                      Week Off
                    </span>
                  </div>
                </div>

                {/* View Calendar Button */}
                <Button 
                  variant="outline" 
                  size="sm"
                  className="w-full h-8 text-xs text-primary border-primary/40 hover:bg-primary hover:text-primary-foreground gap-1.5 font-semibold transition-colors mt-0.5"
                  onClick={() => { 
                    setSelectedEmployeeId(summary.employee.id); 
                    setViewMode('calendar'); 
                  }}
                >
                  <CalendarIcon className="w-3.5 h-3.5" /> View Calendar
                </Button>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );

  const renderCalendar = () => {
    const firstDayOfWeek = new Date(parseInt(selectedYear), parseInt(selectedMonth) - 1, 1).getDay();
    const blanks = Array.from({ length: firstDayOfWeek }).map((_, i) => (
      <div key={`blank-${i}`} className="p-3 rounded-xl border border-dashed border-slate-100 bg-slate-50/20 min-h-[110px]" />
    ));

    const todayStr = new Date().toLocaleDateString('en-CA');

    const days = Array.from({ length: lastDay }).map((_, i) => {
      const day = i + 1;
      const dateStr = `${selectedYear}-${selectedMonth.padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const dayOfWeek = new Date(parseInt(selectedYear), parseInt(selectedMonth) - 1, day).getDay();
      const isSunday = dayOfWeek === 0;

      const holidayItem = holidaysList?.find((h: any) => h.date?.slice(0, 10) === dateStr);
      const isHolidayFromList = Boolean(holidayItem);
      const isFuture = dateStr > todayStr;

      const formatTime = (dt: string | null | undefined) =>
        dt ? new Date(dt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--:--';

      const toLocalDate = (d: string) => new Date(d).toLocaleDateString('en-CA');
      const record = calendarRecords.find((r) => toLocalDate(r.attendanceDate) === dateStr);

      const isHoliday = isHolidayFromList || record?.status === 'HOLIDAY';
      const holidayName = holidayItem?.name || record?.notes || 'Holiday';
      const hasPunchIn = Boolean(record?.punchInAt);
      const hasPunchOut = Boolean(record?.punchOutAt);
      const isIncomplete = hasPunchIn && !hasPunchOut;
      const hasPunches = hasPunchIn;
      const isPresent = record?.status === 'PRESENT' || hasPunches;

      const pairs: { in: string | null; out: string | null }[] = [];
      const extras = (record as any)?.punchPairs;
      if (Array.isArray(extras) && extras.length > 0) {
        for (const ep of extras) {
          pairs.push({ in: ep.punchInAt, out: ep.punchOutAt || null });
        }
      } else if (record?.punchInAt) {
        pairs.push({ in: record.punchInAt, out: record.punchOutAt || null });
      }

      const renderPairs = (borderColor: string, incompleteColor: string) => (
        <div className={`mt-auto pt-2 border-t ${borderColor} flex flex-col gap-0.5 text-[11px]`}>
          {pairs.map((p, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">{formatTime(p.in)}</span>
              <span className={`font-semibold ${!p.out ? incompleteColor : 'text-slate-700'}`}>
                {p.out ? formatTime(p.out) : '--:--'}
              </span>
            </div>
          ))}
        </div>
      );

      let cardBg = 'bg-white border-slate-200';
      let badge = null;
      let bodyEl = null;

      if (isFuture) {
        cardBg = 'bg-slate-50/40 border-slate-100 opacity-40 cursor-not-allowed';
      } else if (isHoliday) {
        if (hasPunchIn) {
          cardBg = 'bg-amber-50/40 border-amber-300 hover:border-amber-400 hover:bg-amber-50/60 shadow-sm';
          badge = (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
              Holiday (Worked)
            </span>
          );
          bodyEl = renderPairs('border-amber-200/60', 'text-amber-600');
        } else {
          cardBg = 'bg-amber-50/60 border-amber-300 hover:border-amber-400 hover:bg-amber-50/80 shadow-sm';
          badge = (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-900 border border-amber-300">
              HOLIDAY
            </span>
          );
          bodyEl = (
            <div className="my-auto py-1 text-center">
              <span className="text-xs font-bold text-amber-800 block truncate px-1" title={holidayName}>
                {holidayName}
              </span>
            </div>
          );
        }
      } else if (isSunday) {
        if (hasPunchIn) {
          cardBg = isIncomplete
            ? 'bg-amber-50/30 border-amber-300 hover:bg-amber-50/50 shadow-sm'
            : 'bg-emerald-50/30 border-emerald-300 hover:bg-emerald-50/50 shadow-sm';
          badge = (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
              Sunday (Worked)
            </span>
          );
          bodyEl = renderPairs('border-emerald-200/60', 'text-amber-600');
        } else {
          cardBg = 'bg-slate-50/70 border-slate-200 text-slate-400';
          badge = (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-500">
              Off
            </span>
          );
          bodyEl = (
            <div className="my-auto py-1 text-center">
              <span className="text-xs font-medium text-slate-400">Week Off</span>
            </div>
          );
        }
      } else if (isIncomplete) {
        cardBg = 'bg-amber-50/30 border-amber-400 hover:bg-amber-50/50 shadow-sm';
        badge = (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
            No Out
          </span>
        );
        bodyEl = renderPairs('border-amber-200/60', 'text-amber-600');
      } else if (isPresent) {
        cardBg = 'bg-emerald-50/20 border-emerald-300 hover:border-emerald-400 hover:bg-emerald-50/40 shadow-sm';
        badge = (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
            Present
          </span>
        );
        bodyEl = renderPairs('border-emerald-100', 'text-amber-600');
      } else if (record?.status === 'HALF_DAY') {
        cardBg = 'bg-amber-50/20 border-amber-300 hover:border-amber-400 hover:bg-amber-50/40 shadow-sm';
        badge = (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
            Half Day
          </span>
        );
        bodyEl = renderPairs('border-amber-100', 'text-amber-600');
      } else if (record?.status === 'LEAVE') {
        cardBg = 'bg-sky-50/30 border-sky-300 hover:border-sky-400 hover:bg-sky-50/50 shadow-sm';
        badge = (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200">
            Leave
          </span>
        );
        bodyEl = (
          <div className="my-auto py-1 text-center">
            <span className="text-xs font-semibold text-sky-700">On Leave</span>
          </div>
        );
      } else {
        // No record at all = Absent
        cardBg = 'bg-rose-50/40 border-rose-300 hover:border-rose-400 hover:bg-rose-50/60 shadow-sm';
        badge = (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200">
            ABSENT
          </span>
        );
        bodyEl = (
          <div className="my-auto py-1 text-center">
            <span className="text-xs font-semibold text-rose-600">Absent</span>
          </div>
        );
      }

      return (
        <div
          key={day}
          onClick={() => openEditModal(dateStr, record, isFuture)}
          className={`p-2.5 border rounded-xl flex flex-col min-h-[110px] transition-all ${
            !isFuture ? 'cursor-pointer' : ''
          } ${cardBg}`}
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-sm text-slate-800">{day}</span>
            {badge}
          </div>
          {bodyEl}
        </div>
      );
    });

    return (
      <div className="mt-6 bg-card border rounded-2xl p-6 shadow-sm overflow-x-auto">
        <div className="min-w-[840px]">
          <div className="grid grid-cols-7 gap-3 mb-3">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div
                key={d}
                className={`text-center text-xs font-bold uppercase tracking-wider py-1 rounded ${
                  d === 'Sun' ? 'text-rose-500 bg-rose-50/50' : 'text-slate-500 bg-slate-50/50'
                }`}
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-3">
            {blanks}
            {days}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      <Card className="bg-card shadow-sm border-border">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <SearchableEmployeeSelect
              employees={employeesData?.items || []}
              value={viewMode === 'grid' ? 'all' : selectedEmployeeId}
              onChange={(val) => {
                if (val === 'all') {
                  setViewMode('grid');
                  setSelectedEmployeeId('all');
                } else {
                  setSelectedEmployeeId(val);
                  setViewMode('calendar');
                }
              }}
            />

            <Select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="w-32 font-medium">
              {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>

            <Select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="w-28 font-medium">
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </Select>

            {viewMode === 'grid' && (
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Filter cards..."
                  value={cardSearch}
                  onChange={(e) => setCardSearch(e.target.value)}
                  className="pl-8 pr-7 h-10 text-xs bg-background"
                />
                {cardSearch && (
                  <button
                    type="button"
                    onClick={() => setCardSearch('')}
                    className="absolute right-2.5 top-3 text-xs text-muted-foreground hover:text-foreground p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {viewMode === 'calendar' && (
             <div className="flex gap-6 items-center px-4 overflow-x-auto flex-1">
                <div className="text-center flex flex-col items-center">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-500 leading-none">{calendarStats.presentDays}</div>
                  <div className="text-[10px] text-muted-foreground uppercase font-bold mt-1 tracking-wider">Present</div>
                </div>
                <div className="text-center flex flex-col items-center">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-500 leading-none">{calendarStats.absentDays}</div>
                  <div className="text-[10px] text-muted-foreground uppercase font-bold mt-1 tracking-wider">Absent</div>
                </div>
                <div className="text-center flex flex-col items-center">
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-500 leading-none">{calendarStats.halfDays}</div>
                  <div className="text-[10px] text-muted-foreground uppercase font-bold mt-1 tracking-wider">Half Day</div>
                </div>
                <div className="text-center flex flex-col items-center">
                  <div className="text-2xl font-bold text-muted-foreground leading-none">{calendarStats.weekOffDays}</div>
                  <div className="text-[10px] text-muted-foreground uppercase font-bold mt-1 tracking-wider">Week Off</div>
                </div>
                <div className="text-center flex flex-col items-center">
                  <div className="text-2xl font-bold text-cyan-500 leading-none">{calendarStats.sunHolPresent}</div>
                  <div className="text-[10px] text-muted-foreground uppercase font-bold mt-1 tracking-wider">Sun/Hol Present</div>
                </div>
                <div className="ml-auto pl-6 border-l border-border hidden sm:block">
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={() => navigate(`/admin/salary?employeeId=${selectedEmployeeId}`)}
                    className="font-semibold shadow-sm"
                  >
                    View Salary Card
                  </Button>
                </div>
             </div>
          )}
        </CardContent>
      </Card>

      {viewMode === 'grid' ? renderGrid() : renderCalendar()}

      {/* Edit Modal with Portal to document.body and full screen blur */}
      {editModalOpen && editTarget && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-md transition-opacity" 
            onClick={() => setEditModalOpen(false)}
          />
          
          <div className="relative z-10 bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center p-6 pb-2 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">Edit Attendance</h2>
              <Button variant="ghost" size="icon" onClick={() => setEditModalOpen(false)}>
                <span className="text-xl leading-none">&times;</span>
              </Button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="text-sky-500 font-semibold text-sm">
                {new Date(editTarget.dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' })}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <Button
                  type="button"
                  variant="outline"
                  className={`h-12 border-2 font-bold transition-all ${editStatus === 'PRESENT' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'border-slate-200 text-slate-600'}`}
                  onClick={() => setEditStatus('PRESENT')}
                >
                  <span className={`w-4 h-4 rounded-full border-2 mr-2 flex items-center justify-center ${editStatus === 'PRESENT' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-400'}`}>
                    {editStatus === 'PRESENT' && <span className="text-[10px]">✓</span>}
                  </span>
                  PRESENT
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={`h-12 border-2 font-bold transition-all ${editStatus === 'ABSENT' ? 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400' : 'border-slate-200 text-slate-600'}`}
                  onClick={() => setEditStatus('ABSENT')}
                >
                  <span className={`w-4 h-4 rounded-full border-2 mr-2 flex items-center justify-center ${editStatus === 'ABSENT' ? 'border-rose-500 bg-rose-500 text-white' : 'border-slate-400'}`}>
                    {editStatus === 'ABSENT' && <span className="text-[10px]">×</span>}
                  </span>
                  ABSENT
                </Button>
              </div>

              {editStatus === 'PRESENT' && (
                <div className="space-y-3">
                  <label className="text-sm font-semibold text-slate-600 dark:text-slate-300">Punch Times</label>
                  <div className="space-y-2">
                    {punchPairs.map((pair, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        {/* Punch In */}
                        <div className="flex-1 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 flex items-center bg-white dark:bg-slate-900">
                          <input
                            type="time"
                            className="w-full bg-transparent outline-none font-medium text-sm text-slate-800 dark:text-white"
                            value={pair.punchIn}
                            onChange={e => {
                              const next = [...punchPairs];
                              const curr = next[idx];
                              if (curr) {
                                next[idx] = { punchIn: e.target.value, punchOut: curr.punchOut };
                                setPunchPairs(next);
                              }
                            }}
                          />
                        </div>
                        <span className="text-xs text-slate-400 shrink-0">to</span>
                        {/* Punch Out */}
                        <div className="flex-1 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 flex items-center bg-white dark:bg-slate-900">
                          <input
                            type="time"
                            className="w-full bg-transparent outline-none font-medium text-sm text-slate-800 dark:text-white"
                            value={pair.punchOut}
                            onChange={e => {
                              const next = [...punchPairs];
                              const curr = next[idx];
                              if (curr) {
                                next[idx] = { punchIn: curr.punchIn, punchOut: e.target.value };
                                setPunchPairs(next);
                              }
                            }}
                          />
                        </div>
                        {/* Delete button — only show if more than 1 row */}
                        {punchPairs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setPunchPairs(punchPairs.filter((_, i) => i !== idx))}
                            className="text-rose-500 hover:text-rose-700 text-lg leading-none px-1 shrink-0"
                            title="Remove this entry"
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Add Entry button */}
                  {punchPairs.length < 12 && (
                    <button
                      type="button"
                      onClick={() => setPunchPairs([...punchPairs, { punchIn: '', punchOut: '' }])}
                      className="w-full mt-1 flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-dashed border-sky-300 text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/20 text-sm font-semibold transition-colors"
                    >
                      <span className="text-base">⊕</span> Add Punch Entry
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="p-6 pt-2 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700">
              <Button variant="ghost" onClick={() => setEditModalOpen(false)}>Cancel</Button>
              <Button 
                type="button"
                onClick={() => saveAdjustmentMutation.mutate()} 
                disabled={saveAdjustmentMutation.isPending}
                className="bg-sky-500 hover:bg-sky-600 text-white font-semibold shadow-sm px-5"
              >
                {saveAdjustmentMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
