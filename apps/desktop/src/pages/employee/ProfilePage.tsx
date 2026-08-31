import { useEffect, useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { employeesApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { 
  User, Briefcase, MapPin, HeartPulse, ShieldAlert, 
  Mail, Calendar, Clock, IndianRupee, CheckCircle2 
} from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';

export function ProfilePage(): JSX.Element {
  const queryClient = useQueryClient();
  const { data: employee, isLoading } = useQuery({ queryKey: ['employee', 'me'], queryFn: employeesApi.me });
  const [form, setForm] = useState({
    phone: '',
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelation: '',
  });
  const [successMsg, setSuccessMsg] = useState(false);

  useEffect(() => {
    if (employee) {
      setForm({
        phone: employee.phone ?? '',
        address: employee.address ?? '',
        emergencyContactName: employee.emergencyContactName ?? '',
        emergencyContactPhone: employee.emergencyContactPhone ?? '',
        emergencyContactRelation: employee.emergencyContactRelation ?? '',
      });
    }
  }, [employee]);

  const updateMutation = useMutation({
    mutationFn: () => employeesApi.updateMe(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee', 'me'] });
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 3000);
    },
  });

  const shiftInfo = useMemo(() => {
    let shiftName = 'Regular Shift';
    let shiftStart = '10:30';
    let shiftEnd = '19:30';
    let shiftHours = 9.0;

    const latestShift = (employee as any)?.employeeShifts?.[0]?.shift;
    if (latestShift?.startTime && latestShift?.endTime) {
      shiftStart = latestShift.startTime;
      shiftEnd = latestShift.endTime;
      shiftName = latestShift.name || 'Regular Shift';
      const [sh, sm] = shiftStart.split(':').map(Number);
      const [eh, em] = shiftEnd.split(':').map(Number);
      let diffMinutes = ((eh || 0) * 60 + (em || 0)) - ((sh || 0) * 60 + (sm || 0));
      if (diffMinutes <= 0) diffMinutes += 24 * 60;
      shiftHours = diffMinutes / 60;
    }

    const monthlySalary = Number(employee?.baseSalary || 0);
    const perDaySalary = monthlySalary > 0 ? Number((monthlySalary / 30).toFixed(2)) : 0;
    const hourRate = shiftHours > 0 && perDaySalary > 0 ? Number((perDaySalary / shiftHours).toFixed(2)) : 0;

    return { shiftName, shiftStart, shiftEnd, shiftHours, monthlySalary, perDaySalary, hourRate };
  }, [employee]);

  if (isLoading || !employee) {
    return <div className="p-12 text-center text-muted-foreground animate-pulse font-medium">Loading profile…</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">My Profile</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Review employment, shift, compensation and manage contact details.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {successMsg && (
            <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
              <CheckCircle2 size={14} /> Saved successfully
            </span>
          )}
          <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="w-full sm:w-auto">
            {updateMutation.isPending ? 'Saving changes...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Profile Header Card */}
      <Card className="overflow-hidden border-border/60 shadow-sm bg-gradient-to-br from-primary/10 via-primary/5 to-background">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="h-24 w-24 rounded-2xl bg-primary/20 flex items-center justify-center text-primary text-3xl font-bold border-4 border-background shadow-md shrink-0">
              {employee.firstName.charAt(0)}{employee.lastName.charAt(0)}
            </div>
            <div className="flex-1 text-center sm:text-left space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <h3 className="text-2xl font-extrabold text-foreground">{employee.firstName} {employee.lastName}</h3>
                <StatusBadge status={employee.status} />
              </div>
              <p className="text-muted-foreground flex items-center justify-center sm:justify-start gap-2 text-sm font-medium">
                <Briefcase size={16} /> {employee.designation?.title ?? 'No Designation'} · {employee.department?.name ?? 'No Department'}
              </p>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 pt-2 text-xs font-semibold text-muted-foreground">
                <div className="flex items-center gap-1.5 bg-background/60 px-2.5 py-1 rounded-full border border-border/60">
                  <User size={14} className="text-primary" /> Code: {employee.employeeCode}
                </div>
                <div className="flex items-center gap-1.5 bg-background/60 px-2.5 py-1 rounded-full border border-border/60">
                  <Mail size={14} className="text-primary" /> {employee.email}
                </div>
                <div className="flex items-center gap-1.5 bg-background/60 px-2.5 py-1 rounded-full border border-border/60">
                  <Calendar size={14} className="text-primary" /> Joined: {new Date(employee.joiningDate).toLocaleDateString()}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column - Shift & Salary Details */}
        <div className="space-y-6 md:col-span-1">
          {/* Shift Details */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock size={16} className="text-primary" /> Shift Information
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-border/40">
                <span className="text-muted-foreground">Assigned Shift</span>
                <span className="font-semibold text-foreground">{shiftInfo.shiftName}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-border/40">
                <span className="text-muted-foreground">Shift Timing</span>
                <span className="font-semibold text-foreground">{shiftInfo.shiftStart} - {shiftInfo.shiftEnd}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-muted-foreground">Shift Duration</span>
                <span className="font-semibold text-foreground">{shiftInfo.shiftHours} Hours/day</span>
              </div>
            </CardContent>
          </Card>

          {/* Compensation Info */}
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base flex items-center gap-2">
                <IndianRupee size={16} className="text-emerald-600" /> Compensation Details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-border/40">
                <span className="text-muted-foreground">Base Salary</span>
                <span className="font-bold text-foreground">₹{shiftInfo.monthlySalary.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-border/40">
                <span className="text-muted-foreground">Approx. Per-Day Rate</span>
                <span className="font-medium text-foreground">₹{shiftInfo.perDaySalary}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-border/40">
                <span className="text-muted-foreground">Approx. Hourly Rate</span>
                <span className="font-medium text-foreground">₹{shiftInfo.hourRate}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-muted-foreground">Pay Basis</span>
                <span className="font-semibold text-primary">{(employee as any).payType || 'MONTHLY'}</span>
              </div>
            </CardContent>
          </Card>
          
          <div className="bg-muted/40 rounded-xl p-4 text-xs text-muted-foreground flex gap-3 border border-border/60">
            <ShieldAlert size={18} className="shrink-0 text-primary mt-0.5" />
            <p>Official employment, shift, and compensation records are managed by administration. Reach out to HR for updates.</p>
          </div>
        </div>

        {/* Right Column - Editable Contact Forms */}
        <div className="space-y-6 md:col-span-2">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin size={16} className="text-primary" /> Contact & Address Information
              </CardTitle>
              <CardDescription className="text-xs">Update your active phone number and residential address.</CardDescription>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="phone" className="text-xs font-semibold">Phone Number</Label>
                  <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="address" className="text-xs font-semibold">Residential Address</Label>
                  <textarea
                    id="address"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="House/Flat No., Street, Area, City, Pincode"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-colors resize-none"
                    rows={3}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base flex items-center gap-2">
                <HeartPulse size={16} className="text-red-500" /> Emergency Contact
              </CardTitle>
              <CardDescription className="text-xs">Person to contact in case of an urgent requirement or emergency.</CardDescription>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="emergencyContactName" className="text-xs font-semibold">Contact Person Name</Label>
                  <Input
                    id="emergencyContactName"
                    value={form.emergencyContactName}
                    onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
                    placeholder="e.g. Ramesh Patel"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emergencyContactRelation" className="text-xs font-semibold">Relationship</Label>
                  <Input
                    id="emergencyContactRelation"
                    value={form.emergencyContactRelation}
                    onChange={(e) => setForm({ ...form, emergencyContactRelation: e.target.value })}
                    placeholder="Spouse, Parent, Sibling"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emergencyContactPhone" className="text-xs font-semibold">Contact Phone Number</Label>
                  <Input
                    id="emergencyContactPhone"
                    value={form.emergencyContactPhone}
                    onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })}
                    placeholder="+91 98765 43210"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
