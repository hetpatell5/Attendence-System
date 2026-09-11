import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { employeesApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  MapPin, HeartPulse, 
  Mail, Calendar, Clock, IndianRupee, Phone
} from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';

export function ProfilePage(): JSX.Element {
  const { data: employee, isLoading } = useQuery({ 
    queryKey: ['employee', 'me'], 
    queryFn: employeesApi.me 
  });

  const shiftInfo = useMemo(() => {
    let shiftName = 'Regular Shift';
    let shiftStart = '09:00';
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
    return (
      <div className="flex items-center justify-center p-16 text-muted-foreground animate-pulse font-medium text-sm">
        Loading profile details…
      </div>
    );
  }

  const birthDate = (employee as any).dateOfBirth 
    ? new Date((employee as any).dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const joinDate = employee.joiningDate
    ? new Date(employee.joiningDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <div className="space-y-5 w-full max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border/50">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          My Profile
        </h2>
      </div>

      {/* Profile Header Hero Card */}
      <Card className="border border-border/60 shadow-xs rounded-2xl bg-card p-5 sm:p-6 overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {/* Avatar Icon */}
          <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-xl sm:text-2xl font-bold border border-primary/20 shrink-0 select-none">
            {employee.firstName.charAt(0)}{employee.lastName.charAt(0)}
          </div>

          {/* Name, Role & Core Identifiers */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
                {employee.firstName} {employee.lastName}
              </h3>
              <StatusBadge status={employee.status} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-medium">
              <span>{employee.designation?.title ?? 'Staff'}</span>
              <span>•</span>
              <span>{employee.department?.name ?? 'General'}</span>
              <span>•</span>
              <span className="font-mono text-foreground font-semibold">ID: {employee.employeeCode}</span>
            </div>

            {/* Quick Metadata Row */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Mail size={13} className="text-muted-foreground/70 shrink-0" />
                <span className="text-foreground">{employee.email}</span>
              </div>

              {employee.phone && (
                <div className="flex items-center gap-1.5">
                  <Phone size={13} className="text-muted-foreground/70 shrink-0" />
                  <span className="text-foreground">{employee.phone}</span>
                </div>
              )}

              {joinDate && (
                <div className="flex items-center gap-1.5">
                  <Calendar size={13} className="text-muted-foreground/70 shrink-0" />
                  <span>Joined: <span className="text-foreground font-medium">{joinDate}</span></span>
                </div>
              )}

              {birthDate && (
                <div className="flex items-center gap-1.5">
                  <Calendar size={13} className="text-muted-foreground/70 shrink-0" />
                  <span>DOB: <span className="text-foreground font-medium">{birthDate}</span></span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Profile Details 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 w-full">
        {/* Card 1: Shift & Schedule */}
        <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden">
          <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/50">
            <CardTitle className="text-sm sm:text-base font-bold text-foreground flex items-center gap-2">
              <Clock size={16} className="text-primary" />
              <span>Shift & Working Hours</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-2 divide-y divide-border/40 text-xs">
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Assigned Shift</span>
              <span className="font-semibold text-foreground bg-primary/10 text-primary px-2.5 py-0.5 rounded-full">
                {shiftInfo.shiftName}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Shift Timings</span>
              <span className="font-semibold text-foreground">{shiftInfo.shiftStart} – {shiftInfo.shiftEnd}</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Required Working Hours</span>
              <span className="font-semibold text-foreground">{shiftInfo.shiftHours} Hours / day</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Shift Type</span>
              <span className="font-medium text-foreground">Fixed Hours</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Compensation Overview */}
        <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden">
          <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/50">
            <CardTitle className="text-sm sm:text-base font-bold text-foreground flex items-center gap-2">
              <IndianRupee size={16} className="text-emerald-600" />
              <span>Compensation & Pay Basis</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-2 divide-y divide-border/40 text-xs">
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Base Salary</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                ₹{shiftInfo.monthlySalary.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Approx. Per-Day Rate</span>
              <span className="font-semibold text-foreground">₹{shiftInfo.perDaySalary}</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Approx. Hourly Rate</span>
              <span className="font-semibold text-foreground">₹{shiftInfo.hourRate} / hr</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Pay Type</span>
              <span className="font-semibold text-primary">{(employee as any).payType || 'MONTHLY'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Contact & Address */}
        <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden">
          <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/50">
            <CardTitle className="text-sm sm:text-base font-bold text-foreground flex items-center gap-2">
              <MapPin size={16} className="text-primary" />
              <span>Contact & Address</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-2 divide-y divide-border/40 text-xs">
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Phone Number</span>
              <span className="font-semibold text-foreground">
                {employee.phone || <span className="text-muted-foreground italic">Not provided</span>}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Email Address</span>
              <span className="font-semibold text-foreground">{employee.email}</span>
            </div>
            <div className="py-2.5">
              <span className="text-muted-foreground font-medium block mb-1.5">Residential Address</span>
              <div className="p-2.5 bg-muted/30 rounded-xl border border-border/40 text-foreground font-normal leading-relaxed">
                {employee.address ? (
                  employee.address
                ) : (
                  <span className="text-muted-foreground italic">No residential address recorded on file.</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Emergency Contact */}
        <Card className="border border-border/60 shadow-xs rounded-2xl bg-card overflow-hidden">
          <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/50">
            <CardTitle className="text-sm sm:text-base font-bold text-foreground flex items-center gap-2">
              <HeartPulse size={16} className="text-rose-500" />
              <span>Emergency Contact</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-2 divide-y divide-border/40 text-xs">
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Contact Person</span>
              <span className="font-semibold text-foreground">
                {employee.emergencyContactName || <span className="text-muted-foreground italic">Not provided</span>}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Relationship</span>
              <span className="font-semibold text-foreground">
                {employee.emergencyContactRelation || <span className="text-muted-foreground italic">Not provided</span>}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-muted-foreground font-medium">Emergency Phone</span>
              <span className="font-semibold text-foreground">
                {employee.emergencyContactPhone || <span className="text-muted-foreground italic">Not provided</span>}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
