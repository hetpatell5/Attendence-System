import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { salaryApi, employeesApi, holidaysApi, attendanceApi, settingsApi } from '@/lib/api';
import { useAuthStore } from '@/state/auth-store';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Download, CalendarDays, 
  Eye, FileText, X, Loader2 
} from 'lucide-react';
import defaultCompanyLogo from '@/assets/logo.jpeg';
import type { SalaryRecord } from '@attendance/shared';
import { SalaryAnalyticsCharts } from '@/components/SalaryAnalyticsCharts';
import { to12h } from '@/lib/utils';

export function MySalaryPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const [selected, setSelected] = useState<SalaryRecord | null>(null);
  const [downloading, setDownloading] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 60_000,
  });

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;
  const currentMonthStr = `${currentYear}-${String(currentMonthNum).padStart(2, '0')}`;
  const fromDate = `${currentMonthStr}-01`;
  const lastDay = new Date(currentYear, currentMonthNum, 0).getDate();
  const toDate = `${currentMonthStr}-${String(lastDay).padStart(2, '0')}`;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['salary', 'me'],
    queryFn: salaryApi.mine,
  });

  const { data: employee } = useQuery({
    queryKey: ['employee', 'me'],
    queryFn: employeesApi.me,
  });

  const { data: holidaysList = [] } = useQuery<any[]>({
    queryKey: ['holidays', currentYear],
    queryFn: () => holidaysApi.list({ year: String(currentYear) }) as Promise<any[]>,
  });

  const { data: monthAttendance = [] } = useQuery({
    queryKey: ['attendance', 'me', currentMonthStr],
    queryFn: () => attendanceApi.mine(fromDate, toDate),
  });

  // -------------------------------------------------------------------------
  // Live Current Month Calculation (Matching Admin Engine)
  // -------------------------------------------------------------------------
  const currentMonthMetrics = useMemo(() => {
    const monthlySalary = Number(employee?.baseSalary || 0);
    const totalDaysInMonth = lastDay;

    let shiftHours = 10.5; // Match admin engine default (09:00–19:30)
    let shiftName = 'Full Day';
    let shiftStart = '09:00';
    let shiftEnd = '19:30';

    const latestShift = (employee as any)?.employeeShifts?.[0]?.shift;
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
      if (new Date(currentYear, currentMonthNum - 1, d).getDay() === 0) sundaysCount++;
    }

    const thisMonthHolidays = holidaysList.filter((h: any) => {
      if (!h.date) return false;
      const hDate = new Date(h.date);
      return hDate.getFullYear() === currentYear && (hDate.getMonth() + 1) === currentMonthNum && hDate.getDay() !== 0;
    });
    const holidaysCount = thisMonthHolidays.length;

    const daySecondsMap = new Map<string, number>();
    monthAttendance.forEach((log: any) => {
      const dStr = new Date(log.attendanceDate).toLocaleDateString('en-CA');
      let secs = 0;

      // Use punchPairs if present (multi-punch support — same as admin engine)
      const extraPairs = log.punchPairs;
      if (Array.isArray(extraPairs) && extraPairs.length > 0) {
        for (const pair of extraPairs) {
          if (pair?.punchInAt && pair?.punchOutAt) {
            const pairDiff = (new Date(pair.punchOutAt).getTime() - new Date(pair.punchInAt).getTime()) / 1000;
            if (pairDiff > 0) secs += pairDiff;
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
  }, [employee, monthAttendance, holidaysList, currentYear, currentMonthNum, lastDay]);

  const computeSlipMetrics = (record: any, emp: any) => {
    if (!record) return null;

    const mDate = new Date(record.month);
    const year = mDate.getFullYear();
    const monthIdx = mDate.getMonth();
    const totalDaysInMonth = new Date(year, monthIdx + 1, 0).getDate();

    let shiftHours = 10.5;
    const latestShift = (emp as any)?.employeeShifts?.[0]?.shift;
    if (latestShift?.startTime && latestShift?.endTime) {
      const [sh, sm] = latestShift.startTime.split(':').map(Number);
      const [eh, em] = latestShift.endTime.split(':').map(Number);
      let diff = ((eh || 0) * 60 + (em || 0)) - ((sh || 0) * 60 + (sm || 0));
      if (diff <= 0) diff += 24 * 60;
      shiftHours = diff / 60;
    }

    const monthlySalary = Number(
      record.monthlySalary ||
      (Number(record.basicSalary) >= 5000 && !record.workedHours ? record.basicSalary : 0) ||
      emp?.baseSalary ||
      8000
    );

    const perDaySalaryExact = totalDaysInMonth > 0 ? monthlySalary / totalDaysInMonth : 0;
    const hourRateExact = Number(record.hourRate) > 0
      ? Number(record.hourRate)
      : (shiftHours > 0 ? perDaySalaryExact / shiftHours : 0);

    const workedHours = Number(record.workedHours ?? record.totalHours ?? 0);
    const expectedHours = Number(record.expectedHours ?? (record.workingDays ? record.workingDays * shiftHours : 0));

    let presentDays = Number(record.presentDays || 0);
    if (presentDays === 0 && expectedHours > 0 && shiftHours > 0) {
      presentDays = Math.round(expectedHours / shiftHours);
    }

    let basicSalary = Number(record.basicSalary || 0);
    if (basicSalary <= 0 || (workedHours > 0 && Math.abs(basicSalary - monthlySalary) < 0.01)) {
      basicSalary = Number((workedHours * hourRateExact).toFixed(2));
    }

    let sundayHolidayPay = Number(record.sundayHolidayPay || record.totalAllowances || 0);
    if (sundayHolidayPay <= 0) {
      const net = Number(record.netSalary || 0);
      const commission = Number(record.commissionAmount || record.commission || 0);
      const advance = Number(record.advanceDeducted || record.advance || 0);
      if (net > 0 && basicSalary > 0) {
        sundayHolidayPay = Math.max(0, Number((net - basicSalary - commission + advance).toFixed(2)));
      }
    }

    const overtimeHours = Number(record.overtimeHours ?? Math.max(0, workedHours - expectedHours));
    const overtimePayout = Number(record.overtimeAmount ?? (overtimeHours * hourRateExact));
    const commission = Number(record.commissionAmount ?? record.commission ?? 0);
    const advance = Number(record.advanceDeducted ?? record.advance ?? 0);
    const netSalary = Number(record.netSalary || (basicSalary + sundayHolidayPay + overtimePayout + commission - advance));
    const workingDays = Number(record.workingDays) > 0 ? Number(record.workingDays) : 26;

    return {
      monthlySalary,
      totalDaysInMonth,
      perDaySalary: Number(perDaySalaryExact.toFixed(2)),
      hourRate: Number(hourRateExact.toFixed(2)),
      basicSalary: Number(basicSalary.toFixed(2)),
      workingDays,
      sundayHolidayPay: Number(sundayHolidayPay.toFixed(2)),
      presentDays,
      overtimeHours: Number(overtimeHours.toFixed(1)),
      overtimePayout: Number(overtimePayout.toFixed(2)),
      commission,
      workedHours: Number(workedHours.toFixed(2)),
      advance,
      expectedHours: Math.round(expectedHours),
      netSalary: Math.round(netSalary),
    };
  };

  const handleDownloadPdf = async (record: any) => {
    if (!record) return;
    const mDate = new Date(record.month);
    const monthName = mDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const empFullName = employee ? [employee.firstName, employee.lastName].filter(Boolean).join(' ') : (user?.name || 'Employee');
    const latestShift = (employee as any)?.employeeShifts?.[0]?.shift;
    const sm = computeSlipMetrics(record, employee);
    if (!sm) return;

    const isPaid = record.status === 'PAID' || record.status === 'paid';
    const payload = {
      company_name: settings?.companyName || 'BMAP Pvt Ltd',
      company_logo: (settings as any)?.companyLogo || '',
      company_address: (settings as any)?.companyAddress || '',
      employee_name: empFullName,
      employee_id: employee?.employeeCode || 'BMA-1',
      employee_email: employee?.email || '',
      month_name: monthName,
      pay_period: monthName,
      pay_date: isPaid && record.paymentDate
        ? new Date(record.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : monthName,
      shift_name: latestShift?.name || 'Full Day',
      shift_time: latestShift?.startTime && latestShift?.endTime
        ? `${to12h(latestShift.startTime)} - ${to12h(latestShift.endTime)}`
        : '9:00 AM - 7:30 PM',
      payment_status: isPaid ? 'Paid' : 'Pending',
      monthly_salary: sm.monthlySalary.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      total_days: String(sm.totalDaysInMonth),
      per_day_salary: sm.perDaySalary.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      per_hour_salary: sm.hourRate.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      basic_salary: sm.basicSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      working_days: String(sm.workingDays),
      sunday_holiday_pay: sm.sundayHolidayPay.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      present_days: String(sm.presentDays),
      overtime_pay: sm.overtimePayout.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      overtime_hours: String(sm.overtimeHours),
      commission: sm.commission.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      total_hours_worked: String(sm.workedHours),
      advance_deducted: sm.advance.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      expected_hours: String(sm.expectedHours),
      net_salary: sm.netSalary.toLocaleString('en-IN'),
      paid_on: isPaid && record.paymentDate
        ? new Date(record.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : isPaid ? new Date().toLocaleDateString('en-IN') : 'Pending',
      remarks: record.remarks || '',
    };

    setDownloading(true);
    try {
      const res = await (salaryApi as any).downloadCustomSlipPdf(payload);
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
      const safeMonth = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, '0')}`;
      a.download = res.filename || `Salary_Slip_${safeEmp}_${safeMonth}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert(`Download failed: ${err?.message || 'Error downloading PDF'}`);
    } finally {
      setDownloading(false);
    }
  };

  const columns: DataTableColumn<SalaryRecord>[] = [
    { 
      key: 'month', 
      header: 'Period', 
      render: (r) => (
        <div className="flex items-center gap-2 font-medium">
          <CalendarDays size={16} className="text-muted-foreground" />
          <span>{new Date(r.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span>
        </div>
      )
    },
    { 
      key: 'presentDays', 
      header: 'Present Days', 
      render: (r) => <span className="font-medium">{Number(r.presentDays || 0)} Days</span> 
    },
    { 
      key: 'basicSalary', 
      header: 'Basic Pay', 
      render: (r) => {
        const sm = computeSlipMetrics(r, employee);
        const val = sm ? sm.basicSalary : Number(r.basicSalary || 0);
        return <span className="font-medium">₹{val.toLocaleString()}</span>;
      }
    },
    { 
      key: 'sundayHolidayPay', 
      header: 'Sun & Hol Pay', 
      render: (r: any) => {
        const sm = computeSlipMetrics(r, employee);
        const val = sm ? sm.sundayHolidayPay : Number(r.sundayHolidayPay || r.bonusAmount || 0);
        return <span className="font-medium text-purple-600">₹{val.toLocaleString()}</span>;
      }
    },
    { 
      key: 'commission', 
      header: 'Commission', 
      render: (r: any) => {
        const val = Number(r.commissionAmount || 0);
        return val > 0 ? <span className="font-medium text-emerald-600">+₹{val.toLocaleString()}</span> : <span className="text-muted-foreground">--</span>;
      }
    },
    { 
      key: 'advance', 
      header: 'Advance', 
      render: (r: any) => {
        const val = Number(r.advanceDeducted || 0);
        return val > 0 ? <span className="font-medium text-red-600">-₹{val.toLocaleString()}</span> : <span className="text-muted-foreground">--</span>;
      }
    },
    { 
      key: 'netSalary', 
      header: 'Net Pay', 
      render: (r) => <span className="font-bold text-primary text-base">₹{Math.round(Number(r.netSalary || 0)).toLocaleString()}</span>
    },
    { 
      key: 'status', 
      header: 'Status', 
      render: (r) => <StatusBadge status={r.status} /> 
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => { e.stopPropagation(); setSelected(r); }}
          className="h-7 text-xs px-2.5 rounded-lg border-border/70 hover:border-primary/50 text-foreground gap-1.5 font-medium hover:bg-muted/60 transition-colors"
          title="View Salary Slip"
        >
          <Eye size={13} className="text-muted-foreground" />
          <span>View Slip</span>
        </Button>
      )
    }
  ];

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/50">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Salary Analytics & Visual Tracking
          </h2>
        </div>
      </div>



      {/* Visual Analytics Suite: Modern Charts & Graphs */}
      <SalaryAnalyticsCharts
        pastRecords={rows}
        currentMetrics={currentMonthMetrics}
        monthAttendance={monthAttendance}
        holidaysList={holidaysList}
        currentYear={currentYear}
        currentMonthNum={currentMonthNum}
        employee={employee}
      />

      {/* Finalized Salary History */}
      <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden">
        <CardHeader className="p-4 sm:px-6 sm:py-4 border-b border-border/50">
          <CardTitle className="text-base font-bold text-foreground">Salary History & Slips</CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">Past finalized salary records and slips</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(r) => r.id}
            isLoading={isLoading}
            onRowClick={setSelected}
          />
        </CardContent>
      </Card>

      {/* Salary Slip Modal (Exact 1:1 Legacy Slip matching Admin Preview) */}
      {selected && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md transition-opacity" onClick={() => setSelected(null)} />
          <div className="relative z-10 bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex justify-between items-center px-5 py-3.5 border-b border-slate-200 bg-slate-50 shrink-0">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-sm sm:text-base">
                <FileText size={16} className="text-primary" />
                <span>Salary Slip Document Preview</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleDownloadPdf(selected)}
                  className="h-8 gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs rounded-lg shadow-xs"
                  disabled={downloading}
                >
                  {downloading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  <span>Download Official PDF</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)} className="h-8 w-8 p-0 rounded-lg text-slate-500 hover:text-slate-800">
                  <X size={16} />
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-8 bg-gradient-to-b from-slate-50 to-slate-100 flex justify-center items-start">
              {(() => {
                const slipMetrics = computeSlipMetrics(selected, employee);
                if (!slipMetrics) return null;
                const isPaid = (selected.status as string) === 'PAID' || (selected.status as string) === 'paid';
                const mDate = new Date(selected.month);
                const monthLabel = mDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
                const latestShift = (employee as any)?.employeeShifts?.[0]?.shift;
                const shiftTime = latestShift?.startTime && latestShift?.endTime
                  ? `${to12h(latestShift.startTime)} – ${to12h(latestShift.endTime)}`
                  : '9:00 AM – 7:30 PM';
                const shiftName = latestShift?.name || 'Full Day';
                const empFullName = employee ? [employee.firstName, employee.lastName].filter(Boolean).join(' ') : (user?.name || 'Employee');
                const empCode = employee?.employeeCode || 'BMA-1';
                const payDate = isPaid && selected.paymentDate
                  ? new Date(selected.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                  : monthLabel;

                return (
                  <div className="bg-white w-full max-w-[660px] rounded-2xl shadow-xl border border-slate-200 overflow-hidden mb-6 font-sans text-[13px]">
                    {/* Header: solid blue, logo + company on left, SALARY SLIP label on right */}
                    <div className="bg-[#0f4c81] px-6 py-5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <img
                          src={(settings as any)?.companyLogo || defaultCompanyLogo}
                          alt="Logo"
                          className="h-16 w-16 rounded-xl object-contain bg-white p-1.5 shrink-0 shadow-sm"
                        />
                        <div>
                          <div className="text-base font-bold text-white leading-tight">
                            {settings?.companyName || 'BMAP Pvt Ltd'}
                          </div>
                          <div className="text-[10px] text-blue-100 mt-0.5 leading-snug max-w-[280px]">
                            {(settings as any)?.companyAddress || '206 Sunrise Commercial Complex, Mota Varachha, Surat – 394105'}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <div className="text-[11px] font-bold tracking-widest uppercase text-white/80">Salary Slip</div>
                        <div className="text-[11px] font-semibold text-blue-200 mt-0.5">
                          {monthLabel}
                        </div>
                      </div>
                    </div>

                    {/* Employee Info Grid: 2×2 */}
                    <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
                      {[
                        { label: 'EMPLOYEE NAME', value: empFullName },
                        { label: 'EMPLOYEE ID', value: empCode },
                        { label: 'SHIFT', value: `${shiftName} (${shiftTime})` },
                        { label: 'PAY DATE', value: payDate },
                      ].map(({ label, value }) => (
                        <div key={label} className="px-5 py-3 bg-white">
                          <div className="text-[9px] font-semibold tracking-wider text-slate-400">{label}</div>
                          <div className="text-[13px] font-semibold text-slate-800 mt-0.5">{value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Table section headers */}
                    <div className="grid grid-cols-2 border-t border-slate-100">
                      <div className="bg-[#f0f7ff] px-5 py-2 text-[10px] font-bold text-[#1563ac] tracking-wider uppercase">Earnings</div>
                      <div className="bg-[#fff7ed] px-5 py-2 text-[10px] font-bold text-[#c2570a] tracking-wider uppercase border-l border-slate-100">Attendance & Hours</div>
                    </div>

                    {/* Earnings + Attendance rows */}
                    <div className="divide-y divide-slate-50">
                      {([
                        [['Monthly Salary', `₹ ${slipMetrics.monthlySalary.toFixed(2)}`, false, true], ['Total Days in Month', String(slipMetrics.totalDaysInMonth)]],
                        [['Salary Per Day', `₹ ${slipMetrics.perDaySalary.toFixed(2)}`], ['Salary Per Hour', `₹ ${slipMetrics.hourRate.toFixed(2)}`]],
                        [['Basic Salary', `₹ ${slipMetrics.basicSalary.toFixed(2)}`], ['Total Working Days', String(slipMetrics.workingDays)]],
                        [['Sunday & Holiday Pay', `₹ ${slipMetrics.sundayHolidayPay.toFixed(2)}`], ['Mon-Sat Present Days', String(slipMetrics.presentDays)]],
                        [['Overtime Payout', `₹ ${slipMetrics.overtimePayout.toFixed(2)}`], ['Overtime Hours', String(slipMetrics.overtimeHours)]],
                        [['Commission / Extra', `₹ ${slipMetrics.commission.toFixed(2)}`], ['Total Hours Worked', String(slipMetrics.workedHours)]],
                        [['Advance Deducted', `– ₹ ${slipMetrics.advance.toFixed(2)}`, true], ['Expected Hours', String(slipMetrics.expectedHours)]],
                      ] as [string, string, boolean?, boolean?][][]).map((row, i) => {
                        const [lLabel, lVal, isRed, isBold] = row[0] as [string, string, boolean?, boolean?];
                        const [rLabel, rVal] = row[1] as [string, string];
                        return (
                          <div key={i} className={`grid grid-cols-2 divide-x divide-slate-50 ${i % 2 === 0 ? 'bg-slate-50/50' : 'bg-white'}`}>
                            <div className="flex items-center justify-between px-5 py-2">
                              <span className={isRed ? 'text-red-600 font-medium' : 'text-slate-500'}>{lLabel}</span>
                              <span className={`font-semibold tabular-nums ${isRed ? 'text-red-600' : isBold ? 'text-slate-900' : 'text-slate-700'}`}>{lVal}</span>
                            </div>
                            <div className="flex items-center justify-between px-5 py-2">
                              <span className="text-slate-500">{rLabel}</span>
                              <span className="font-semibold text-slate-700 tabular-nums">{rVal}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Net Salary row */}
                    <div className="bg-[#e8f5ee] flex items-center justify-between px-5 py-3 border-t border-emerald-100">
                      <div>
                        <div className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Net Salary</div>
                        <div className="text-xl font-bold text-emerald-700 mt-0.5">₹ {slipMetrics.netSalary.toLocaleString('en-IN')} /-</div>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded ${isPaid ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-700'}`}>
                          {isPaid ? 'Paid' : 'Pending'}
                        </span>
                        {isPaid && selected.paymentDate && (
                          <div className="text-[10px] text-slate-400 mt-1">
                            Paid on {new Date(selected.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </div>
                        )}
                        <div className="text-[10px] text-slate-400 mt-0.5">All amounts in INR</div>
                      </div>
                    </div>

                    {/* Payment footer line */}
                    <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 text-[11px] text-slate-500">
                      <span>
                        <span className="font-semibold text-slate-600">Payment Status: </span>
                        <span className={isPaid ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                          {isPaid ? 'Paid' : 'Pending'}
                        </span>
                      </span>
                      <span>
                        <span className="font-semibold text-slate-600">Paid On: </span>
                        {isPaid && selected.paymentDate
                          ? new Date(selected.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                          : 'Pending'}
                      </span>
                    </div>

                    {selected.remarks && (
                      <div className="px-5 pb-3 text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-600">Remarks: </span>{selected.remarks}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 text-center text-[10px] text-slate-400">
                      This is a computer-generated salary slip and does not require a signature.
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
