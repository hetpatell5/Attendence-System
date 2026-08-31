import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi, attendanceApi, leaveApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { DataTable } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { LucideUsers, LucideCheckCircle, LucideXCircle, LucideClock, LucidePlane, LucideCalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';

function StatTile({ label, value, icon, colorClass }: { label: string; value: number; icon: React.ReactNode; colorClass: string }): JSX.Element {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <div className={cn("p-3 rounded-full", colorClass)}>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminDashboardPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [todayStr, setTodayStr] = useState('');
  
  useEffect(() => {
    const d = new Date();
    setTodayStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }, []);

  const { data, isLoading } = useQuery({ queryKey: ['dashboard', 'admin'], queryFn: dashboardApi.admin });
  
  const { data: todayAttendance, isLoading: isAttendanceLoading } = useQuery({ 
    queryKey: ['attendance', 'today', todayStr], 
    queryFn: () => attendanceApi.listAll({ from: todayStr, to: todayStr, pageSize: '50' }),
    enabled: !!todayStr
  });

  const approveLeave = useMutation({
    mutationFn: (id: string) => leaveApi.approve(id, { note: 'Approved from dashboard' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard', 'admin'] })
  });
  
  const rejectLeave = useMutation({
    mutationFn: (id: string) => leaveApi.reject(id, { reason: 'Rejected from dashboard' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard', 'admin'] })
  });

  if (isLoading || !data) {
    return <p className="text-muted-foreground p-6">Loading dashboard…</p>;
  }

  const maxTrend = Math.max(1, ...data.attendanceTrend.map((t) => t.present + t.absent));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Admin Dashboard</h2>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatTile label="Total Employees" value={data.totalEmployees} icon={<LucideUsers size={20} />} colorClass="bg-blue-500/10 text-blue-500" />
        <StatTile label="Present Today" value={data.presentToday} icon={<LucideCheckCircle size={20} />} colorClass="bg-green-500/10 text-green-500" />
        <StatTile label="Absent Today" value={data.absentToday} icon={<LucideXCircle size={20} />} colorClass="bg-red-500/10 text-red-500" />
        <StatTile label="Late Today" value={data.lateToday} icon={<LucideClock size={20} />} colorClass="bg-yellow-500/10 text-yellow-500" />
        <StatTile label="On Leave" value={data.onLeaveToday} icon={<LucidePlane size={20} />} colorClass="bg-purple-500/10 text-purple-500" />
        <StatTile label="Pending Leaves" value={data.pendingLeaveCount} icon={<LucideCalendarClock size={20} />} colorClass="bg-orange-500/10 text-orange-500" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>7-Day Attendance Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-end gap-2 justify-between pt-4">
              {data.attendanceTrend.map((t) => (
                <div key={t.date} className="flex flex-col items-center gap-2 w-full group">
                  <div className="flex w-full items-end justify-center gap-1 h-32 relative">
                    <div
                      className="w-full max-w-[20px] rounded-t bg-green-500 hover:bg-green-400 transition-colors"
                      style={{ height: `${(t.present / maxTrend) * 100}%` }}
                      title={`Present: ${t.present}`}
                    />
                    <div
                      className="w-full max-w-[20px] rounded-t bg-red-500 hover:bg-red-400 transition-colors"
                      style={{ height: `${(t.absent / maxTrend) * 100}%` }}
                      title={`Absent: ${t.absent}`}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{t.date.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-center gap-4 mt-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-500 rounded-sm"></div> Present</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500 rounded-sm"></div> Absent</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Department Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-52">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left font-medium p-2 rounded-tl">Department</th>
                    <th className="text-right font-medium p-2 text-muted-foreground">Employees</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.departmentSummary.map((d) => (
                    <tr key={d.departmentId} className="hover:bg-muted/30">
                      <td className="p-2">{d.name}</td>
                      <td className="p-2 text-right font-medium">{d.employeeCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.departmentSummary.length === 0 && (
                <p className="text-center text-muted-foreground py-4 text-sm">No departments found.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle>Today's Attendance</CardTitle>
            <Link to="/admin/attendance" className="text-sm text-primary hover:underline font-medium">View All</Link>
          </CardHeader>
          <CardContent className="flex-1">
            <DataTable 
              columns={[
                { key: 'employee', header: 'Employee', render: (r) => <div className="font-medium">{r.employee.firstName} {r.employee.lastName}</div> },
                { key: 'punchInAt', header: 'Punch-In', render: (r) => r.punchInAt ? new Date(r.punchInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--' },
                { key: 'punchOutAt', header: 'Punch-Out', render: (r) => r.punchOutAt ? new Date(r.punchOutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--' },
                { key: 'workedMinutes', header: 'Worked', render: (r) => r.workedMinutes ? `${Math.floor(r.workedMinutes/60)}h ${r.workedMinutes%60}m` : '--' },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> }
              ]} 
              rows={todayAttendance?.items ?? []} 
              getRowKey={(r) => r.id} 
              isLoading={isAttendanceLoading} 
            />
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle>Recent Leave Requests</CardTitle>
            <Link to="/admin/leaves" className="text-sm text-primary hover:underline font-medium">Manage Leaves</Link>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="space-y-4">
              {(data.recentLeaveRequests as any[]).map((r) => (
                <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between border rounded-lg p-3 gap-3 bg-muted/10">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {r.employee.firstName} {r.employee.lastName}
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {r.leaveType?.name || 'Leave'} · {new Date(r.startDate).toLocaleDateString()} to {new Date(r.endDate).toLocaleDateString()}
                    </div>
                  </div>
                  {r.status === 'PENDING' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="h-8 border-green-500/30 text-green-600 hover:bg-green-500/10" 
                        onClick={() => approveLeave.mutate(r.id)} disabled={approveLeave.isPending}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 border-red-500/30 text-red-600 hover:bg-red-500/10"
                        onClick={() => rejectLeave.mutate(r.id)} disabled={rejectLeave.isPending}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {data.recentLeaveRequests.length === 0 && (
                <p className="text-center text-muted-foreground py-8 text-sm">No recent leave requests.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
