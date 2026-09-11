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

    const payload = {
      company_name: settings?.companyName || 'BMAP Pvt Ltd',
      company_logo: (settings as any)?.companyLogo || '',
      company_address: (settings as any)?.companyAddress || '',
      employee_name: empFullName,
      employee_id: employee?.employeeCode || `EMP-${(employee as any)?.legacySourceId ?? employee?.id.slice(0, 5) ?? '001'}`,
      employee_email: employee?.email || '',
      month_name: monthName,
      pay_period: monthName,
      pay_date: record.paymentDate ? new Date(record.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      shift_name: latestShift?.name || 'Full Day',
      shift_time: latestShift?.startTime && latestShift?.endTime ? `${latestShift.startTime} - ${latestShift.endTime}` : '09:00 - 19:30',
      payment_status: record.status === 'PAID' || record.status === 'paid' ? 'Paid' : 'Pending',
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
      paid_on: record.paymentDate ? new Date(record.paymentDate).toLocaleString('en-IN') : 'Pending',
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
      render: (r) => <span className="font-bold text-primary text-base">₹{Number(r.netSalary || 0).toLocaleString()}</span> 
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
                <span>Salary Slip Preview</span>
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
                  <span>Download PDF</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)} className="h-8 w-8 p-0 rounded-lg text-slate-500 hover:text-slate-800">
                  <X size={16} />
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
                      <td className="py-1 px-1.5 text-slate-900 w-1/4">
                        {new Date(selected.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                      </td>
                      <td className="py-1 px-1.5 text-slate-600 w-1/4"><b>Pay Date:</b></td>
                      <td className="py-1 px-1.5 text-slate-900 w-1/4">
                        {selected.paymentDate ? new Date(selected.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 px-1.5 text-slate-600"><b>Employee Name:</b></td>
                      <td className="py-1 px-1.5 text-slate-900 font-semibold">{employee ? `${employee.firstName} ${employee.lastName}` : user?.name}</td>
                      <td className="py-1 px-1.5 text-slate-600"><b>Employee ID:</b></td>
                      <td className="py-1 px-1.5 text-slate-900">{employee?.employeeCode || `EMP-${(employee as any)?.legacySourceId ?? employee?.id.slice(0, 5) ?? '001'}`}</td>
                    </tr>
                    <tr>
                      <td className="py-1 px-1.5 text-slate-600"><b>Shift:</b></td>
                      <td className="py-1 px-1.5 text-slate-900">
                        {(employee as any)?.employeeShifts?.[0]?.shift?.name || 'Full Day'} ({(employee as any)?.employeeShifts?.[0]?.shift?.startTime || '09:00'} - {(employee as any)?.employeeShifts?.[0]?.shift?.endTime || '19:30'})
                      </td>
                      <td className="py-1 px-1.5 text-slate-600"><b>Status:</b></td>
                      <td className="py-1 px-1.5">
                        <span className={`font-bold ${selected.status === 'PAID' ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {selected.status === 'PAID' ? 'Paid' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {(() => {
                  const slipMetrics = computeSlipMetrics(selected, employee);
                  if (!slipMetrics) return null;

                  return (
                    <>
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
                            <td className="py-1.5 px-2 font-bold text-slate-900 border-b border-slate-100">₹ {slipMetrics.monthlySalary.toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Total Days in Month</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipMetrics.totalDaysInMonth}</td>
                          </tr>
                          <tr>
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Salary Per Day</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipMetrics.perDaySalary.toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Salary Per Hour</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipMetrics.hourRate.toFixed(2)}</td>
                          </tr>
                          <tr className="bg-[#f7fafc]">
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Basic Salary</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipMetrics.basicSalary.toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Total Working Days</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipMetrics.workingDays}</td>
                          </tr>
                          <tr>
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Sunday & Holiday Pay</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipMetrics.sundayHolidayPay.toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Mon-Sat Present Days</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipMetrics.presentDays}</td>
                          </tr>
                          <tr className="bg-[#f7fafc]">
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Overtime Payout</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipMetrics.overtimePayout.toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Overtime Hours</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipMetrics.overtimeHours}</td>
                          </tr>
                          <tr>
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Commission / Extra</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">₹ {slipMetrics.commission.toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Total Hours Worked</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipMetrics.workedHours}</td>
                          </tr>
                          <tr className="bg-[#f7fafc]">
                            <td className="py-1.5 px-2 text-red-600 font-semibold border-b border-slate-100">Advance Deducted</td>
                            <td className="py-1.5 px-2 text-red-600 font-bold border-b border-slate-100">- ₹ {slipMetrics.advance.toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-slate-600 border-b border-slate-100">Expected Hours</td>
                            <td className="py-1.5 px-2 text-slate-900 border-b border-slate-100">{slipMetrics.expectedHours}</td>
                          </tr>
                          <tr className="bg-[#d8f0e8]">
                            <td className="py-2.5 px-2 font-bold text-[#217f44] text-sm rounded-bl-lg">Net Salary</td>
                            <td className="py-2.5 px-2 font-bold text-[#217f44] text-sm">₹ {slipMetrics.netSalary.toLocaleString('en-IN')} /-</td>
                            <td colSpan={2} className="py-2.5 px-2 text-right text-xs text-[#217f44] font-semibold rounded-br-lg">All amounts in INR</td>
                          </tr>
                        </tbody>
                      </table>

                      <div className="w-[92%] mx-auto mt-4 text-[12px] space-y-1 text-slate-600">
                        <div className="flex justify-between">
                          <div><b>Payment Status:</b> <span className={selected.status === 'PAID' ? 'text-emerald-600 font-bold' : 'text-amber-600 font-bold'}>{selected.status === 'PAID' ? 'Paid' : 'Pending'}</span></div>
                          <div><b>Paid On:</b> {selected.paymentDate ? new Date(selected.paymentDate).toLocaleString('en-IN') : 'Pending'}</div>
                        </div>
                        {selected.remarks && (
                          <div><b>Remarks:</b> <span className="text-slate-800">{selected.remarks}</span></div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
