import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { dashboardApi, attendanceApi, leaveApi, salaryApi, announcementsApi, holidaysApi, attendanceRequestsApi, type AttendanceRequestItem } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { DataTable } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Plane,
  CalendarClock,
  TrendingUp,
  IndianRupee,
  Megaphone,
  Calendar,
  ArrowUpRight,
  ChevronRight,
  FileText,
  Percent,
  CheckCheck,
  Gift,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface StatTileProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  colorClass: string;
  subtext?: string;
  to?: string;
  onClick?: () => void;
  indicatorColor?: string;
}

function StatTile({
  label,
  value,
  icon,
  colorClass,
  subtext,
  to,
  onClick,
  indicatorColor,
}: StatTileProps): JSX.Element {
  const content = (
    <div className="relative h-full flex flex-col justify-between rounded-2xl border border-border/70 bg-card p-3.5 shadow-2xs hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 group/card select-none cursor-pointer overflow-hidden">
      {/* Top subtle accent line on hover */}
      <div className="absolute top-0 inset-x-0 h-[2.5px] bg-gradient-to-r from-transparent via-primary/0 to-transparent group-hover/card:via-primary/70 transition-all duration-300" />

      {/* Top Row: Label & Icon */}
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80 truncate" title={label}>
          {label}
        </span>
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200 group-hover/card:scale-110 shadow-2xs',
            colorClass,
          )}
        >
          {icon}
        </div>
      </div>

      {/* Middle: Prominent Metric Value */}
      <div className="my-1">
        <span className="text-2xl sm:text-[28px] font-bold tracking-tight text-foreground leading-none">
          {value}
        </span>
      </div>

      {/* Bottom: Subtext & Subtle Arrow Indicator */}
      {subtext && (
        <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground min-w-0">
          <span className="truncate flex items-center font-medium text-muted-foreground/80" title={subtext}>
            {indicatorColor && (
              <span className={cn('h-1.5 w-1.5 rounded-full mr-1.5 shrink-0', indicatorColor)} />
            )}
            <span className="truncate">{subtext}</span>
          </span>
          <ArrowUpRight
            size={12}
            className="shrink-0 text-muted-foreground/30 group-hover/card:text-primary group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5 transition-all duration-150 ml-1"
          />
        </div>
      )}
    </div>
  );

  if (onClick) {
    return (
      <div onClick={onClick} className="block h-full">
        {content}
      </div>
    );
  }

  return (
    <Link to={to!} className="block h-full">
      {content}
    </Link>
  );
}

const MONTH_OPTIONS = [
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

const YEAR_OPTIONS = ['2024', '2025', '2026', '2027', '2028'];

interface DashboardAnnouncement {
  id: string;
  message: string;
  isActive: boolean;
  createdAt: string;
}

interface DashboardHoliday {
  id: string;
  name: string;
  date: string;
  description?: string | null;
}

interface DashboardLeaveRequest {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  startDate: string;
  endDate: string;
  employee: {
    firstName: string;
    lastName: string;
  };
  leaveType?: {
    name: string;
  };
}

export function AdminDashboardPage(): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [todayStr, setTodayStr] = useState('');
  const [activeModal, setActiveModal] = useState<'present' | 'absent' | 'late' | 'early' | 'birthdays' | 'paid' | 'unpaid' | null>(null);

  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonthNum = now.getMonth() + 1;
  const currentMonthStr = String(currentMonthNum).padStart(2, '0');
  const todayFormatted = now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  // Salary month/year filter state (defaults to current month and year)
  const [salaryYear, setSalaryYear] = useState(String(currentYear));
  const [salaryMonth, setSalaryMonth] = useState(currentMonthStr);

  const salaryMonthIso = `${salaryYear}-${salaryMonth}-01`;
  const salaryMonthLabel = MONTH_OPTIONS.find((m) => m.value === salaryMonth)?.label || 'Month';
  const salaryMonthName = `${salaryMonthLabel} ${salaryYear}`;

  useEffect(() => {
    const d = new Date();
    setTodayStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }, []);

  // 1. Core Dashboard Data
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'admin'],
    queryFn: dashboardApi.admin,
  });

  // 2. Today's Attendance Logs
  const { data: todayAttendance, isLoading: isAttendanceLoading } = useQuery({
    queryKey: ['attendance', 'today', todayStr],
    queryFn: () => attendanceApi.listAll({ from: todayStr, to: todayStr, pageSize: '50' }),
    enabled: !!todayStr,
  });

  // 3. Salary Data (Server-calculated exact figures matching SalaryManagementPage)
  const { data: salarySummary, isLoading: isSalaryLoading } = useQuery({
    queryKey: ['salary', 'summary', salaryMonthIso],
    queryFn: () => salaryApi.summary(salaryMonthIso),
  });

  const salaryOverview = salarySummary || {
    paidSum: 0,
    unpaidSum: 0,
    totalDueSum: 0,
    paidCount: 0,
    unpaidCount: 0,
    totalEmployeesCount: 0,
    percentagePaid: 0,
  };

  // 4. Announcements
  const { data: announcementsData = [] } = useQuery<DashboardAnnouncement[]>({
    queryKey: ['announcements'],
    queryFn: () => announcementsApi.list() as Promise<DashboardAnnouncement[]>,
  });

  // 5. Current Year Holidays
  const { data: holidaysData = [] } = useQuery<DashboardHoliday[]>({
    queryKey: ['holidays', currentYear],
    queryFn: () => holidaysApi.list({ year: String(currentYear) }) as Promise<DashboardHoliday[]>,
  });

  // Mutations for Leave Approval/Rejection
  const approveLeave = useMutation({
    mutationFn: (id: string) => leaveApi.approve(id, { remarks: 'Approved from dashboard' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard', 'admin'] }),
  });

  const rejectLeave = useMutation({
    mutationFn: (id: string) => leaveApi.reject(id, { remarks: 'Rejected from dashboard' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard', 'admin'] }),
  });

  // 6. Attendance Punch Requests (Pending review)
  const { data: pendingRequests = [], isLoading: isRequestsLoading } = useQuery<AttendanceRequestItem[]>({
    queryKey: ['attendance', 'requests', 'pending'],
    queryFn: attendanceRequestsApi.listPending,
  });

  const approveRequestMutation = useMutation({
    mutationFn: (id: string) => attendanceRequestsApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance', 'requests', 'pending'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: () => attendanceRequestsApi.bulkApprove(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['attendance', 'requests', 'pending'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      alert(`Approved ${res.count} attendance punch requests! Database attendance has been updated.`);
    },
  });

  const rejectRequestMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: string; remarks?: string }) =>
      attendanceRequestsApi.reject(id, remarks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance', 'requests', 'pending'] });
    },
  });

  const handleApproveRequest = (r: AttendanceRequestItem) => {
    const empName = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.trim() || 'Employee';
    const dateFormatted = new Date(r.attendanceDate).toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    const confirmed = window.confirm(
      `Are you sure you want to approve the punch correction request for ${empName} on ${dateFormatted}?\n\nThis will automatically update the attendance record and calculate worked hours in the database.`
    );
    if (confirmed) {
      approveRequestMutation.mutate(r.id);
    }
  };

  const handleApproveAllRequests = () => {
    if (pendingRequests.length === 0) return;
    const confirmed = window.confirm(
      `Are you sure you want to approve all ${pendingRequests.length} pending punch correction requests?\n\nThis will automatically update attendance and worked hours in the database for all approved records.`
    );
    if (confirmed) {
      bulkApproveMutation.mutate();
    }
  };

  const handleRejectRequest = (r: AttendanceRequestItem) => {
    const empName = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.trim() || 'Employee';
    const remarks = window.prompt(`Enter rejection reason for ${empName} (optional):`, 'Punch times could not be verified');
    if (remarks !== null) {
      rejectRequestMutation.mutate({ id: r.id, remarks });
    }
  };

  // Sorted Holidays for Current Year
  const sortedHolidays = useMemo(() => {
    const list = [...(holidaysData || [])];
    return list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [holidaysData]);

  // Attendance Rate Analysis
  const attendanceRate = useMemo(() => {
    if (!data?.totalEmployees || data.totalEmployees === 0) return 0;
    return Math.round((data.presentToday / data.totalEmployees) * 100);
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2">
          <Clock className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">Loading workspace dashboard…</p>
        </div>
      </div>
    );
  }

  const maxTrend = Math.max(1, ...data.attendanceTrend.map((t) => t.present + t.absent));

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-8">
      {/* Top Header & Fast Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/50">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Admin Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time overview of workforce attendance, payroll, leave requests, and schedules for {todayFormatted}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/admin/attendance')}
            className="gap-1.5 text-xs font-medium h-9 rounded-xl border-border/70 hover:border-primary/50"
          >
            <Clock size={14} className="text-primary" />
            <span>Attendance Log</span>
          </Button>
          <Button
            size="sm"
            onClick={() => navigate('/admin/salary')}
            className="gap-1.5 text-xs font-medium h-9 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
          >
            <IndianRupee size={14} />
            <span>Manage Payroll</span>
          </Button>
        </div>
      </div>

      {/* Modals */}
      <Dialog open={activeModal !== null} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent className="sm:max-w-[450px] rounded-2xl p-6 max-h-[80vh] flex flex-col">
          <DialogHeader className="pb-3 border-b border-border/40 shrink-0">
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              {activeModal === 'present' && <><CheckCircle2 className="text-emerald-500" size={18} /> Present Staff Today</>}
              {activeModal === 'absent' && <><XCircle className="text-rose-500" size={18} /> Absent Staff Today</>}
              {activeModal === 'late' && <><Clock className="text-amber-500" size={18} /> Late Arrivals Today</>}
              {activeModal === 'birthdays' && <><Gift className="text-pink-500" size={18} /> Birthdays This Month</>}
              {activeModal === 'paid' && <><IndianRupee className="text-emerald-500" size={18} /> Paid Staff ({salaryMonthLabel.slice(0, 3)})</>}
              {activeModal === 'unpaid' && <><IndianRupee className="text-amber-500" size={18} /> Unpaid Staff</>}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0 pt-4 pb-2 space-y-2 pr-1">
            {activeModal === 'present' && (
              (data.presentList?.length ?? 0) > 0 ? data.presentList?.map((a: any) => (
                <div key={a.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border/50">
                  <div className="text-sm font-semibold">{a.employee.firstName} {a.employee.lastName}</div>
                  <div className="text-xs text-muted-foreground">{new Date(a.punchInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</div>
                </div>
              )) : <div className="text-center text-sm text-muted-foreground py-6">No present staff found.</div>
            )}
            {activeModal === 'absent' && (
              (data.absentList?.length ?? 0) > 0 ? data.absentList?.map((emp: any) => (
                <div key={emp.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border/50">
                  <div className="text-sm font-semibold">{emp.firstName} {emp.lastName}</div>
                  <div className="text-xs text-muted-foreground">{emp.designation?.title || 'Staff'}</div>
                </div>
              )) : <div className="text-center text-sm text-muted-foreground py-6">No absent staff found.</div>
            )}
            {activeModal === 'late' && (
              (data.lateList?.length ?? 0) > 0 ? data.lateList?.map((a: any) => (
                <div key={a.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border/50">
                  <div className="text-sm font-semibold">{a.employee.firstName} {a.employee.lastName}</div>
                  <div className="text-xs font-medium text-amber-500">{a.lateMinutes}m Late</div>
                </div>
              )) : <div className="text-center text-sm text-muted-foreground py-6">No late arrivals today.</div>
            )}
            {activeModal === 'birthdays' && (
              (data.birthdaysThisMonth?.length ?? 0) > 0 ? data.birthdaysThisMonth?.map((emp: any) => (
                <div key={emp.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border/50">
                  <div className="text-sm font-semibold">{emp.firstName} {emp.lastName}</div>
                  <div className="text-xs font-bold text-pink-500">{new Date(emp.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                </div>
              )) : <div className="text-center text-sm text-muted-foreground py-6">No birthdays this month.</div>
            )}
            {activeModal === 'paid' && (
              (salaryOverview as any).paidEmployees?.length > 0 ? (salaryOverview as any).paidEmployees.map((emp: any) => (
                <div key={emp.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border/50">
                  <div>
                    <div className="text-sm font-semibold">{emp.firstName} {emp.lastName}</div>
                    {emp.employeeCode && <div className="text-[11px] text-muted-foreground">{emp.employeeCode}</div>}
                  </div>
                  <div className="text-xs font-bold text-emerald-500">₹{emp.netSalary?.toLocaleString('en-IN')}</div>
                </div>
              )) : (data.paidList?.length ?? 0) > 0 ? data.paidList?.map((emp: any) => (
                <div key={emp.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border/50">
                  <div className="text-sm font-semibold">{emp.employee?.firstName || emp.firstName} {emp.employee?.lastName || emp.lastName}</div>
                  <div className="text-xs font-bold text-emerald-500">₹{emp.netSalary?.toLocaleString('en-IN')}</div>
                </div>
              )) : <div className="text-center text-sm text-muted-foreground py-6">No paid staff found for this month.</div>
            )}
            {activeModal === 'unpaid' && (
              (salaryOverview as any).unpaidEmployees?.length > 0 ? (salaryOverview as any).unpaidEmployees.map((emp: any) => (
                <div key={emp.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border/50">
                  <div>
                    <div className="text-sm font-semibold">{emp.firstName} {emp.lastName}</div>
                    {emp.employeeCode && <div className="text-[11px] text-muted-foreground">{emp.employeeCode}</div>}
                  </div>
                  <div className="text-xs font-bold text-amber-500">₹{emp.netSalary?.toLocaleString('en-IN')}</div>
                </div>
              )) : (data.unpaidList?.length ?? 0) > 0 ? data.unpaidList?.map((emp: any) => (
                <div key={emp.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border/50">
                  <div className="text-sm font-semibold">{emp.employee?.firstName || emp.firstName} {emp.employee?.lastName || emp.lastName}</div>
                  <div className="text-xs font-bold text-amber-500">₹{emp.netSalary?.toLocaleString('en-IN')}</div>
                </div>
              )) : <div className="text-center text-sm text-muted-foreground py-6">No unpaid staff found for this month.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 7 Key Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3.5">
        <StatTile
          label="Total Staff"
          value={data.totalEmployees}
          subtext="Active members"
          icon={<Users size={16} />}
          colorClass="bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"
          indicatorColor="bg-blue-500"
          to="/admin/employees"
        />
        <StatTile
          label="Present"
          value={data.presentToday}
          subtext={`${attendanceRate}% turnout today`}
          icon={<CheckCircle2 size={16} />}
          colorClass="bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
          indicatorColor="bg-emerald-500"
          onClick={() => setActiveModal('present')}
        />
        <StatTile
          label="Absent"
          value={data.absentToday}
          subtext="Unaccounted today"
          icon={<XCircle size={16} />}
          colorClass="bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400"
          indicatorColor="bg-rose-500"
          onClick={() => setActiveModal('absent')}
        />
        <StatTile
          label="Late Arrival"
          value={data.lateToday}
          subtext="After shift start"
          icon={<Clock size={16} />}
          colorClass="bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
          indicatorColor={data.lateToday > 0 ? 'bg-amber-500' : 'bg-muted-foreground/30'}
          onClick={() => setActiveModal('late')}
        />
        <StatTile
          label="On Leave"
          value={data.onLeaveToday}
          subtext="Approved leaves"
          icon={<Plane size={16} />}
          colorClass="bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400"
          indicatorColor="bg-indigo-500"
          to="/admin/leaves"
        />
        <StatTile
          label="Pending Leaves"
          value={data.pendingLeaveCount}
          subtext="Requires review"
          icon={<CalendarClock size={16} />}
          colorClass="bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400"
          indicatorColor={data.pendingLeaveCount > 0 ? 'bg-orange-500 animate-pulse' : 'bg-muted-foreground/30'}
          to="/admin/leaves"
        />
        <StatTile
          label="Birthdays"
          value={data.birthdaysThisMonthCount || 0}
          subtext="This month"
          icon={<Gift size={16} />}
          colorClass="bg-pink-500/10 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400"
          indicatorColor="bg-pink-500"
          onClick={() => setActiveModal('birthdays')}
        />
      </div>

      {/* Row 2: Attendance Trends (50%) & Salary/Payroll Overview (50%) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* 7-Day Attendance Trend Analysis */}
        <Card className="rounded-2xl border border-border/70 shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
                  <TrendingUp size={16} className="text-primary" />
                  <span>7-Day Attendance Analysis</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Daily presence vs absence distribution across the organization
                </p>
              </div>

              <Link
                to="/admin/attendance"
                className="text-xs text-primary font-medium hover:underline flex items-center gap-1 group"
              >
                <span>Full History</span>
                <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
          </CardHeader>

          <CardContent className="p-5 flex-1 flex flex-col justify-between">
            {/* Trend Bar Chart */}
            <div className="flex h-44 items-end gap-2 justify-between pt-2">
              {data.attendanceTrend.map((t) => {
                const totalForDay = t.present + t.absent;
                const dayRate = totalForDay > 0 ? Math.round((t.present / totalForDay) * 100) : 0;
                const dObj = new Date(t.date);
                const dayLabel = dObj.toLocaleDateString('en-IN', { weekday: 'short' });
                const dateLabel = dObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

                return (
                  <div key={t.date} className="flex flex-col items-center gap-2 w-full group/bar">
                    <div className="flex w-full items-end justify-center gap-1.5 h-36 relative">
                      {/* Hover Tooltip */}
                      <div className="opacity-0 group-hover/bar:opacity-100 transition-opacity absolute -top-10 z-10 pointer-events-none bg-popover text-popover-foreground border shadow-md text-[10px] py-1 px-2 rounded-md whitespace-nowrap">
                        {dateLabel}: {t.present} Pres, {t.absent} Abs ({dayRate}%)
                      </div>

                      {/* Present Bar */}
                      <div
                        className="w-full max-w-[18px] rounded-t-md bg-emerald-500 group-hover/bar:bg-emerald-400 transition-all shadow-sm"
                        style={{ height: `${Math.max(4, (t.present / maxTrend) * 100)}%` }}
                      />
                      {/* Absent Bar */}
                      <div
                        className="w-full max-w-[18px] rounded-t-md bg-rose-400/80 group-hover/bar:bg-rose-400 transition-all shadow-sm"
                        style={{ height: `${Math.max(4, (t.absent / maxTrend) * 100)}%` }}
                      />
                    </div>
                    <div className="text-center">
                      <span className="text-[11px] font-semibold text-foreground block">{dayLabel}</span>
                      <span className="text-[10px] text-muted-foreground block">{t.date.slice(8)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend & Summary Footer */}
            <div className="pt-4 border-t border-border/40 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground mt-3">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                  <span className="font-medium text-foreground">Present Staff</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400 inline-block" />
                  <span className="font-medium text-foreground">Absent</span>
                </div>
              </div>

              <Badge variant="outline" className="text-[11px] font-medium py-0.5 gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                <Percent size={11} /> {attendanceRate}% Present Today
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Salary & Payroll Status Card */}
        <Card className="rounded-2xl border border-border/70 shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
                  <IndianRupee size={16} className="text-emerald-600" />
                  <span>Salary & Payroll Status</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Overview of {salaryMonthName} disbursements
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Month / Year quick select */}
                <select
                  value={salaryMonth}
                  onChange={(e) => setSalaryMonth(e.target.value)}
                  className="h-7 text-xs rounded-lg border border-border bg-background px-2 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>

                <select
                  value={salaryYear}
                  onChange={(e) => setSalaryYear(e.target.value)}
                  className="h-7 text-xs rounded-lg border border-border bg-background px-2 font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>

                <Link
                  to={`/admin/salary?month=${salaryMonth}&year=${salaryYear}`}
                  className="text-xs text-primary font-medium hover:underline flex items-center gap-1 group ml-1"
                >
                  <span>Manage</span>
                  <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 flex-1 flex flex-col justify-between space-y-4">
            {/* Quick Metrics Columns */}
            <div className="grid grid-cols-2 gap-3">
              {/* Paid Status Box */}
              <div
                onClick={() => setActiveModal('paid')}
                className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Paid ({salaryMonthLabel.slice(0, 3)})
                  </span>
                  {isSalaryLoading ? (
                    <div className="h-4 w-12 bg-emerald-500/20 animate-pulse rounded-full" />
                  ) : (
                    <Badge className="bg-emerald-600 text-white text-[10px] h-4 px-1.5">
                      {salaryOverview.paidCount} Emp
                    </Badge>
                  )}
                </div>
                {isSalaryLoading ? (
                  <div className="h-7 w-24 bg-muted/60 animate-pulse rounded mt-2" />
                ) : (
                  <p className="text-xl font-bold tracking-tight text-foreground mt-2">
                    ₹ {salaryOverview.paidSum.toLocaleString('en-IN')}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">Disbursed for {salaryMonthLabel}</p>
              </div>

              {/* Unpaid / Pending Status Box */}
              <div
                onClick={() => setActiveModal('unpaid')}
                className="p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Unpaid
                  </span>
                  {isSalaryLoading ? (
                    <div className="h-4 w-12 bg-amber-500/20 animate-pulse rounded-full" />
                  ) : (
                    <Badge variant="outline" className="border-amber-500/30 text-amber-600 text-[10px] h-4 px-1.5">
                      {salaryOverview.unpaidCount} Emp
                    </Badge>
                  )}
                </div>
                {isSalaryLoading ? (
                  <div className="h-7 w-24 bg-muted/60 animate-pulse rounded mt-2" />
                ) : (
                  <p className="text-xl font-bold tracking-tight text-foreground mt-2">
                    ₹ {salaryOverview.unpaidSum.toLocaleString('en-IN')}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">Pending payment</p>
              </div>
            </div>

            {/* Payroll Completion Progress Bar */}
            <div className="space-y-2 p-3 rounded-xl bg-muted/20 border border-border/40">
              <div className="flex justify-between items-center text-xs font-medium">
                <span className="text-muted-foreground">Disbursement Progress</span>
                <span className="text-foreground">
                  {isSalaryLoading ? 'Calculating…' : `${salaryOverview.percentagePaid}% Cleared`}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${isSalaryLoading ? 0 : salaryOverview.percentagePaid}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-[11px] text-muted-foreground pt-1">
                {isSalaryLoading ? (
                  <span className="animate-pulse">Loading payroll summary…</span>
                ) : (
                  <>
                    <span>Total Due (All): ₹ {salaryOverview.totalDueSum.toLocaleString('en-IN')}</span>
                    <span>{salaryOverview.totalEmployeesCount} Employees</span>
                  </>
                )}
              </div>
            </div>

            {/* Quick Action Button to Salary Page */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/admin/salary?month=${salaryMonth}&year=${salaryYear}`)}
              className="w-full justify-center gap-2 h-9 rounded-xl border-border/70 hover:border-emerald-500/40 text-xs font-medium"
            >
              <FileText size={13} className="text-emerald-600" />
              <span>Review Salary Slips & Monthly Balances</span>
              <ArrowUpRight size={13} className="text-muted-foreground" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Today's Attendance Table (7 cols) + Recent Leaves (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Today's Live Attendance Table */}
        <Card className="lg:col-span-7 rounded-2xl border border-border/70 shadow-sm flex flex-col justify-between">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/40">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
                <Clock size={16} className="text-primary" />
                <span>Today's Live Attendance</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Staff punch in/out timestamps and recorded duration for today
              </p>
            </div>
            <Link
              to="/admin/attendance"
              className="text-xs text-primary font-medium hover:underline flex items-center gap-1 group"
            >
              <span>View All</span>
              <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>

          <CardContent className="p-0 flex-1 overflow-auto max-h-[340px]">
            <DataTable
              columns={[
                {
                  key: 'employee',
                  header: 'Employee',
                  render: (r) => (
                    <div
                      className="cursor-pointer hover:text-primary transition-colors py-0.5"
                      onClick={() => navigate('/admin/attendance')}
                    >
                      <div className="font-semibold text-sm text-foreground">
                        {r.employee.firstName} {r.employee.lastName}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.employee.employeeCode || 'EMP'}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'punchInAt',
                  header: 'Punch-In',
                  render: (r) => (
                    <span className="text-xs font-medium text-foreground">
                      {r.punchInAt
                        ? new Date(r.punchInAt).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          })
                        : '--'}
                    </span>
                  ),
                },
                {
                  key: 'punchOutAt',
                  header: 'Punch-Out',
                  render: (r) => (
                    <span className="text-xs font-medium text-foreground">
                      {r.punchOutAt
                        ? new Date(r.punchOutAt).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          })
                        : '--'}
                    </span>
                  ),
                },
                {
                  key: 'workedMinutes',
                  header: 'Worked',
                  render: (r) => (
                    <span className="text-xs text-muted-foreground">
                      {r.workedMinutes
                        ? `${Math.floor(r.workedMinutes / 60)}h ${r.workedMinutes % 60}m`
                        : '--'}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (r) => <StatusBadge status={r.status} />,
                },
              ]}
              rows={todayAttendance?.items ?? []}
              getRowKey={(r) => r.id}
              isLoading={isAttendanceLoading}
            />
          </CardContent>
        </Card>

        {/* Recent Leave Requests */}
        <Card className="lg:col-span-5 rounded-2xl border border-border/70 shadow-sm flex flex-col justify-between">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/40">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
                <CalendarClock size={16} className="text-orange-500" />
                <span>Recent Leave Requests</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pending and recent time-off applications
              </p>
            </div>
            <Link
              to="/admin/leaves"
              className="text-xs text-primary font-medium hover:underline flex items-center gap-1 group"
            >
              <span>Manage</span>
              <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>

          <CardContent className="p-4 space-y-3 flex-1 overflow-auto max-h-[340px]">
            {(data.recentLeaveRequests as unknown as DashboardLeaveRequest[]).map((r) => (
              <div
                key={r.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between border border-border/60 rounded-xl p-3 gap-3 bg-card hover:bg-muted/10 transition-colors"
              >
                <div>
                  <div className="font-medium text-sm text-foreground flex items-center gap-2">
                    <span>{r.employee.firstName} {r.employee.lastName}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <span>{r.leaveType?.name || 'Leave'}</span>
                    <span>•</span>
                    <span>
                      {new Date(r.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – {new Date(r.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                  </div>
                </div>

                {r.status === 'PENDING' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 rounded-lg"
                      onClick={() => approveLeave.mutate(r.id)}
                      disabled={approveLeave.isPending}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2.5 border-rose-500/30 text-rose-600 hover:bg-rose-500/10 rounded-lg"
                      onClick={() => rejectLeave.mutate(r.id)}
                      disabled={rejectLeave.isPending}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {data.recentLeaveRequests.length === 0 && (
              <div className="text-center py-10">
                <p className="text-xs text-muted-foreground">No recent leave requests found.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3.5: Attendance Punch Requests Widget */}
      <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden bg-card">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-border/40 gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold tracking-tight text-foreground">
                  Attendance Punch Requests
                </CardTitle>
                <Badge
                  className={cn(
                    "text-xs font-semibold px-2 py-0.5 border",
                    pendingRequests.length > 0
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                      : "bg-muted text-muted-foreground border-border/60"
                  )}
                >
                  {pendingRequests.length} Pending
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Staff punch corrections requiring review and automatic database update
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleApproveAllRequests}
              disabled={pendingRequests.length === 0 || bulkApproveMutation.isPending}
              className="gap-1.5 text-xs font-medium h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
            >
              <CheckCheck size={14} />
              <span>{bulkApproveMutation.isPending ? 'Approving All...' : `Approve All (${pendingRequests.length})`}</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-4">
          {isRequestsLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground animate-pulse">
              Loading attendance punch requests...
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="py-7 text-center flex flex-col items-center justify-center">
              <div className="h-10 w-10 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-2">
                <CheckCircle2 size={20} />
              </div>
              <p className="text-xs font-semibold text-foreground">All Caught Up!</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                No pending punch correction requests. All employee attendance punches are up to date.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border/60">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Requested In</th>
                    <th className="px-4 py-3">Requested Out</th>
                    <th className="px-4 py-3">Original In / Out</th>
                    <th className="px-4 py-3">Reason / Note</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {pendingRequests.map((r) => {
                    const empName = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.trim() || 'Employee';
                    const dObj = new Date(r.attendanceDate);
                    const dateStr = dObj.toLocaleDateString('en-IN', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    });

                    const formatTime = (iso?: string | null) => {
                      if (!iso) return '--:--';
                      return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                    };

                    return (
                      <tr key={r.id} className="hover:bg-muted/15 transition-colors">
                        {/* Employee */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center border border-primary/20 shrink-0">
                              {r.employee?.firstName?.charAt(0) || 'E'}{r.employee?.lastName?.charAt(0) || ''}
                            </div>
                            <div>
                              <div className="font-semibold text-xs text-foreground leading-tight">
                                {empName}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {r.employee?.employeeCode || 'EMP'} • {r.employee?.designation?.title || r.employee?.department?.name || 'Staff'}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Date */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                            <Calendar size={13} className="text-primary shrink-0" />
                            <span>{dateStr}</span>
                          </div>
                        </td>

                        {/* Requested Punch In */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {Array.isArray(r.punchPairs) && r.punchPairs.length > 0 ? (
                            <div className="flex flex-col gap-1 py-0.5">
                              {r.punchPairs.map((p, idx) => (
                                <span key={idx} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-semibold text-emerald-700 bg-emerald-500/10 border border-emerald-500/20 text-xs">
                                  <Clock size={11} className="text-emerald-600 shrink-0" />
                                  <span>{formatTime(p.punchInAt)}</span>
                                  {r.punchPairs!.length > 1 && (
                                    <span className="text-[9px] px-1 rounded bg-emerald-600 text-white font-mono font-bold">
                                      #{idx + 1}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          ) : r.punchInAt ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold text-emerald-700 bg-emerald-500/10 border border-emerald-500/20 text-xs">
                              <Clock size={12} className="text-emerald-600 shrink-0" />
                              {formatTime(r.punchInAt)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground font-mono">--:--</span>
                          )}
                        </td>

                        {/* Requested Punch Out */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {Array.isArray(r.punchPairs) && r.punchPairs.length > 0 ? (
                            <div className="flex flex-col gap-1 py-0.5">
                              {r.punchPairs.map((p, idx) => (
                                <span key={idx} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-semibold text-orange-700 bg-orange-500/10 border border-orange-500/20 text-xs">
                                  <Clock size={11} className="text-orange-600 shrink-0" />
                                  <span>{formatTime(p.punchOutAt)}</span>
                                  {r.punchPairs!.length > 1 && (
                                    <span className="text-[9px] px-1 rounded bg-orange-600 text-white font-mono font-bold">
                                      #{idx + 1}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          ) : r.punchOutAt ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold text-orange-700 bg-orange-500/10 border border-orange-500/20 text-xs">
                              <Clock size={12} className="text-orange-600 shrink-0" />
                              {formatTime(r.punchOutAt)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground font-mono">--:--</span>
                          )}
                        </td>

                        {/* Original In / Out */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {Array.isArray(r.originalPairs) && r.originalPairs.length > 0 ? (
                            <div className="text-[11px] text-muted-foreground space-y-0.5">
                              {r.originalPairs.map((op, idx) => (
                                <div key={idx} className="line-through decoration-muted-foreground/60">
                                  #{idx + 1}: {formatTime(op.punchInAt)} – {formatTime(op.punchOutAt)}
                                </div>
                              ))}
                            </div>
                          ) : (r.originalPunchIn || r.originalPunchOut) ? (
                            <div className="text-[11px] text-muted-foreground space-y-0.5">
                              {r.originalPunchIn && (
                                <div className="line-through decoration-muted-foreground/60">
                                  In: {formatTime(r.originalPunchIn)}
                                </div>
                              )}
                              {r.originalPunchOut && (
                                <div className="line-through decoration-muted-foreground/60">
                                  Out: {formatTime(r.originalPunchOut)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground italic">No prior punch</span>
                          )}
                        </td>

                        {/* Reason / Note */}
                        <td className="px-4 py-3 max-w-xs">
                          {r.reason ? (
                            <span className="text-[11px] text-foreground/80 italic line-clamp-2" title={r.reason}>
                              “{r.reason}”
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/60 italic">No reason provided</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRejectRequest(r)}
                              disabled={rejectRequestMutation.isPending || approveRequestMutation.isPending}
                              className="h-7 text-xs px-2.5 rounded-lg border-rose-500/30 text-rose-600 hover:bg-rose-500/10 font-medium"
                            >
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleApproveRequest(r)}
                              disabled={approveRequestMutation.isPending || rejectRequestMutation.isPending}
                              className="h-7 text-xs px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1 shadow-xs"
                            >
                              <CheckCircle2 size={12} />
                              <span>Approve</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 4: Announcements (50%) & Current Year Holidays (50%) Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Company Announcements Widget */}
        <Card className="rounded-2xl border border-border/70 shadow-sm flex flex-col justify-between">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/40">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
                <Megaphone size={16} className="text-primary" />
                <span>Company Announcements</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Broadcast notices sent to the staff
              </p>
            </div>
            <Link
              to="/admin/announcements"
              className="text-xs text-primary font-medium hover:underline flex items-center gap-1 group"
            >
              <span>View All</span>
              <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>

          <CardContent className="p-4 space-y-2.5 flex-1 overflow-auto max-h-[300px]">
            {announcementsData.slice(0, 4).map((a) => (
              <div
                key={a.id}
                onClick={() => navigate('/admin/announcements')}
                className="p-3 rounded-xl border border-border/60 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer space-y-1.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-primary flex items-center gap-1.5">
                    <Megaphone size={12} /> Notice
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(a.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </span>
                </div>
                <p className="text-xs text-foreground line-clamp-2 leading-relaxed">
                  {a.message}
                </p>
              </div>
            ))}

            {announcementsData.length === 0 && (
              <div
                onClick={() => navigate('/admin/announcements')}
                className="p-6 text-center border border-dashed rounded-xl cursor-pointer hover:bg-muted/10 transition-colors"
              >
                <p className="text-xs text-muted-foreground">No active announcements.</p>
                <p className="text-[11px] text-primary font-medium mt-1">Click to broadcast a notice</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Current Year Holidays Widget */}
        <Card className="rounded-2xl border border-border/70 shadow-sm flex flex-col justify-between">
          <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/40">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
                <Calendar size={16} className="text-indigo-600" />
                <span>Holidays ({currentYear})</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Official holidays calendar for {currentYear}
              </p>
            </div>
            <Link
              to="/admin/organization"
              className="text-xs text-primary font-medium hover:underline flex items-center gap-1 group"
            >
              <span>Manage</span>
              <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>

          <CardContent className="p-4 flex-1">
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {sortedHolidays.map((h) => {
                const hDate = new Date(h.date);
                const isPast = hDate.getTime() < new Date().setHours(0, 0, 0, 0);
                const isToday = hDate.toDateString() === new Date().toDateString();

                return (
                  <div
                    key={h.id}
                    onClick={() => navigate('/admin/organization')}
                    className={cn(
                      "flex items-center justify-between p-2.5 rounded-xl border border-border/50 text-xs transition-colors cursor-pointer",
                      isToday
                        ? "bg-emerald-500/10 border-emerald-500/30"
                        : isPast
                        ? "bg-muted/20 opacity-70 hover:opacity-100"
                        : "bg-card hover:bg-muted/20"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-center w-10 shrink-0">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase block leading-none">
                          {hDate.toLocaleDateString('en-IN', { weekday: 'short' })}
                        </span>
                        <span className="text-sm font-bold text-foreground block leading-tight mt-0.5">
                          {hDate.getDate()}
                        </span>
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{h.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {hDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                        </div>
                      </div>
                    </div>

                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-2 py-0.5 font-medium shrink-0",
                        isToday
                          ? "bg-emerald-500 text-white border-transparent"
                          : isPast
                          ? "border-border/60 text-muted-foreground"
                          : "border-indigo-500/30 text-indigo-600 dark:text-indigo-400"
                      )}
                    >
                      {isToday ? 'Today' : isPast ? 'Past' : 'Upcoming'}
                    </Badge>
                  </div>
                );
              })}

              {sortedHolidays.length === 0 && (
                <div
                  onClick={() => navigate('/admin/organization')}
                  className="p-6 text-center border border-dashed rounded-xl cursor-pointer hover:bg-muted/10 transition-colors"
                >
                  <p className="text-xs text-muted-foreground">No holidays found for {currentYear}.</p>
                  <p className="text-[11px] text-primary font-medium mt-1">Click to add holidays</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
