import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salaryApi, employeesApi, attendanceApi, holidaysApi, settingsApi } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Printer,
  Mail,
  Download,
  Loader2
} from 'lucide-react';
import { useRef } from 'react';
import defaultCompanyLogo from '@/assets/logo.jpeg';

// Custom Searchable Select
function SearchableEmployeeSelect({ options, value, onChange }: { options: any[], value: string, onChange: (v: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));
  const selectedOption = options.find(o => o.value === value);

  return (
    <div className="relative w-64 z-50 font-medium" ref={ref}>
      <div 
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer border-slate-200"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="truncate">{selectedOption?.label || 'Select Employee'}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 opacity-50"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md bg-white border-slate-200">
          <div className="p-2 border-b border-slate-100">
            <input 
              type="text" 
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring border-slate-200"
              placeholder="Search employee..." 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="p-2 text-sm text-center text-muted-foreground">No results found.</div>
            ) : (
              filteredOptions.map(opt => (
                <div 
                  key={opt.value} 
                  className={`relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none hover:bg-slate-100 ${value === opt.value ? 'bg-slate-100 font-medium' : ''}`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearch('');
                  }}
                >
                  {opt.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Convert a "HH:mm" shift time string to 12-hour AM/PM format, e.g. "09:00" → "09:00 AM" */
function fmt12h(timeStr: string): string {
  if (!timeStr) return '--:--';
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

export function SalaryManagementPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const YEARS = Array.from({ length: 5 }, (_, i) => (currentYear - 2 + i).toString());

  // Filter States
  const [selectedYear, setSelectedYear] = useState(searchParams.get('year') || currentYear.toString());
  const [selectedMonth, setSelectedMonth] = useState(searchParams.get('month') || String(new Date().getMonth() + 1).padStart(2, '0'));
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>(searchParams.get('employeeId') || 'all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Selected checkboxes for bulk actions & selected total calculation
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Local card state for commission, advance, remarks, excludeSundayHoliday, and status
  const [cardEdits, setCardEdits] = useState<Record<string, {
    commission: number;
    advance: number;
    remarks: string;
    excludeSundayHoliday: boolean;
    status: 'PAID' | 'PENDING';
  }>>({});

  // Slip Modal & Report Modal states
  const [slipModalTarget, setSlipModalTarget] = useState<any | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [downloadingEmpId, setDownloadingEmpId] = useState<string | null>(null);

  // Month date range
  const monthStart = `${selectedYear}-${selectedMonth}-01`;
  const totalDaysInMonth = new Date(parseInt(selectedYear), parseInt(selectedMonth), 0).getDate();
  const monthEnd = `${selectedYear}-${selectedMonth}-${String(totalDaysInMonth).padStart(2, '0')}`;
  const monthIso = `${selectedYear}-${selectedMonth}-01`;

  // Previous month ISO (for last-month-pending carry-forward)
  const prevMonthDate = new Date(parseInt(selectedYear), parseInt(selectedMonth) - 2, 1);
  const prevMonthIso = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

  // 1. Fetch Active Employees only (exclude former/inactive employees)
  const { data: employeesData, isLoading: isEmployeesLoading } = useQuery({
    queryKey: ['employees', 'all', 'ACTIVE'],
    queryFn: () => employeesApi.list({ pageSize: '1000', status: 'ACTIVE' }),
  });

  // 2. Fetch Attendance for the month
  const { data: attendanceData } = useQuery({
    queryKey: ['attendance', 'all', monthStart, monthEnd],
    queryFn: () => attendanceApi.listAll({ from: monthStart, to: monthEnd, pageSize: '10000' }),
  });

  // 3. Fetch Holidays for the year
  const { data: holidaysList = [] } = useQuery({
    queryKey: ['holidays', selectedYear],
    queryFn: () => holidaysApi.list({ year: selectedYear }),
  });

  const employeeOptions = useMemo(() => {
    if (!employeesData?.items) return [{ value: 'all', label: 'All Employees' }];
    const sorted = [...employeesData.items].sort((a, b) => {
      const aName = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase();
      const bName = `${b.firstName || ''} ${b.lastName || ''}`.trim().toLowerCase();
      return aName.localeCompare(bName);
    });
    return [
      { value: 'all', label: 'All Employees' },
      ...sorted.map(emp => ({ 
        value: emp.id, 
        label: `${emp.firstName || ''} ${emp.lastName || ''} - ${emp.employeeCode || ''}` 
      }))
    ];
  }, [employeesData?.items]);

  // 4. Fetch Saved Salary Records for the month
  const { data: savedSalaries } = useQuery({
    queryKey: ['salary', 'all', monthIso],
    queryFn: () => salaryApi.listAll({ month: monthIso, pageSize: '1000' }),
  });

  // 4b. Fetch PREVIOUS month's saved salary records for carry-forward pending amount
  const { data: prevMonthSalaries } = useQuery({
    queryKey: ['salary', 'all', prevMonthIso],
    queryFn: () => salaryApi.listAll({ month: prevMonthIso, pageSize: '1000' }),
    staleTime: 60_000,
  });

  // 5. Fetch historically-correct effective salary rates for the selected month
  // This returns { [employeeId]: correctSalaryForThatMonth } using salary_history table
  const { data: effectiveRates } = useQuery({
    queryKey: ['salary', 'effective-rates', monthIso],
    queryFn: () => salaryApi.effectiveRates(monthIso),
    staleTime: 60_000,
  });

  // Build a map of employeeId -> last month's PENDING net salary (carry-forward)
  const lastPendingMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!prevMonthSalaries?.items) return map;
    for (const record of prevMonthSalaries.items as any[]) {
      if (record.status !== 'PAID') {
        map[record.employeeId] = Math.round(Number(record.netSalary || 0));
      }
    }
    return map;
  }, [prevMonthSalaries?.items]);

  // Populate local card edits whenever saved salaries or month changes
  useEffect(() => {
    const edits: typeof cardEdits = {};
    if (savedSalaries?.items) {
      savedSalaries.items.forEach((item: any) => {
        edits[item.employeeId] = {
          commission: Number(item.commissionAmount || 0),
          advance: Number(item.advanceDeducted || 0),
          remarks: item.remarks || '',
          excludeSundayHoliday: Boolean(item.excludeSundayHoliday),
          status: item.status === 'PAID' ? 'PAID' : 'PENDING',
        };
      });
    }
    setCardEdits(edits);
  }, [savedSalaries?.items, monthIso]);

  // Sundays in month
  const sundayDates = useMemo(() => {
    const dates: string[] = [];
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dateObj = new Date(parseInt(selectedYear), parseInt(selectedMonth) - 1, d);
      if (dateObj.getDay() === 0) {
        dates.push(`${selectedYear}-${selectedMonth}-${String(d).padStart(2, '0')}`);
      }
    }
    return dates;
  }, [selectedYear, selectedMonth, totalDaysInMonth]);

  // Unique holidays (not on Sunday)
  const uniqueHolidays = useMemo(() => {
    return holidaysList.filter((h: any) => {
      const dStr = h.date?.slice(0, 10);
      return dStr && !sundayDates.includes(dStr) && dStr.startsWith(`${selectedYear}-${selectedMonth}`);
    });
  }, [holidaysList, sundayDates, selectedYear, selectedMonth]);

  // Calculate Salary Components for each employee
  const calculatedCards = useMemo(() => {
    if (!employeesData?.items) return [];
    const attendances = attendanceData?.items || [];
    const sundaysCount = sundayDates.length;
    const holidaysCount = uniqueHolidays.length;
    const totalWorkingDays = totalDaysInMonth - sundaysCount - holidaysCount;

    // Group attendance by employee
    const empAttMap = new Map<string, any[]>();
    attendances.forEach(att => {
      if (!empAttMap.has(att.employeeId)) empAttMap.set(att.employeeId, []);
      empAttMap.get(att.employeeId)!.push(att);
    });

    // Helper for paid Sundays/Holidays rule
    const getPaidCount = (presentDays: number, totalOff: number) => {
      if (presentDays >= 18) return totalOff;
      if (presentDays >= 12) return Math.min(2, totalOff);
      if (presentDays >= 5) return Math.min(1, totalOff);
      return 0;
    };

    return employeesData.items
      // Only show employees who had joined by the end of this month OR have a saved salary record for this month
      .filter(emp => {
        const hasSaved = savedSalaries?.items?.some((s: any) => s.employeeId === emp.id);
        if (hasSaved) return true;
        const joining = (emp as any).joiningDate;
        if (!joining) return true; // no joining date set — include them
        // Compare joining date to last day of selected month
        const joiningMs = new Date(joining).getTime();
        const monthEndMs = new Date(monthEnd + 'T23:59:59Z').getTime();
        return joiningMs <= monthEndMs;
      })
      .map(emp => {
      const empLogs = empAttMap.get(emp.id) || [];
      // Use the historically-correct salary for this month (from salary_history table).
      // Falls back to emp.baseSalary if the API hasn't loaded yet or no history exists.
      const monthlySalary = effectiveRates
        ? (effectiveRates[emp.id] ?? Number(emp.baseSalary || 0))
        : Number(emp.baseSalary || 0);

      // Shift hours — read from the employee's latest assigned shift (employeeShifts[0])
      let shiftHours = 10.5; // sensible default matching legacy 09:00–19:30
      let shiftStartTime = '09:00';
      let shiftEndTime   = '19:30';
      let shiftName      = 'Full Day';
      const latestShift = (emp as any).employeeShifts?.[0]?.shift;
      if (latestShift?.startTime && latestShift?.endTime) {
        shiftStartTime = latestShift.startTime;
        shiftEndTime   = latestShift.endTime;
        shiftName      = latestShift.name || 'Full Day';
        const [sh, sm] = shiftStartTime.split(':').map(Number);
        const [eh, em] = shiftEndTime.split(':').map(Number);
        const shiftH = sh || 0;
        const shiftM = sm || 0;
        const endH = eh || 0;
        const endM = em || 0;
        let diffMinutes = (endH * 60 + endM) - (shiftH * 60 + shiftM);
        if (diffMinutes <= 0) diffMinutes += 24 * 60; // crosses midnight
        shiftHours = diffMinutes / 60;
      }

      // Per day & hour rate ─ keep EXACT precision for all calculations
      // Only the display values get rounded; using rounded intermediates causes ₹2+ errors
      const perDaySalaryExact = totalDaysInMonth > 0 ? monthlySalary / totalDaysInMonth : 0;
      const hourRateExact     = shiftHours > 0 ? perDaySalaryExact / shiftHours : 0;
      // Display-only rounded versions (shown in the card)
      const perDaySalary = Number(perDaySalaryExact.toFixed(2));
      const hourRate     = Number(hourRateExact.toFixed(2));

      // Group day logs — compute worked seconds per day.
      // Priority: use punchInAt→punchOutAt diff (exact, matches old system's IN/OUT pairing).
      // Also sum any additional punch pairs stored in punchPairs JSON.
      // Fallback to workedMinutes only when no punch pair exists (e.g. leave/holiday records).
      const daySecondsMap = new Map<string, number>();
      empLogs.forEach(log => {
        // Use local IST date extraction to fix mysql2 IST→UTC 5.5h shift
        const dStr = new Date(log.attendanceDate).toLocaleDateString('en-CA');
        let secs = 0;

        const extraPairs = (log as any).punchPairs;
        if (Array.isArray(extraPairs) && extraPairs.length > 0) {
          // If punchPairs is present, it contains all pairs for the day
          for (const pair of extraPairs) {
            if (pair?.punchInAt && pair?.punchOutAt) {
              const pairDiff = (new Date(pair.punchOutAt).getTime() - new Date(pair.punchInAt).getTime()) / 1000;
              if (pairDiff > 0) secs += pairDiff;
            }
          }
        } else if (log.punchInAt && log.punchOutAt) {
          // Primary single pair fallback
          const diff = (new Date(log.punchOutAt).getTime() - new Date(log.punchInAt).getTime()) / 1000;
          if (diff > 0) secs += diff;
        } else if (log.workedMinutes) {
          // Fallback: pre-computed value
          secs = log.workedMinutes * 60;
        }

        daySecondsMap.set(dStr, (daySecondsMap.get(dStr) || 0) + secs);
      });


      let totalWorkedSeconds = 0;
      let presentRegularDays = 0;

      for (let d = 1; d <= totalDaysInMonth; d++) {
        const dateStr = `${selectedYear}-${selectedMonth}-${String(d).padStart(2, '0')}`;
        const dateObj = new Date(parseInt(selectedYear), parseInt(selectedMonth) - 1, d);
        const isSun = (dateObj.getDay() === 0);
        const isHol = holidaysList.some((h: any) => h.date?.slice(0, 10) === dateStr);
        const secs = daySecondsMap.get(dateStr) || 0;

        if (!isSun && !isHol && secs > 0) {
          presentRegularDays++;
        }
        totalWorkedSeconds += secs;
      }

      // Exact (unrounded) hours for calculations; display value rounded to 1dp
      const totalHoursExact    = totalWorkedSeconds / 3600;
      const totalHours         = Number(totalHoursExact.toFixed(1));   // display only

      // Expected hours = days actually PRESENT × shift hours.
      // This matches the old system: $expected_hours = $presentRegularDays * $shift_hours
      // NOT totalWorkingDays — absent days don't count as "expected" to work.
      const expectedHoursExact = presentRegularDays * shiftHours;
      const expectedHours      = Number(expectedHoursExact.toFixed(1)); // display only

      const overtimeHoursExact = Math.max(0, totalHoursExact - expectedHoursExact);
      const overtimeHours      = Number(overtimeHoursExact.toFixed(1)); // display only
      const overtimePayout     = Number((overtimeHoursExact * hourRateExact).toFixed(2));

      const paidSundays = getPaidCount(presentRegularDays, sundaysCount);
      const paidHolidays = getPaidCount(presentRegularDays, holidaysCount);
      // Saved DB record match
      const savedRecord = savedSalaries?.items?.find((s: any) => s.employeeId === emp.id) as any;

      // User card edit values
      const currentEdit = cardEdits[emp.id] || {
        commission: savedRecord ? Number(savedRecord.commissionAmount || 0) : 0,
        advance: savedRecord ? Number(savedRecord.advanceDeducted || 0) : 0,
        remarks: savedRecord?.remarks || '',
        excludeSundayHoliday: Boolean(savedRecord?.excludeSundayHoliday),
        status: (savedRecord?.status === 'PAID' ? 'PAID' : 'PENDING') as 'PAID' | 'PENDING',
      };

      const totalPaidOffDays = paidSundays + paidHolidays;
      const sundayHolidayPay = currentEdit.excludeSundayHoliday ? 0 : Number((totalPaidOffDays * perDaySalaryExact).toFixed(2));
      // Basic salary: totalHours × hourRate — overtime hours are already included in totalHours,
      // so overtimePayout is NOT added separately (it would double-count).
      // overtimePayout is shown on the card for information only.
      // Formula matches old system: final = basicPay + sundayHolidayPay + commission - advance
      const basicSalary  = Number((totalHoursExact * hourRateExact).toFixed(2));
      const thisMonthNet = Math.round(basicSalary + sundayHolidayPay + currentEdit.commission - currentEdit.advance);
      
      const lastPending = lastPendingMap[emp.id] ?? 0;
      const totalWithPending = thisMonthNet + lastPending;

      return {
        emp,
        monthlySalary,
        shiftHours,
        shiftName,
        shiftStartTime,
        shiftEndTime,
        perDaySalary,
        hourRate,
        totalDaysInMonth,
        totalWorkingDays,
        sundaysCount,
        holidaysCount,
        presentRegularDays,
        totalHours,
        expectedHours,
        overtimeHours,
        overtimePayout,
        paidSundays,
        paidHolidays,
        totalPaidOffDays,
        sundayHolidayPay,
        basicSalary,
        lastPending,
        thisMonthNet,
        totalWithPending,
        commission: currentEdit.commission,
        advance: currentEdit.advance,
        remarks: currentEdit.remarks,
        excludeSundayHoliday: currentEdit.excludeSundayHoliday,
        status: savedRecord?.status === 'PAID' ? 'PAID' : (currentEdit.status || 'PENDING'),
        savedRecordId: savedRecord?.id,
      };
    });  // close .map()
  }, [
    employeesData?.items,
    attendanceData?.items,
    totalDaysInMonth,
    sundayDates,
    uniqueHolidays,
    selectedYear,
    selectedMonth,
    holidaysList,
    cardEdits,
    savedSalaries?.items,
    effectiveRates,
    monthEnd,
    lastPendingMap,
  ]);

  // Filtered Cards
  const filteredCards = useMemo(() => {
    return calculatedCards.filter(card => {
      if (filterEmployeeId !== 'all' && card.emp.id !== filterEmployeeId) return false;
      if (filterStatus === 'paid' && card.status !== 'PAID') return false;
      if (filterStatus === 'pending' && card.status === 'PAID') return false;
      return true;
    });
  }, [calculatedCards, filterEmployeeId, filterStatus]);

  // Summary Totals
  const totalDueSum = useMemo(() => calculatedCards.reduce((sum, c) => sum + c.totalWithPending, 0), [calculatedCards]);
  const paidSum = useMemo(() => calculatedCards.filter(c => c.status === 'PAID').reduce((sum, c) => sum + c.thisMonthNet, 0), [calculatedCards]);
  const unpaidSum = useMemo(() => calculatedCards.filter(c => c.status !== 'PAID').reduce((sum, c) => sum + c.totalWithPending, 0), [calculatedCards]);
  
  const selectedTotal = useMemo(() => {
    return calculatedCards
      .filter(c => selectedIds.includes(c.emp.id))
      .reduce((sum, c) => sum + c.totalWithPending, 0);
  }, [calculatedCards, selectedIds]);

  // Toggle Checkbox
  const handleToggleSelect = (empId: string) => {
    setSelectedIds(prev => prev.includes(empId) ? prev.filter(id => id !== empId) : [...prev, empId]);
  };

  // Select All & Clear
  const handleSelectAll = () => {
    setSelectedIds(filteredCards.map(c => c.emp.id));
  };
  const handleClearSelection = () => {
    setSelectedIds([]);
  };

  // Toggle Sunday Salary
  const handleToggleSundaySalary = (empId: string) => {
    setCardEdits(prev => ({
      ...prev,
      [empId]: {
        ...(prev[empId] || { commission: 0, advance: 0, remarks: '', status: 'PENDING' }),
        excludeSundayHoliday: !prev[empId]?.excludeSundayHoliday,
      }
    }));
  };

  // Update input fields
  const handleCardInputChange = (empId: string, field: 'commission' | 'advance' | 'remarks', value: any) => {
    setCardEdits(prev => ({
      ...prev,
      [empId]: {
        ...(prev[empId] || { commission: 0, advance: 0, remarks: '', excludeSundayHoliday: false, status: 'PENDING' }),
        [field]: value,
      }
    }));
  };

  // Save / Update Mutation
  const saveMutation = useMutation({
    mutationFn: async (targets: typeof filteredCards) => {
      for (const card of targets) {
        if (card.savedRecordId) {
          await salaryApi.update(card.savedRecordId, {
            commissionAmount: card.commission,
            advanceDeducted: card.advance,
            totalDeductions: card.advance,
            remarks: card.remarks,
          });
        } else {
          await salaryApi.create({
            employeeId: card.emp.id,
            month: monthIso,
            basicSalary: card.basicSalary,
            totalAllowances: card.sundayHolidayPay,
            totalDeductions: card.advance,
            advanceDeducted: card.advance,
            commissionAmount: card.commission,
            remarks: card.remarks,
          });
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['salary', 'all'] });
    },
    onError: (err: any) => {
      alert(`Save failed: ${err?.message || 'Error occurred'}`);
    }
  });

  // Status Change Mutation (Mark Paid / Mark Pending)
  const statusMutation = useMutation({
    mutationFn: async ({ targets, newStatus }: { targets: typeof filteredCards; newStatus: 'PAID' | 'PENDING' }) => {
      for (const card of targets) {
        let recId = card.savedRecordId;
        if (!recId) {
          const created = await salaryApi.create({
            employeeId: card.emp.id,
            month: monthIso,
            basicSalary: card.basicSalary,
            totalAllowances: card.sundayHolidayPay,
            totalDeductions: card.advance,
            advanceDeducted: card.advance,
            commissionAmount: card.commission,
            remarks: card.remarks,
          });
          recId = created.id;
        }

        await salaryApi.updateStatus(recId, {
          status: newStatus,
          paymentDate: newStatus === 'PAID' ? new Date().toISOString().slice(0, 10) : undefined,
          paymentReference: newStatus === 'PAID' ? 'Salary Paid' : undefined,
          remarks: card.remarks,
        });

        // Update local status
        setCardEdits(prev => ({
          ...prev,
          [card.emp.id]: {
            ...(prev[card.emp.id] || { commission: card.commission, advance: card.advance, remarks: card.remarks, excludeSundayHoliday: card.excludeSundayHoliday }),
            status: newStatus,
          }
        }));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['salary', 'all'] });
    },
    onError: (err: any) => {
      alert(`Status update failed: ${err?.message || 'Error occurred'}`);
    }
  });

  // Handle Single Card Actions
  const handleSaveSingle = (card: (typeof filteredCards)[0]) => {
    saveMutation.mutate([card]);
  };

  const handleMarkPaidSingle = (card: (typeof filteredCards)[0]) => {
    statusMutation.mutate({ targets: [card], newStatus: 'PAID' });
  };

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 60_000,
  });

  const [sendingEmailEmpId, setSendingEmailEmpId] = useState<string | null>(null);

  const handleMarkPendingSingle = (card: (typeof filteredCards)[0]) => {
    statusMutation.mutate({ targets: [card], newStatus: 'PENDING' });
  };

  const handleSendMail = async (card: (typeof filteredCards)[0]) => {
    if (!card.emp.email) {
      alert(`Employee "${card.emp.firstName} ${card.emp.lastName}" does not have an email address configured in their profile.`);
      return;
    }

    const monthLabel = MONTHS.find(m => m.value === selectedMonth)?.label || 'Month';
    const monthName = `${monthLabel} ${selectedYear}`;
    const empFullName = [card.emp.firstName, card.emp.lastName].filter(Boolean).join(' ');

    const payload = {
      company_name: settings?.companyName || 'BMAP EDUSERVICES',
      company_logo: (settings as any)?.companyLogo || '',
      company_address: (settings as any)?.companyAddress || '',
      employee_name: empFullName,
      employee_id: card.emp.employeeCode || `EMP-${(card.emp as any).legacySourceId ?? card.emp.id.slice(0, 5)}`,
      employee_email: card.emp.email,
      month_name: monthName,
      pay_period: `01 ${monthLabel} ${selectedYear} - ${card.totalDaysInMonth} ${monthLabel} ${selectedYear}`,
      pay_date: new Date().toLocaleDateString('en-IN'),
      shift_name: card.shiftName || 'Full Day Shift',
      shift_time: card.shiftStartTime && card.shiftEndTime ? `${card.shiftStartTime} - ${card.shiftEndTime}` : 'Regular',
      payment_status: card.status === 'PAID' ? 'Paid' : 'Pending',
      monthly_salary: Number(card.monthlySalary).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      total_days: String(card.totalDaysInMonth),
      per_day_salary: Number(card.perDaySalary).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      per_hour_salary: Number(card.hourRate).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      basic_salary: Number(card.basicSalary).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      working_days: String(card.totalWorkingDays),
      sunday_holiday_pay: Number(card.sundayHolidayPay).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      present_days: String(card.presentRegularDays),
      overtime_pay: Number(card.overtimePayout).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      overtime_hours: String(card.overtimeHours),
      commission: Number(card.commission).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      total_hours_worked: String(card.totalHours),
      advance_deducted: Number(card.advance).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      expected_hours: String(card.expectedHours),
      net_salary: Number(card.thisMonthNet).toLocaleString('en-IN'),
      paid_on: card.status === 'PAID' ? new Date().toLocaleString('en-IN') : 'Pending',
      remarks: card.remarks || '',
    };

    setSendingEmailEmpId(card.emp.id);
    try {
      const res = await salaryApi.sendCustomSlip(payload);
      alert(res.message || `Salary slip for ${monthName} successfully emailed to ${card.emp.email}!`);
    } catch (err: any) {
      alert(`Failed to send email: ${err?.message || 'Please verify your SMTP settings in Settings > SMTP Settings.'}`);
    } finally {
      setSendingEmailEmpId(null);
    }
  };

  // Handle PDF Download (Exact 1:1 Legacy Slip)
  const handleDownloadPdf = async (card: (typeof calculatedCards)[0]) => {
    const monthLabel = MONTHS.find(m => m.value === selectedMonth)?.label || 'Month';
    const monthName = `${monthLabel} ${selectedYear}`;
    const empFullName = [card.emp.firstName, card.emp.lastName].filter(Boolean).join(' ');

    const payload = {
      company_name: settings?.companyName || 'BMAP Pvt Ltd',
      company_logo: (settings as any)?.companyLogo || '',
      company_address: (settings as any)?.companyAddress || '',
      employee_name: empFullName,
      employee_id: card.emp.employeeCode || `EMP-${(card.emp as any).legacySourceId ?? card.emp.id.slice(0, 5)}`,
      employee_email: card.emp.email || '',
      month_name: monthName,
      pay_period: `${monthLabel} ${selectedYear}`,
      pay_date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      shift_name: card.shiftName || 'Full Day',
      shift_time: card.shiftStartTime && card.shiftEndTime ? `${card.shiftStartTime} - ${card.shiftEndTime}` : '09:00 - 19:30',
      payment_status: card.status === 'PAID' ? 'Paid' : 'Pending',
      monthly_salary: Number(card.monthlySalary).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      total_days: String(card.totalDaysInMonth),
      per_day_salary: Number(card.perDaySalary).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      per_hour_salary: Number(card.hourRate).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      basic_salary: Number(card.basicSalary).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      working_days: String(card.totalWorkingDays),
      sunday_holiday_pay: Number(card.sundayHolidayPay).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      present_days: String(card.presentRegularDays),
      overtime_pay: Number(card.overtimePayout).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      overtime_hours: String(card.overtimeHours),
      commission: Number(card.commission).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      total_hours_worked: String(card.totalHours),
      advance_deducted: Number(card.advance).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      expected_hours: String(card.expectedHours),
      net_salary: Number(card.thisMonthNet).toLocaleString('en-IN'),
      paid_on: card.status === 'PAID' ? new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Pending',
      remarks: card.remarks || '',
    };

    setDownloadingEmpId(card.emp.id);
    try {
      const res = await salaryApi.downloadCustomSlipPdf(payload);
      if (!res?.base64) throw new Error('No PDF data received from server');

      const byteCharacters = atob(res.base64);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([byteNumbers], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeEmp = empFullName.replace(/[^A-Za-z0-9_\-]/g, '_');
      a.download = res.filename || `Salary_Slip_${safeEmp}_${selectedYear}-${selectedMonth}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(`Download failed: ${err?.message || 'Error downloading PDF'}`);
    } finally {
      setDownloadingEmpId(null);
    }
  };

  // Handle Bulk Actions
  const handleBulkSave = () => {
    const targets = calculatedCards.filter(c => selectedIds.includes(c.emp.id));
    if (targets.length === 0) {
      alert('Please select at least one employee checkbox for bulk save.');
      return;
    }
    saveMutation.mutate(targets);
  };

  const handleBulkPaid = () => {
    const targets = calculatedCards.filter(c => selectedIds.includes(c.emp.id));
    if (targets.length === 0) {
      alert('Please select at least one employee checkbox.');
      return;
    }
    statusMutation.mutate({ targets, newStatus: 'PAID' });
  };

  const handleBulkPending = () => {
    const targets = calculatedCards.filter(c => selectedIds.includes(c.emp.id));
    if (targets.length === 0) {
      alert('Please select at least one employee checkbox.');
      return;
    }
    statusMutation.mutate({ targets, newStatus: 'PENDING' });
  };

  return (
    <div className="space-y-6 pb-16">
      {/* 1. Top Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Due (All)</div>
            <div className="text-2xl font-bold font-mono text-slate-900 mt-1">₹ {totalDueSum.toLocaleString('en-IN')}</div>
          </CardContent>
        </Card>

        <Card className="bg-emerald-50/50 border-emerald-200/80 shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">Paid (Selected Month)</div>
            <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">₹ {paidSum.toLocaleString('en-IN')}</div>
          </CardContent>
        </Card>

        <Card className="bg-amber-50/50 border-amber-200/80 shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-700">Unpaid</div>
            <div className="text-2xl font-bold font-mono text-amber-700 mt-1">₹ {unpaidSum.toLocaleString('en-IN')}</div>
          </CardContent>
        </Card>

        <Card className="bg-indigo-50/50 border-indigo-200/80 shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-indigo-700">Selected Total</div>
            <div className="text-2xl font-bold font-mono text-indigo-700 mt-1">₹ {selectedTotal.toLocaleString('en-IN')}</div>
          </CardContent>
        </Card>
      </div>

      {/* 2. Filters Bar */}
      <Card className="bg-white border-slate-200 shadow-sm">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <Select 
            value={selectedYear} 
            onChange={(e) => setSelectedYear(e.target.value)} 
            className="w-28 font-medium"
          >
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>

          <Select 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value)} 
            className="w-36 font-medium"
          >
            {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>

          <div className="w-64 font-medium z-50">
            <SearchableEmployeeSelect
              options={employeeOptions}
              value={filterEmployeeId}
              onChange={(val) => setFilterEmployeeId(val)}
            />
          </div>

          <Select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)} 
            className="w-32 font-medium"
          >
            <option value="all">All Status</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
          </Select>
        </CardContent>
      </Card>

      {/* 3. Bulk Buttons & Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Button 
          onClick={handleBulkSave}
          disabled={saveMutation.isPending}
          className="bg-sky-500 hover:bg-sky-600 text-white font-bold px-6 shadow-sm"
        >
          Bulk Save
        </Button>

        <Button 
          onClick={handleBulkPaid}
          disabled={statusMutation.isPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 shadow-sm"
        >
          Bulk Paid
        </Button>

        <Button 
          onClick={handleBulkPending}
          disabled={statusMutation.isPending}
          className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-6 shadow-sm"
        >
          Bulk Pending
        </Button>

        <Button 
          variant="outline"
          onClick={handleSelectAll}
          className="font-bold border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Select All
        </Button>

        <Button 
          variant="outline"
          onClick={handleClearSelection}
          className="font-bold border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Clear
        </Button>

        <Button 
          onClick={() => setIsReportModalOpen(true)}
          className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold px-5 shadow-sm ml-auto gap-2"
        >
          <FileText size={16} /> Download Report
        </Button>
      </div>

      {/* 4. Employee Cards 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredCards.map(card => (
          <Card key={card.emp.id} className="bg-white border-slate-200 shadow-md hover:shadow-lg transition-shadow flex flex-col overflow-hidden">
            <CardContent className="p-5 flex flex-col flex-1 space-y-4">
              {/* Header */}
              <div className="flex flex-wrap justify-between items-start gap-2 border-b pb-3">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 tracking-tight">
                    {card.emp.firstName} {card.emp.lastName}
                  </h3>
                  <div className="text-xs text-slate-500 font-semibold uppercase mt-0.5">
                    {card.emp.department?.name || 'General'} | {card.shiftName} ({fmt12h(card.shiftStartTime)} - {fmt12h(card.shiftEndTime)})
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button 
                    size="sm" 
                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold h-8 px-3 text-xs"
                    onClick={() => navigate(`/admin/attendance?employee_id=${card.emp.id}&month=${selectedMonth}&year=${selectedYear}`)}
                  >
                    View
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleToggleSundaySalary(card.emp.id)}
                    className={`h-8 px-2.5 text-xs font-bold gap-1 border-2 ${
                      card.excludeSundayHoliday 
                        ? 'border-red-500 bg-red-50 text-red-700 hover:bg-red-100' 
                        : 'border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    {card.excludeSundayHoliday ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                    {card.excludeSundayHoliday ? 'Exclude' : 'Include'}
                  </Button>

                  <label className="flex items-center gap-1.5 cursor-pointer ml-1 select-none">
                    <span className="text-xs font-semibold text-slate-600">Select</span>
                    <input 
                      type="checkbox"
                      checked={selectedIds.includes(card.emp.id)}
                      onChange={() => handleToggleSelect(card.emp.id)}
                      className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              {/* 15 Metrics Grid */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                {/* Row 1 */}
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Monthly Salary</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">₹ {card.monthlySalary.toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Rate / Hr</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">₹ {card.hourRate}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Hours (Tot / Exp)</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">{card.totalHours} / {card.expectedHours}</div>
                </div>

                {/* Row 2 */}
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Salary Per Day</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">₹ {card.perDaySalary}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Total Days in Month</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">{card.totalDaysInMonth}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Basic Salary</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">₹ {card.basicSalary.toLocaleString('en-IN')}</div>
                </div>

                {/* Row 3 */}
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Total Working Days</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">{card.totalWorkingDays}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Sunday & Holiday Pay</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">₹ {card.sundayHolidayPay.toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Mon-Sat Present Days</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">{card.presentRegularDays}</div>
                </div>

                {/* Row 4 */}
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Overtime Payout</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">₹ {card.overtimePayout}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Commission/Pending</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">₹ {card.commission.toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-red-50/50 p-2.5 rounded-lg border border-red-100">
                  <div className="text-[10px] uppercase font-bold text-red-600">Advance Deducted</div>
                  <div className="text-sm font-bold font-mono text-red-600 mt-0.5">- ₹ {card.advance.toLocaleString('en-IN')}</div>
                </div>

                {/* Row 5 */}
                <div className="bg-amber-50/50 p-2.5 rounded-lg border border-amber-100">
                  <div className="text-[10px] uppercase font-bold text-amber-700">Last Month Pending</div>
                  <div className="text-sm font-bold font-mono text-amber-700 mt-0.5">₹ {card.lastPending}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="text-[10px] uppercase font-bold text-slate-500">This Month</div>
                  <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">₹ {card.thisMonthNet.toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-sky-50 p-2.5 rounded-lg border border-sky-100">
                  <div className="text-[10px] uppercase font-bold text-sky-700">Due (incl. carry)</div>
                  <div className={`text-sm font-bold font-mono mt-0.5 ${card.status === 'PAID' ? 'text-emerald-600 line-through' : 'text-sky-700'}`}>
                    ₹ {card.totalWithPending.toLocaleString('en-IN')}
                  </div>
                </div>
              </div>

              {/* Inputs */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Commission</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={card.commission || ''}
                    onChange={(e) => handleCardInputChange(card.emp.id, 'commission', parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm font-mono font-medium outline-none focus:border-sky-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Advance</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={card.advance || ''}
                    onChange={(e) => handleCardInputChange(card.emp.id, 'advance', parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm font-mono font-medium outline-none focus:border-sky-500"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Remarks</label>
                <input 
                  type="text"
                  value={card.remarks || ''}
                  onChange={(e) => handleCardInputChange(card.emp.id, 'remarks', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-sky-500"
                  placeholder="Add remarks..."
                />
              </div>

              {/* Card Bottom Action Buttons */}
              <div className="flex flex-wrap gap-2 pt-2 mt-auto border-t">
                <Button 
                  size="sm"
                  onClick={() => handleSaveSingle(card)}
                  className="flex-1 min-w-[70px] bg-sky-500 hover:bg-sky-600 text-white font-bold h-9 shadow-sm"
                >
                  Save
                </Button>

                {card.status === 'PAID' ? (
                  <Button 
                    size="sm"
                    onClick={() => handleMarkPendingSingle(card)}
                    className="flex-1 min-w-[100px] bg-amber-600 hover:bg-amber-700 text-white font-bold h-9 shadow-sm"
                  >
                    Mark Pending
                  </Button>
                ) : (
                  <Button 
                    size="sm"
                    onClick={() => handleMarkPaidSingle(card)}
                    className="flex-1 min-w-[100px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-9 shadow-sm"
                  >
                    Mark Paid
                  </Button>
                )}

                <Button 
                  size="sm"
                  disabled={downloadingEmpId === card.emp.id}
                  onClick={() => handleDownloadPdf(card)}
                  className="flex-1 min-w-[85px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-9 shadow-sm gap-1.5"
                >
                  {downloadingEmpId === card.emp.id ? (
                    <>
                      <Loader2 size={13} className="animate-spin" /> PDF...
                    </>
                  ) : (
                    <>
                      <Download size={13} /> PDF Slip
                    </>
                  )}
                </Button>

                <Button 
                  size="sm"
                  onClick={() => setSlipModalTarget(card)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold h-9 px-2.5 shadow-sm"
                  title="Preview Slip Layout"
                >
                  👁️
                </Button>

                <Button 
                  size="sm"
                  disabled={sendingEmailEmpId === card.emp.id}
                  onClick={() => handleSendMail(card)}
                  className="flex-1 min-w-[85px] bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold h-9 shadow-sm gap-1.5"
                >
                  {sendingEmailEmpId === card.emp.id ? (
                    <>
                      <Loader2 size={13} className="animate-spin" /> Sending...
                    </>
                  ) : (
                    <>
                      <Mail size={13} /> Send Mail
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredCards.length === 0 && !isEmployeesLoading && (
        <div className="p-16 text-center text-slate-400 font-medium bg-white rounded-xl border border-slate-200">
          No employees found matching criteria.
        </div>
      )}

      {/* 5. Salary Slip Preview Modal (1:1 Legacy Exact Replica) */}
      {slipModalTarget && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md transition-opacity" onClick={() => setSlipModalTarget(null)} />
          <div className="relative z-10 bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex justify-between items-center px-6 py-4 border-b bg-slate-50 shrink-0">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                📄 <span>Salary Slip Document Preview</span>
              </h3>
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  onClick={() => handleDownloadPdf(slipModalTarget)} 
                  className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                  disabled={downloadingEmpId === slipModalTarget.emp.id}
                >
                  {downloadingEmpId === slipModalTarget.emp.id ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Download size={15} />
                  )}
                  <span>Download Official PDF</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSlipModalTarget(null)}>
                  ✕
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-slate-100 flex justify-center items-start">
              {/* 1:1 Exact Legacy Preview Card Matching AttenOld */}
              <div className="bg-white max-w-[650px] w-full rounded-2xl p-6 sm:p-8 shadow-md border border-slate-200 font-sans text-sm mb-6">
                <div className="text-center pb-2">
                  <img
                    src={(settings as any)?.companyLogo || defaultCompanyLogo}
                    alt="Company Logo"
                    className="max-h-[85px] max-w-[340px] mx-auto mb-2 object-contain rounded-lg border-2 border-[#dbe7f6] shadow-sm bg-[#f7fafc] p-1"
                  />
                  <div className="font-bold text-xl text-[#1968a7] tracking-wide">
                    {settings?.companyName || 'BMAP Pvt Ltd'}
                  </div>
                  <div className="text-[11px] text-[#757a8a] max-w-md mx-auto mt-0.5 leading-snug">
                    {(settings as any)?.companyAddress || '206 Sunrise Commercial Complex - Near, Savjibhai Korat Bridge, Lajamani chowk, Shanti Niketan Society, Mota Varachha, Surat, Gujarat 394105 • bookmyassignments.com'}
                  </div>
                </div>

                <div className="mt-4 text-center text-lg font-bold text-[#2e415a]">
                  Salary Slip
                </div>

                <table className="w-[88%] mx-auto mt-4 text-[13px] border-collapse">
                  <tbody>
                    <tr>
                      <td className="py-1 px-1.5 text-slate-600 w-1/4"><b>Pay Period:</b></td>
                      <td className="py-1 px-1.5 text-slate-900 w-1/4">{MONTHS.find(m => m.value === selectedMonth)?.label} {selectedYear}</td>
                      <td className="py-1 px-1.5 text-slate-600 w-1/4"><b>Pay Date:</b></td>
                      <td className="py-1 px-1.5 text-slate-900 w-1/4">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    </tr>
                    <tr>
                      <td className="py-1 px-1.5 text-slate-600"><b>Employee Name:</b></td>
                      <td className="py-1 px-1.5 text-slate-900 font-semibold">{slipModalTarget.emp.firstName} {slipModalTarget.emp.lastName}</td>
                      <td className="py-1 px-1.5 text-slate-600"><b>Employee ID:</b></td>
                      <td className="py-1 px-1.5 text-slate-900">{slipModalTarget.emp.employeeCode || slipModalTarget.emp.id.slice(0, 5)}</td>
                    </tr>
                    <tr>
                      <td className="py-1 px-1.5 text-slate-600"><b>Shift:</b></td>
                      <td className="py-1 px-1.5 text-slate-900">{slipModalTarget.shiftName} ({slipModalTarget.shiftStartTime} - {slipModalTarget.shiftEndTime})</td>
                      <td className="py-1 px-1.5 text-slate-600"><b>Status:</b></td>
                      <td className="py-1 px-1.5">
                        <span className={`font-bold ${slipModalTarget.status === 'PAID' ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {slipModalTarget.status === 'PAID' ? 'Paid' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <table className="w-[92%] mx-auto mt-4 text-[13px] border-collapse">
                  <thead>
                    <tr className="bg-[#e9f4fb]">
                      <th colSpan={2} className="py-2 px-2 text-left font-bold text-[#1563ac] rounded-tl-lg">Earnings</th>
                      <th colSpan={2} className="py-2 px-2 text-left font-bold text-[#d67412] rounded-tr-lg">Attendance & Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-[#f7fafc]">
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Monthly Salary</td>
                      <td className="py-1.5 px-2 font-bold text-slate-900 border-b border-slate-100">₹ {slipModalTarget.monthlySalary.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Total Days in Month</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipModalTarget.totalDaysInMonth}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Salary Per Day</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipModalTarget.perDaySalary.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Salary Per Hour</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipModalTarget.hourRate.toFixed(2)}</td>
                    </tr>
                    <tr className="bg-[#f7fafc]">
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Basic Salary</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipModalTarget.basicSalary.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Total Working Days</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipModalTarget.totalWorkingDays}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Sunday & Holiday Pay</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipModalTarget.sundayHolidayPay.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Mon-Sat Present Days</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipModalTarget.presentRegularDays}</td>
                    </tr>
                    <tr className="bg-[#f7fafc]">
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Overtime Payout</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipModalTarget.overtimePayout.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Overtime Hours</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipModalTarget.overtimeHours}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Commission / Extra</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipModalTarget.commission.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Total Hours Worked</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipModalTarget.totalHours}</td>
                    </tr>
                    <tr className="bg-[#f7fafc]">
                      <td className="py-1.5 px-2 text-red-600 font-semibold border-b border-slate-100">Advance Deducted</td>
                      <td className="py-1.5 px-2 text-red-600 font-bold border-b border-slate-100">- ₹ {slipModalTarget.advance.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Expected Hours</td>
                      <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipModalTarget.expectedHours}</td>
                    </tr>
                    <tr className="bg-[#d8f0e8]">
                      <td className="py-2.5 px-2 font-bold text-[#217f44] text-sm rounded-bl-lg">Net Salary</td>
                      <td className="py-2.5 px-2 font-bold text-[#217f44] text-sm">₹ {slipModalTarget.thisMonthNet.toLocaleString('en-IN')} /-</td>
                      <td colSpan={2} className="py-2.5 px-2 text-right text-xs text-[#217f44] font-semibold rounded-br-lg">All amounts in INR</td>
                    </tr>
                  </tbody>
                </table>

                <div className="w-[92%] mx-auto mt-4 text-[12px] space-y-1 text-slate-600">
                  <div className="flex justify-between">
                    <div><b>Payment Status:</b> <span className={slipModalTarget.status === 'PAID' ? 'text-emerald-600 font-bold' : 'text-amber-600 font-bold'}>{slipModalTarget.status === 'PAID' ? 'Paid' : 'Pending'}</span></div>
                    <div><b>Paid On:</b> {slipModalTarget.status === 'PAID' ? new Date().toLocaleString('en-IN') : 'Pending'}</div>
                  </div>
                  {slipModalTarget.remarks && (
                    <div><b>Remarks:</b> <span className="text-slate-800">{slipModalTarget.remarks}</span></div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 6. Consolidated Report Modal */}
      {isReportModalOpen && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md transition-opacity" onClick={() => setIsReportModalOpen(false)} />
          <div className="relative z-10 bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="font-bold text-lg text-slate-800">
                Salary Report - {MONTHS.find(m => m.value === selectedMonth)?.label} {selectedYear}
              </h3>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => window.print()} className="gap-1.5 bg-fuchsia-600 hover:bg-fuchsia-700 text-white">
                  <Printer size={15} /> Print / Save PDF
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsReportModalOpen(false)}>
                  ✕
                </Button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto">
              <table className="w-full text-xs border-collapse border border-slate-200">
                <thead>
                  <tr className="bg-slate-100 text-slate-700">
                    <th className="border p-2 text-left">Employee Name</th>
                    <th className="border p-2 text-right">Monthly Salary (₹)</th>
                    <th className="border p-2 text-right">Worked Hours</th>
                    <th className="border p-2 text-right">This Month Net (₹)</th>
                    <th className="border p-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {calculatedCards.map(c => (
                    <tr key={c.emp.id} className="hover:bg-slate-50">
                      <td className="border p-2 font-medium">{c.emp.firstName} {c.emp.lastName}</td>
                      <td className="border p-2 text-right font-mono">{c.monthlySalary.toLocaleString('en-IN')}</td>
                      <td className="border p-2 text-right font-mono">{c.totalHours}</td>
                      <td className="border p-2 text-right font-mono font-bold text-slate-900">{c.thisMonthNet.toLocaleString('en-IN')}</td>
                      <td className="border p-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${c.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-bold text-slate-900">
                    <td className="border p-2">TOTAL</td>
                    <td className="border p-2 text-right font-mono">₹ {calculatedCards.reduce((s, c) => s + c.monthlySalary, 0).toLocaleString('en-IN')}</td>
                    <td className="border p-2 text-right font-mono">{calculatedCards.reduce((s, c) => s + c.totalHours, 0).toFixed(1)}</td>
                    <td className="border p-2 text-right font-mono">₹ {calculatedCards.reduce((s, c) => s + c.thisMonthNet, 0).toLocaleString('en-IN')}</td>
                    <td className="border p-2"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
