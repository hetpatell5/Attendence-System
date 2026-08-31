import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { employeesApi, shiftsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialog, DialogTitle, DialogContent } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/StatusBadge';
import { 
  Search, 
  UserPlus, 
  User, 
  Calendar, 
  IndianRupee, 
  Key, 
  Eye, 
  Pencil, 
  BarChart2, 
  Trash2, 
  RotateCcw,
} from 'lucide-react';
import type { Employee } from '@attendance/shared';

const emptyForm = {
  fullName: '',
  email: '',
  phone: '',
  alternatePhone: '',
  joiningDate: '',
  dateOfBirth: '',
  departmentId: '',
  designationId: '',
  shiftId: '',
  baseSalary: '',
  targetSalary: '',
  monthlyIncrement: '',
  incrementInterval: '1',
  incrementEffectiveFrom: '',
  address: '',
  username: '',
  temporaryPassword: '',
};

export function EmployeesPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [shiftFilter, setShiftFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: employeesData, isLoading } = useQuery({
    queryKey: ['employees', debouncedSearch, statusFilter, page],
    queryFn: () => employeesApi.list({ 
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(statusFilter !== 'ALL' && { status: statusFilter }),
      page: page.toString(),
      pageSize: '200'
    }),
  });
  
  const { data: shifts = [] } = useQuery({ queryKey: ['shifts'], queryFn: shiftsApi.list });

  const createMutation = useMutation({
    mutationFn: () =>
      employeesApi.create({
        ...form,
        baseSalary: form.baseSalary ? Number(form.baseSalary) : undefined,
        targetSalary: form.targetSalary ? Number(form.targetSalary) : undefined,
        monthlyIncrement: form.monthlyIncrement ? Number(form.monthlyIncrement) : undefined,
        incrementInterval: form.incrementInterval ? Number(form.incrementInterval) : 1,
        departmentId: form.departmentId || undefined,
        designationId: form.designationId || undefined,
        shiftId: form.shiftId || undefined,
        createLogin: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      setDialogOpen(false);
      setForm(emptyForm);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => employeesApi.deactivate(id, 'Deactivated by admin from employees list'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => employeesApi.reactivate(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => employeesApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err: any) => {
      alert(err?.message || 'Failed to delete employee');
    }
  });

  const handleDeleteEmployee = (e: React.MouseEvent, employee: Employee) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete ${employee.firstName} ${employee.lastName}? This will permanently delete this employee and all their records.`)) {
      deleteMutation.mutate(employee.id);
    }
  };

  const handleToggleStatus = (e: React.MouseEvent, employee: Employee) => {
    e.stopPropagation();
    const isCurrentlyActive = employee.status === 'ACTIVE';
    const confirmMsg = isCurrentlyActive 
      ? `Are you sure you want to deactivate ${employee.firstName} ${employee.lastName}?`
      : `Are you sure you want to reactivate ${employee.firstName} ${employee.lastName}?`;
    
    if (window.confirm(confirmMsg)) {
      if (isCurrentlyActive) {
        deactivateMutation.mutate(employee.id);
      } else {
        reactivateMutation.mutate(employee.id);
      }
    }
  };

  // Filter items by shift if selected
  const filteredEmployees = useMemo(() => {
    if (!employeesData?.items) return [];
    let items = employeesData.items;
    if (shiftFilter !== 'ALL') {
      items = items.filter(emp => {
        const empShiftId = (emp as any).employeeShifts?.[0]?.shiftId ?? (emp as any).shiftId;
        return empShiftId === shiftFilter;
      });
    }
    return items;
  }, [employeesData?.items, shiftFilter]);

  // Calculate total monthly salary of active employees in the list
  const totalMonthlySalary = useMemo(() => {
    return filteredEmployees.reduce((acc, emp) => {
      if (emp.status === 'ACTIVE') {
        return acc + Number(emp.baseSalary || 0);
      }
      return acc;
    }, 0);
  }, [filteredEmployees]);

  const handleResetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('ALL');
    setShiftFilter('ALL');
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Manage Employees</h2>
          <p className="text-sm text-muted-foreground mt-0.5">View, edit, track performance, or manage your workforce.</p>
        </div>
        <Button 
          onClick={() => setDialogOpen(true)} 
          className="w-full sm:w-auto font-semibold shadow-md shadow-primary/20 flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" /> Add Employee
        </Button>
      </div>

      {/* Filters Bar */}
      <div className="p-4 bg-card border rounded-xl shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-center">
          {/* Search Input */}
          <div className="flex items-center space-x-2 bg-background border rounded-lg px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              placeholder="Search by name, code, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground w-full"
            />
          </div>

          {/* Status Filter */}
          <Select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="w-full bg-background rounded-lg font-medium"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
          </Select>

          {/* Shift Filter */}
          <Select 
            value={shiftFilter} 
            onChange={(e) => setShiftFilter(e.target.value)}
            className="w-full bg-background rounded-lg font-medium"
          >
            <option value="ALL">All Shifts</option>
            {shifts.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.startTime} - {s.endTime})</option>
            ))}
          </Select>

          {/* Reset Filter Button */}
          <Button 
            variant="outline" 
            onClick={handleResetFilters}
            className="w-full font-medium flex items-center justify-center gap-2 border-slate-200 dark:border-slate-700 hover:bg-muted"
          >
            <RotateCcw className="w-4 h-4 text-muted-foreground" /> Reset Filters
          </Button>
        </div>
      </div>

      {/* Table Container */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-muted/50 border-b border-border/80 uppercase text-[11px] font-semibold text-muted-foreground tracking-wider">
              <tr>
                <th className="py-3 px-4">ID</th>
                <th className="py-3 px-4">Full Name</th>
                <th className="py-3 px-4">Mobile</th>
                <th className="py-3 px-4">Shift</th>
                <th className="py-3 px-4">Salary</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary mb-2"></div>
                    <p>Loading employees...</p>
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    No employees found matching filter criteria.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => {
                  const shiftName = (emp as any).employeeShifts?.[0]?.shift?.name ?? (emp as any).shift?.name ?? '—';
                  const isActive = emp.status === 'ACTIVE';

                  return (
                    <tr 
                      key={emp.id} 
                      className="hover:bg-muted/40 transition-colors group cursor-pointer"
                      onClick={() => navigate(`/admin/employees/${emp.id}`)}
                    >
                      {/* ID / Code */}
                      <td className="py-3.5 px-4 font-mono text-xs font-semibold text-muted-foreground">
                        {emp.employeeCode}
                      </td>

                      {/* Full Name */}
                      <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                        {emp.firstName} {emp.lastName}
                      </td>

                      {/* Mobile */}
                      <td className="py-3.5 px-4 text-muted-foreground">
                        {emp.phone || '—'}
                      </td>

                      {/* Shift */}
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {shiftName}
                        </span>
                      </td>

                      {/* Salary */}
                      <td className="py-3.5 px-4 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        ₹{Number(emp.baseSalary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Status Toggle */}
                      <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => handleToggleStatus(e, emp)}
                          title={`Click to ${isActive ? 'deactivate' : 'reactivate'}`}
                          className="cursor-pointer transition-transform active:scale-95"
                        >
                          <StatusBadge status={emp.status} />
                        </button>
                      </td>

                      {/* 5 Action Buttons matching old system */}
                      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {/* 1. View Details (Emerald) */}
                          <button
                            type="button"
                            onClick={() => navigate(`/admin/employees/${emp.id}`)}
                            className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-colors"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* 2. Edit Profile (Sky) */}
                          <button
                            type="button"
                            onClick={() => navigate(`/admin/employees/${emp.id}?edit=true`)}
                            className="p-1.5 rounded-lg bg-sky-500/10 text-sky-600 hover:bg-sky-500/20 dark:text-sky-400 transition-colors"
                            title="Edit Employee"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>

                          {/* 3. Performance / Attendance (Indigo) */}
                          <button
                            type="button"
                            onClick={() => navigate(`/admin/attendance?employee_id=${emp.id}`)}
                            className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 dark:text-indigo-400 transition-colors"
                            title="View Attendance / Performance"
                          >
                            <BarChart2 className="w-4 h-4" />
                          </button>

                          {/* 4. Salary / Salary Card (Amber) */}
                          <button
                            type="button"
                            onClick={() => navigate(`/admin/salary?employeeId=${emp.id}`)}
                            className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400 transition-colors"
                            title="View Salary Card"
                          >
                            <IndianRupee className="w-4 h-4" />
                          </button>

                          {/* 5. Delete (Rose) */}
                          <button
                            type="button"
                            onClick={(e) => handleDeleteEmployee(e, emp)}
                            className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400 transition-colors"
                            title="Delete Employee"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Total Monthly Salary Footer Row like Old System */}
            {filteredEmployees.length > 0 && (
              <tfoot className="bg-muted/40 font-bold border-t border-border">
                <tr>
                  <td colSpan={4} className="py-3 px-4 text-right text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Total Active Monthly Salary:
                  </td>
                  <td className="py-3 px-4 font-mono text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                    ₹{totalMonthlySalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td colSpan={2} className="py-3 px-4 text-right text-xs text-muted-foreground">
                    {filteredEmployees.length} employee{filteredEmployees.length !== 1 ? 's' : ''} listed
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-background border border-border shadow-2xl rounded-2xl">
          <div className="px-8 py-5 border-b bg-muted/40 flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-primary" /> Register New Employee
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Fill in the employee's personal details, salary structure, and system login account.
              </p>
            </div>
          </div>

          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column: Personal Information */}
              <div className="space-y-5">
                <div className="flex items-center gap-2 pb-2 border-b">
                  <User className="w-4 h-4 text-primary" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Personal Information</h3>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="fullName" className="text-xs font-semibold">Full Name <span className="text-destructive">*</span></Label>
                    <Input
                      id="fullName"
                      value={form.fullName}
                      onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                      placeholder="e.g. Rahul Sharma"
                      required
                      className="h-9"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="phone" className="text-xs font-semibold">Mobile Number <span className="text-destructive">*</span></Label>
                      <Input
                        id="phone"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        placeholder="9876543210"
                        required
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="alternatePhone" className="text-xs font-semibold">Alternate Phone</Label>
                      <Input
                        id="alternatePhone"
                        value={form.alternatePhone}
                        onChange={(e) => setForm({ ...form, alternatePhone: e.target.value })}
                        placeholder="Optional"
                        className="h-9"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="email" className="text-xs font-semibold">Email Address <span className="text-destructive">*</span></Label>
                      <Input
                        id="email"
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        placeholder="name@company.com"
                        required
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="dateOfBirth" className="text-xs font-semibold">Date of Birth <span className="text-destructive">*</span></Label>
                      <Input
                        id="dateOfBirth"
                        type="date"
                        value={form.dateOfBirth}
                        onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                        required
                        className="h-9"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="address" className="text-xs font-semibold">Full Residential Address</Label>
                    <textarea
                      id="address"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      placeholder="Street, City, Pincode"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary transition-colors resize-none"
                      rows={3}
                    />
                  </div>
                </div>
              </div>

              {/* Right Column: Employment, Salary & Login */}
              <div className="space-y-5">
                {/* Employment & Shift */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b">
                    <Calendar className="w-4 h-4 text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Employment & Shift</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="joiningDate" className="text-xs font-semibold">Joining Date <span className="text-destructive">*</span></Label>
                      <Input
                        id="joiningDate"
                        type="date"
                        value={form.joiningDate}
                        onChange={(e) => setForm({ ...form, joiningDate: e.target.value })}
                        required
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="shiftId" className="text-xs font-semibold">Assigned Shift <span className="text-destructive">*</span></Label>
                      <Select
                        id="shiftId"
                        value={form.shiftId}
                        onChange={(e) => setForm({ ...form, shiftId: e.target.value })}
                        className="h-9"
                      >
                        <option value="">— Select Shift —</option>
                        {shifts.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.startTime} - {s.endTime})</option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Salary & Increment Configuration */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b">
                    <IndianRupee className="w-4 h-4 text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Salary & Increments</h3>
                  </div>

                  <div className="p-3.5 bg-muted/30 border rounded-xl space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="baseSalary" className="text-xs font-semibold text-primary">Monthly Salary (₹) <span className="text-destructive">*</span></Label>
                        <Input
                          id="baseSalary"
                          type="number"
                          step="0.01"
                          value={form.baseSalary}
                          onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
                          placeholder="0.00"
                          required
                          className="h-9 bg-background font-medium"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="targetSalary" className="text-xs font-semibold">Target Salary (₹)</Label>
                        <Input
                          id="targetSalary"
                          type="number"
                          step="0.01"
                          value={form.targetSalary}
                          onChange={(e) => setForm({ ...form, targetSalary: e.target.value })}
                          placeholder="0.00"
                          className="h-9 bg-background"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="monthlyIncrement" className="text-[11px] font-semibold">Increment (₹)</Label>
                        <Input
                          id="monthlyIncrement"
                          type="number"
                          step="0.01"
                          value={form.monthlyIncrement}
                          onChange={(e) => setForm({ ...form, monthlyIncrement: e.target.value })}
                          placeholder="0.00"
                          className="h-9 bg-background"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="incrementInterval" className="text-[11px] font-semibold">Interval (Mo) <span className="text-destructive">*</span></Label>
                        <Input
                          id="incrementInterval"
                          type="number"
                          min="1"
                          value={form.incrementInterval}
                          onChange={(e) => setForm({ ...form, incrementInterval: e.target.value })}
                          required
                          className="h-9 bg-background"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="incrementEffectiveFrom" className="text-[11px] font-semibold">Effective</Label>
                        <Input
                          id="incrementEffectiveFrom"
                          type="month"
                          value={form.incrementEffectiveFrom}
                          onChange={(e) => setForm({ ...form, incrementEffectiveFrom: e.target.value })}
                          className="h-9 bg-background text-xs px-2"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Login Credentials */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b">
                    <Key className="w-4 h-4 text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Portal Login Credentials</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="username" className="text-xs font-semibold">Username <span className="text-destructive">*</span></Label>
                      <Input
                        id="username"
                        value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value })}
                        placeholder="e.g. rahul"
                        required
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="temporaryPassword" className="text-xs font-semibold">Initial Password <span className="text-destructive">*</span></Label>
                      <Input
                        id="temporaryPassword"
                        type="password"
                        value={form.temporaryPassword}
                        onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })}
                        placeholder="••••••••"
                        required
                        className="h-9"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-8 py-4 border-t bg-muted/30 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Fields marked with <span className="text-destructive">*</span> are required.
            </p>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="px-6 font-medium shadow-md shadow-primary/25 hover:shadow-primary/40 transition-all"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !form.fullName || !form.phone || !form.email || !form.username || !form.temporaryPassword || !form.baseSalary || !form.shiftId}
              >
                {createMutation.isPending ? 'Creating...' : 'Register Employee'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
