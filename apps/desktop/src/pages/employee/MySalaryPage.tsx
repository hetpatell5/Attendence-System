import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { salaryApi, employeesApi, holidaysApi, attendanceApi } from '@/lib/api';
import { useAuthStore } from '@/state/auth-store';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Download, FileText, Banknote, CalendarDays, 
  Sparkles 
} from 'lucide-react';
import type { SalaryRecord } from '@attendance/shared';

export function MySalaryPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const [selected, setSelected] = useState<SalaryRecord | null>(null);

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

    let shiftHours = 9.0;
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
      if (log.punchInAt && log.punchOutAt) {
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

  const columns: DataTableColumn<SalaryRecord>[] = [
    { 
      key: 'month', 
      header: 'Month', 
      render: (r) => (
        <div className="flex items-center gap-2">
          <CalendarDays size={16} className="text-muted-foreground" />
          <span className="font-semibold text-foreground">
            {new Date(r.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </span>
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
      render: (r) => <span className="font-medium">₹{Number(r.basicSalary || 0).toLocaleString()}</span> 
    },
    { 
      key: 'sundayHolidayPay', 
      header: 'Sun & Hol Pay', 
      render: (r: any) => {
        const val = Number(r.sundayHolidayPay || r.bonusAmount || 0);
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
        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setSelected(r); }} className="gap-1.5 text-xs">
          <FileText size={14} /> View Slip
        </Button>
      )
    }
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">My Salary</h2>
          <p className="text-sm text-muted-foreground mt-1">
            View your current month running salary estimate and past finalized salary slips.
          </p>
        </div>
      </div>

      {/* Current Month Live Estimate Card */}
      <Card className="border-primary/25 shadow-sm overflow-hidden bg-gradient-to-br from-card via-card to-primary/5">
        <div className="bg-primary/10 px-6 py-4 border-b border-primary/15 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/20 flex items-center justify-center text-primary">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">
                {now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} — Running Salary Estimate
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calculated live till today based on actual attendance, overtime & verified Sunday/Holiday pay rules
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right bg-background/80 sm:bg-transparent px-3 py-1.5 sm:p-0 rounded-lg border sm:border-0 border-border/60">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Estimated Month Net</span>
            <div className="text-2xl font-black text-primary">
              ₹{currentMonthMetrics.estimatedNetPay.toLocaleString()}
            </div>
          </div>
        </div>

        <CardContent className="p-6 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3.5">
            <div className="p-3 rounded-xl bg-secondary/15 border border-secondary/30">
              <p className="text-[11px] text-muted-foreground font-medium uppercase">Monthly Base</p>
              <p className="text-base font-bold text-foreground mt-1">₹{currentMonthMetrics.monthlySalary.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground">₹{currentMonthMetrics.perDaySalary}/day</p>
            </div>
            <div className="p-3 rounded-xl bg-secondary/15 border border-secondary/30">
              <p className="text-[11px] text-muted-foreground font-medium uppercase">Shift Timing</p>
              <p className="text-sm font-bold text-foreground mt-1">{currentMonthMetrics.shiftStart} - {currentMonthMetrics.shiftEnd}</p>
              <p className="text-[11px] text-muted-foreground">{currentMonthMetrics.shiftHours} hrs/shift</p>
            </div>
            <div className="p-3 rounded-xl bg-secondary/15 border border-secondary/30">
              <p className="text-[11px] text-muted-foreground font-medium uppercase">Present Days</p>
              <p className="text-base font-bold text-emerald-600 mt-1">{currentMonthMetrics.presentRegularDays} Days</p>
              <p className="text-[11px] text-muted-foreground">Mon - Sat</p>
            </div>
            <div className="p-3 rounded-xl bg-secondary/15 border border-secondary/30">
              <p className="text-[11px] text-muted-foreground font-medium uppercase">Hours Worked</p>
              <p className="text-base font-bold text-primary mt-1">{currentMonthMetrics.totalHours} hrs</p>
              <p className="text-[11px] text-muted-foreground">Rate: ₹{currentMonthMetrics.hourRate}/hr</p>
            </div>
            <div className="p-3 rounded-xl bg-secondary/15 border border-secondary/30">
              <p className="text-[11px] text-muted-foreground font-medium uppercase">Paid Off-Days</p>
              <p className="text-base font-bold text-purple-600 mt-1">{currentMonthMetrics.totalPaidOffDays} Days</p>
              <p className="text-[11px] text-muted-foreground">Sun: {currentMonthMetrics.paidSundays} | Hol: {currentMonthMetrics.paidHolidays}</p>
            </div>
            <div className="p-3 rounded-xl bg-secondary/15 border border-secondary/30">
              <p className="text-[11px] text-muted-foreground font-medium uppercase">Sun & Hol Pay</p>
              <p className="text-base font-bold text-purple-600 mt-1">₹{currentMonthMetrics.sundayHolidayPay.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground">{currentMonthMetrics.totalPaidOffDays} × ₹{currentMonthMetrics.perDaySalary}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-muted/40 border border-border/60 text-xs space-y-2">
            <div className="flex justify-between items-center text-muted-foreground font-medium">
              <span>Basic Hourly Payout ({currentMonthMetrics.totalHours} hrs × ₹{currentMonthMetrics.hourRate})</span>
              <span className="font-semibold text-foreground">₹{currentMonthMetrics.basicSalary.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground font-medium">
              <span>Sunday & Holiday Allowance ({currentMonthMetrics.totalPaidOffDays} days × ₹{currentMonthMetrics.perDaySalary})</span>
              <span className="font-semibold text-foreground">₹{currentMonthMetrics.sundayHolidayPay.toLocaleString()}</span>
            </div>
            {currentMonthMetrics.overtimeHours > 0 && (
              <div className="flex justify-between items-center text-muted-foreground font-medium">
                <span>Overtime ({currentMonthMetrics.overtimeHours} hrs beyond expected)</span>
                <span className="font-semibold text-emerald-600">Included in basic</span>
              </div>
            )}
            <div className="pt-2 border-t border-border flex justify-between items-center font-bold text-sm text-foreground">
              <span>Current Estimated Net Total</span>
              <span className="text-primary text-base">₹{currentMonthMetrics.estimatedNetPay.toLocaleString()}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Finalized Salary History */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-lg">Salary History & Slips</CardTitle>
          <CardDescription>Records of past monthly salaries generated and finalized by administration</CardDescription>
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

      {/* Salary Slip Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-[620px] p-0 overflow-hidden">
          {selected ? (
            <>
              {/* Slip Header */}
              <div className="bg-primary/10 p-6 border-b border-primary/20">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <Banknote size={24} className="text-primary" />
                      <h3 className="text-xl font-bold text-foreground">Salary Pay Slip</h3>
                    </div>
                    <p className="text-sm font-semibold text-primary mt-1">
                      {new Date(selected.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                  <StatusBadge status={selected.status} />
                </div>
              </div>
              
              {/* Slip Details Body */}
              <div className="p-6 space-y-5 text-sm">
                {/* Employee & Shift info */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-secondary/15 border border-secondary/30 text-xs">
                  <div>
                    <span className="text-muted-foreground">Employee Name:</span>
                    <p className="font-semibold text-foreground">{user?.name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Employee ID:</span>
                    <p className="font-semibold text-foreground">{employee?.employeeCode || '—'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Department:</span>
                    <p className="font-semibold text-foreground">{employee?.department?.name || '—'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Working Days:</span>
                    <p className="font-semibold text-foreground">{selected.workingDays} Days</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Days Present:</span>
                    <p className="font-semibold text-emerald-600">{Number(selected.presentDays)} Days</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Monthly Base Rate:</span>
                    <p className="font-semibold text-foreground">₹{Number(employee?.baseSalary || 0).toLocaleString()}</p>
                  </div>
                </div>

                {/* Earnings & Deductions Breakdown */}
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Earnings */}
                  <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-2.5">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60 pb-2">
                      Earnings Breakdown
                    </h4>
                    <div className="flex justify-between text-xs">
                      <span>Basic Working Pay</span>
                      <span className="font-medium">₹{Number(selected.basicSalary).toLocaleString()}</span>
                    </div>
                    {Number((selected as any).sundayHolidayPay || selected.bonusAmount || 0) > 0 && (
                      <div className="flex justify-between text-xs">
                        <span>Sunday & Holiday Pay</span>
                        <span className="font-medium text-purple-600">
                          +₹{Number((selected as any).sundayHolidayPay || selected.bonusAmount).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {Number((selected as any).commissionAmount || 0) > 0 && (
                      <div className="flex justify-between text-xs">
                        <span>Commission</span>
                        <span className="font-medium text-emerald-600">
                          +₹{Number((selected as any).commissionAmount).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {Number(selected.overtimeAmount || 0) > 0 && (
                      <div className="flex justify-between text-xs">
                        <span>Overtime</span>
                        <span className="font-medium text-emerald-600">
                          +₹{Number(selected.overtimeAmount).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Deductions */}
                  <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-2.5">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground border-b border-border/60 pb-2">
                      Deductions Breakdown
                    </h4>
                    {Number((selected as any).advanceDeducted || 0) > 0 && (
                      <div className="flex justify-between text-xs">
                        <span>Advance Deductions</span>
                        <span className="font-medium text-red-600">
                          -₹{Number((selected as any).advanceDeducted).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {Number(selected.totalDeductions || 0) > 0 && (
                      <div className="flex justify-between text-xs">
                        <span>Other Deductions</span>
                        <span className="font-medium text-red-600">
                          -₹{Number(selected.totalDeductions).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {Number((selected as any).advanceDeducted || 0) === 0 && Number(selected.totalDeductions || 0) === 0 && (
                      <p className="text-xs text-muted-foreground italic">No deductions recorded</p>
                    )}
                  </div>
                </div>

                {/* Net Payout Banner */}
                <div className="bg-primary/10 rounded-xl p-4 flex justify-between items-center border border-primary/20">
                  <div>
                    <span className="font-bold text-sm text-foreground">Net Salary Payout</span>
                    <p className="text-[11px] text-muted-foreground">Final payable amount</p>
                  </div>
                  <span className="font-black text-2xl text-primary">₹{Number(selected.netSalary).toLocaleString()}</span>
                </div>
                
                {selected.remarks && (
                  <div className="p-3 rounded-lg bg-secondary/20 text-xs border border-secondary/30">
                    <span className="font-semibold text-foreground">Remarks:</span> {selected.remarks}
                  </div>
                )}
              </div>
              
              {/* Footer Actions */}
              <div className="bg-muted/40 p-4 border-t border-border flex justify-end gap-3">
                <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
                <Button
                  className="gap-2"
                  onClick={() => {
                    window.electronApi.files
                      ?.download(`/salary/me/${selected.id}/slip`, `salary-slip-${selected.id}.pdf`)
                      .catch(() => undefined);
                  }}
                >
                  <Download size={16} /> Download PDF
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
