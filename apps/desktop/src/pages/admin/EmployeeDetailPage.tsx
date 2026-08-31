import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { employeesApi, attendanceApi, leaveApi, salaryApi, departmentsApi, designationsApi, shiftsApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/StatusBadge';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { User, Calendar, Clock, Banknote, Edit, Save, X, Key } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Attendance, LeaveRequest, SalaryRecord } from '@attendance/shared';

type Tab = 'profile' | 'attendance' | 'leaves' | 'salary';

export function EmployeeDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('profile');
  const [isEditing, setIsEditing] = useState(searchParams.get('edit') === 'true');
  
  const [editForm, setEditForm] = useState<any>({});
  const [passwordForm, setPasswordForm] = useState('');
  const [usernameForm, setUsernameForm] = useState('');

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => employeesApi.get(id!),
    enabled: !!id,
  });

  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: departmentsApi.list });
  const { data: designations = [] } = useQuery({ queryKey: ['designations'], queryFn: designationsApi.list });
  const { data: shifts = [] } = useQuery({ queryKey: ['shifts'], queryFn: shiftsApi.list });

  useEffect(() => {
    if (employee && !isEditing) {
      const userAccount = (employee as any).user;
      const currentUsername = userAccount?.username || userAccount?.email || '';
      setEditForm({
        fullName: `${employee.firstName} ${employee.lastName}`.trim(),
        email: employee.email,
        phone: employee.phone || '',
        alternatePhone: employee.alternatePhone || '',
        address: employee.address || '',
        dateOfBirth: employee.dateOfBirth ? new Date(employee.dateOfBirth).toISOString().split('T')[0] : '',
        joiningDate: employee.joiningDate ? new Date(employee.joiningDate).toISOString().split('T')[0] : '',
        baseSalary: employee.baseSalary || '',
        targetSalary: employee.targetSalary || '',
        monthlyIncrement: employee.monthlyIncrement || '',
        incrementInterval: employee.incrementInterval?.toString() || '1',
        incrementEffectiveFrom: employee.incrementEffectiveFrom ? new Date(employee.incrementEffectiveFrom).toISOString().slice(0, 7) : '',
        departmentId: employee.departmentId || '',
        designationId: employee.designationId || '',
        shiftId: (employee as any).employeeShifts?.[0]?.shiftId ?? '',
        username: currentUsername,
        password: '',
      });
      setUsernameForm(currentUsername);
    }
  }, [employee?.id, isEditing]);

  const { data: attendance = [], isLoading: isAttendanceLoading } = useQuery({
    queryKey: ['attendance', 'employee', id],
    queryFn: () => attendanceApi.listAll({ employeeId: id!, pageSize: '30' }).then((r) => r.items),
    enabled: !!id && tab === 'attendance',
  });

  const { data: leaves, isLoading: isLeavesLoading } = useQuery({
    queryKey: ['leaves', 'employee', id],
    queryFn: () => leaveApi.listAll({ employeeId: id! }),
    enabled: !!id && tab === 'leaves',
  });

  const { data: salary, isLoading: isSalaryLoading } = useQuery({
    queryKey: ['salary', 'employee', id],
    queryFn: () => salaryApi.listAll({ employeeId: id! }),
    enabled: !!id && tab === 'salary',
  });

  const deactivateMutation = useMutation({
    mutationFn: (reason: string) => employeesApi.deactivate(id!, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employee', id] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: () => employeesApi.reactivate(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employee', id] }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...editForm };
      const usernameToUpdate = payload.username;
      const passwordToUpdate = payload.password;
      delete payload.username;
      delete payload.password;

      Object.keys(payload).forEach(key => {
        if (payload[key] === '') payload[key] = undefined;
      });
      if (payload.baseSalary !== undefined) payload.baseSalary = Number(payload.baseSalary);
      if (payload.targetSalary !== undefined) payload.targetSalary = Number(payload.targetSalary);
      if (payload.monthlyIncrement !== undefined) payload.monthlyIncrement = Number(payload.monthlyIncrement);
      if (payload.incrementInterval !== undefined) payload.incrementInterval = Number(payload.incrementInterval);
      
      const res = await employeesApi.update(id!, payload);

      if (usernameToUpdate || passwordToUpdate) {
        await employeesApi.updateAccount(id!, { 
          username: usernameToUpdate || undefined, 
          password: passwordToUpdate || undefined 
        });
      }

      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee', id] });
      setIsEditing(false);
    },
    onError: (err: any) => {
      alert(err?.message || 'Failed to update employee details');
    }
  });

  const updateAccountMutation = useMutation({
    mutationFn: () => employeesApi.updateAccount(id!, { username: usernameForm, password: passwordForm }),
    onSuccess: () => {
      setPasswordForm('');
      queryClient.invalidateQueries({ queryKey: ['employee', id] });
      alert('Account credentials updated successfully');
    },
    onError: (err: any) => {
      alert(err?.message || 'Failed to update account credentials');
    }
  });

  if (isLoading || !employee) {
    return <p className="text-muted-foreground p-6">Loading employee details…</p>;
  }

  const attendanceColumns: DataTableColumn<Attendance>[] = [
    { key: 'attendanceDate', header: 'Date', render: (r) => new Date(r.attendanceDate).toLocaleDateString() },
    { key: 'punchIn', header: 'Punch-In', render: (r) => r.punchInAt ? new Date(r.punchInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--' },
    { key: 'punchOut', header: 'Punch-Out', render: (r) => r.punchOutAt ? new Date(r.punchOutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--' },
    { key: 'workedMinutes', header: 'Worked', render: (r) => r.workedMinutes ? `${Math.floor(r.workedMinutes/60)}h ${r.workedMinutes%60}m` : '--' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const leaveColumns: DataTableColumn<LeaveRequest & any>[] = [
    { key: 'type', header: 'Type', render: (r) => r.leaveType?.name ?? '—' },
    { key: 'startDate', header: 'From', render: (r) => new Date(r.startDate).toLocaleDateString() },
    { key: 'endDate', header: 'To', render: (r) => new Date(r.endDate).toLocaleDateString() },
    { key: 'days', header: 'Days', render: (r) => r.totalDays },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const salaryColumns: DataTableColumn<SalaryRecord>[] = [
    { key: 'month', header: 'Month', render: (r) => new Date(r.month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) },
    { key: 'basic', header: 'Basic', render: (r) => `₹${r.basicSalary}` },
    { key: 'net', header: 'Net Salary', render: (r) => `₹${r.netSalary}` },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'action', header: 'Slip', render: (r) => (
      <Button variant="outline" size="sm" onClick={() => window.open(`/api/salary/${r.id}/slip`, '_blank')}>Download</Button>
    )},
  ];

  const tabs = [
    { id: 'profile', label: 'Profile', icon: <User size={16} /> },
    { id: 'attendance', label: 'Attendance', icon: <Clock size={16} /> },
    { id: 'leaves', label: 'Leaves', icon: <Calendar size={16} /> },
    { id: 'salary', label: 'Salary', icon: <Banknote size={16} /> },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => navigate('/admin/employees')}>
          ← Back
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Employee Details</h2>
      </div>

      <Card className="overflow-hidden">
        <div className="bg-muted/50 p-6 flex flex-col md:flex-row items-center md:items-start gap-6 border-b">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-4xl shadow-sm border border-primary/20 shrink-0">
            {employee.firstName[0]}{employee.lastName[0]}
          </div>
          <div className="flex-1 text-center md:text-left">
            <h2 className="text-2xl font-bold">{employee.firstName} {employee.lastName}</h2>
            <p className="text-muted-foreground flex items-center justify-center md:justify-start gap-2 mt-1">
              {employee.designation?.title ?? 'No Designation'} · {employee.department?.name ?? 'No Department'}
              <StatusBadge status={employee.status} />
            </p>
            <div className="flex flex-wrap gap-4 mt-4 justify-center md:justify-start text-sm">
              <div><span className="text-muted-foreground">Code:</span> <span className="font-medium">{employee.employeeCode}</span></div>
              <div><span className="text-muted-foreground">Email:</span> <span className="font-medium">{employee.email}</span></div>
              <div className="font-medium">{(employee as any).shift?.name ?? '—'}</div>
              <div><span className="text-muted-foreground">Joined:</span> <span className="font-medium">{new Date(employee.joiningDate).toLocaleDateString()}</span></div>
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {employee.status === 'ACTIVE' ? (
              <Button size="sm" variant="destructive" onClick={() => {
                const reason = window.prompt('Reason for deactivation:');
                if (reason) deactivateMutation.mutate(reason);
              }}>
                Deactivate Employee
              </Button>
            ) : (
              <Button size="sm" variant="default" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => reactivateMutation.mutate()}>
                Reactivate Employee
              </Button>
            )}
          </div>
        </div>

        <div className="flex overflow-x-auto border-b">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap",
                tab === t.id ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <CardContent className="p-6">
          {tab === 'profile' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Personal Information</h3>
                  {!isEditing ? (
                    <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                      <Edit className="w-4 h-4 mr-2" /> Edit Profile
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                        <X className="w-4 h-4 mr-2" /> Cancel
                      </Button>
                      <Button variant="default" size="sm" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                        <Save className="w-4 h-4 mr-2" /> Save Changes
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                  <div className="space-y-2 col-span-1 sm:col-span-2">
                    <Label>Full Name</Label>
                    {isEditing ? (
                      <Input value={editForm.fullName} onChange={e => setEditForm({...editForm, fullName: e.target.value})} />
                    ) : (
                      <div className="p-2 bg-muted/30 rounded-md border text-sm">{employee.firstName} {employee.lastName}</div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Mobile Number</Label>
                    {isEditing ? (
                      <Input value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} />
                    ) : (
                      <div className="p-2 bg-muted/30 rounded-md border text-sm">{employee.phone || '—'}</div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Alternate Number</Label>
                    {isEditing ? (
                      <Input value={editForm.alternatePhone} onChange={e => setEditForm({...editForm, alternatePhone: e.target.value})} />
                    ) : (
                      <div className="p-2 bg-muted/30 rounded-md border text-sm">{employee.alternatePhone || '—'}</div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    {isEditing ? (
                      <Input value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} />
                    ) : (
                      <div className="p-2 bg-muted/30 rounded-md border text-sm">{employee.email}</div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Date of Birth</Label>
                    {isEditing ? (
                      <Input type="date" value={editForm.dateOfBirth} onChange={e => setEditForm({...editForm, dateOfBirth: e.target.value})} />
                    ) : (
                      <div className="p-2 bg-muted/30 rounded-md border text-sm">
                        {employee.dateOfBirth ? new Date(employee.dateOfBirth).toLocaleDateString() : '—'}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Joining Date</Label>
                    {isEditing ? (
                      <Input type="date" value={editForm.joiningDate} onChange={e => setEditForm({...editForm, joiningDate: e.target.value})} />
                    ) : (
                      <div className="p-2 bg-muted/30 rounded-md border text-sm">
                        {employee.joiningDate ? new Date(employee.joiningDate).toLocaleDateString() : '—'}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Shift</Label>
                    {isEditing ? (
                      <Select value={editForm.shiftId} onChange={e => setEditForm({...editForm, shiftId: e.target.value})}>
                        <option value="">—</option>
                        {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </Select>
                    ) : (
                      <div className="p-2 bg-muted/30 rounded-md border text-sm">{(employee as any).employeeShifts?.[0]?.shift?.name || '—'}</div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Department</Label>
                    {isEditing ? (
                      <Select value={editForm.departmentId} onChange={e => setEditForm({...editForm, departmentId: e.target.value})}>
                        <option value="">—</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </Select>
                    ) : (
                      <div className="p-2 bg-muted/30 rounded-md border text-sm">{employee.department?.name || '—'}</div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Designation</Label>
                    {isEditing ? (
                      <Select value={editForm.designationId} onChange={e => setEditForm({...editForm, designationId: e.target.value})}>
                        <option value="">—</option>
                        {designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                      </Select>
                    ) : (
                      <div className="p-2 bg-muted/30 rounded-md border text-sm">{employee.designation?.title || '—'}</div>
                    )}
                  </div>

                  {/* Salary Fields */}
                  <div className="col-span-1 sm:col-span-2 mt-4 pt-4 border-t space-y-4">
                    <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Salary Configuration</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Monthly Salary (₹)</Label>
                        {isEditing ? (
                          <Input type="number" step="0.01" value={editForm.baseSalary} onChange={e => setEditForm({...editForm, baseSalary: e.target.value})} />
                        ) : (
                          <div className="p-2 bg-muted/30 rounded-md border text-sm">₹{employee.baseSalary || '—'}</div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Target Salary (₹)</Label>
                        {isEditing ? (
                          <Input type="number" step="0.01" value={editForm.targetSalary} onChange={e => setEditForm({...editForm, targetSalary: e.target.value})} />
                        ) : (
                          <div className="p-2 bg-muted/30 rounded-md border text-sm">
                            {employee.targetSalary ? `₹${employee.targetSalary}` : '—'}
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Monthly Increment (₹)</Label>
                        {isEditing ? (
                          <Input type="number" step="0.01" value={editForm.monthlyIncrement} onChange={e => setEditForm({...editForm, monthlyIncrement: e.target.value})} />
                        ) : (
                          <div className="p-2 bg-muted/30 rounded-md border text-sm">
                            {employee.monthlyIncrement ? `₹${employee.monthlyIncrement}` : '—'}
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Increment Interval (Months)</Label>
                        {isEditing ? (
                          <Input type="number" value={editForm.incrementInterval} onChange={e => setEditForm({...editForm, incrementInterval: e.target.value})} />
                        ) : (
                          <div className="p-2 bg-muted/30 rounded-md border text-sm">
                            {employee.incrementInterval || '—'}
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Increment Effective From</Label>
                        {isEditing ? (
                          <Input type="month" value={editForm.incrementEffectiveFrom} onChange={e => setEditForm({...editForm, incrementEffectiveFrom: e.target.value})} />
                        ) : (
                          <div className="p-2 bg-muted/30 rounded-md border text-sm">
                            {employee.incrementEffectiveFrom ? new Date(employee.incrementEffectiveFrom).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : '—'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 col-span-1 sm:col-span-2 mt-4 pt-4 border-t">
                    <Label>Full Address</Label>
                    {isEditing ? (
                      <textarea
                        value={editForm.address}
                        onChange={e => setEditForm({...editForm, address: e.target.value})}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        rows={3}
                      />
                    ) : (
                      <div className="p-3 bg-muted/30 rounded-md border text-sm whitespace-pre-wrap">{employee.address || '—'}</div>
                    )}
                  </div>

                  {/* Account Login Credentials */}
                  <div className="col-span-1 sm:col-span-2 mt-4 pt-4 border-t space-y-4">
                    <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <Key className="w-4 h-4 text-primary" /> Login Credentials
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Username (Login ID)</Label>
                        {isEditing ? (
                          <Input 
                            type="text"
                            value={editForm.username ?? ''} 
                            onChange={e => setEditForm({...editForm, username: e.target.value})} 
                            placeholder="e.g. rahul"
                          />
                        ) : (
                          <div className="p-2 bg-muted/30 rounded-md border text-sm font-mono">
                            {(employee as any).user?.username || (employee as any).user?.email || '— No account'}
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Password</Label>
                        {isEditing ? (
                          <Input 
                            type="text"
                            value={editForm.password ?? ''} 
                            onChange={e => setEditForm({...editForm, password: e.target.value})} 
                            placeholder="Leave blank to keep old password"
                          />
                        ) : (
                          <div className="p-2 bg-muted/30 rounded-md border text-sm text-muted-foreground">
                            ••••••••
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-4 border-b">
                    <CardTitle className="text-base flex items-center gap-2"><Key size={16} /> Quick Account Update</CardTitle>
                    <CardDescription>Directly update this employee's username & password.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-4">
                    <div className="space-y-2">
                      <Label>Username (Login ID)</Label>
                      <Input 
                        type="text" 
                        value={usernameForm} 
                        onChange={e => setUsernameForm(e.target.value)} 
                        placeholder="E.g. admin" 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>New Password</Label>
                      <Input 
                        type="text" 
                        value={passwordForm} 
                        onChange={e => setPasswordForm(e.target.value)} 
                        placeholder="Leave blank to keep old password" 
                      />
                    </div>
                    <Button 
                      className="w-full font-semibold shadow-sm" 
                      onClick={() => updateAccountMutation.mutate()} 
                      disabled={updateAccountMutation.isPending || (!usernameForm && !passwordForm)}
                    >
                      {updateAccountMutation.isPending ? 'Updating...' : 'Save Credentials'}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {tab === 'attendance' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Attendance Log</h3>
              </div>
              <DataTable columns={attendanceColumns} rows={attendance} getRowKey={(r) => r.id} isLoading={isAttendanceLoading} />
            </div>
          )}

          {tab === 'leaves' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Leave History</h3>
              </div>
              <DataTable columns={leaveColumns} rows={leaves?.items || []} getRowKey={(r) => r.id} isLoading={isLeavesLoading} />
            </div>
          )}

          {tab === 'salary' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Salary Slips</h3>
              </div>
              <DataTable columns={salaryColumns} rows={salary?.items || []} getRowKey={(r) => r.id} isLoading={isSalaryLoading} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
