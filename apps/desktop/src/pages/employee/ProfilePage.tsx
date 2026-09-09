import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { employeesApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  User, Briefcase, MapPin, HeartPulse, ShieldCheck, 
  Mail, Calendar, Clock, IndianRupee, Phone, Building2
} from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';

export function ProfilePage(): JSX.Element {
  const { data: employee, isLoading } = useQuery({ 
    queryKey: ['employee', 'me'], 
    queryFn: employeesApi.me 
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
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">My Profile</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Official employee details and organization profile.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-muted text-muted-foreground border-border/80 text-xs gap-1.5 py-1 px-3 font-medium rounded-full">
            <ShieldCheck size={13} className="text-primary" />
            <span>Admin Managed Profile</span>
          </Badge>
        </div>
      </div>

      {/* Profile Header Hero Card */}
      <Card className="overflow-hidden border-border/60 shadow-sm bg-gradient-to-br from-primary/10 via-primary/5 to-background">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="h-24 w-24 rounded-2xl bg-primary/20 flex items-center justify-center text-primary text-3xl font-extrabold border-4 border-background shadow-md shrink-0">
              {employee.firstName.charAt(0)}{employee.lastName.charAt(0)}
            </div>

            <div className="flex-1 text-center sm:text-left space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-center sm:justify-start">
                <h3 className="text-2xl font-extrabold text-foreground">
                  {employee.firstName} {employee.lastName}
                </h3>
                <StatusBadge status={employee.status} />
              </div>

              <p className="text-muted-foreground flex items-center justify-center sm:justify-start gap-2 text-sm font-medium">
                <Briefcase size={16} className="text-primary shrink-0" />
                <span>{employee.designation?.title ?? 'Staff'}</span>
                <span>•</span>
                <Building2 size={16} className="text-primary shrink-0" />
                <span>{employee.department?.name ?? 'General'}</span>
              </p>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 pt-1.5 text-xs font-semibold text-muted-foreground">
                <div className="flex items-center gap-1.5 bg-background/80 px-3 py-1 rounded-full border border-border/60 shadow-xs">
                  <User size={13} className="text-primary" />
                  <span>Code: {employee.employeeCode}</span>
                </div>

                <div className="flex items-center gap-1.5 bg-background/80 px-3 py-1 rounded-full border border-border/60 shadow-xs">
                  <Mail size={13} className="text-primary" />
                  <span>{employee.email}</span>
                </div>

                {employee.phone && (
                  <div className="flex items-center gap-1.5 bg-background/80 px-3 py-1 rounded-full border border-border/60 shadow-xs">
                    <Phone size={13} className="text-primary" />
                    <span>{employee.phone}</span>
                  </div>
                )}

                {joinDate && (
                  <div className="flex items-center gap-1.5 bg-background/80 px-3 py-1 rounded-full border border-border/60 shadow-xs">
                    <Calendar size={13} className="text-primary" />
                    <span>Joined: {joinDate}</span>
                  </div>
                )}

                {birthDate && (
                  <div className="flex items-center gap-1.5 bg-background/80 px-3 py-1 rounded-full border border-border/60 shadow-xs">
                    <Calendar size={13} className="text-primary" />
                    <span>DOB: {birthDate}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Card 1: Shift & Timing Details */}
        <Card className="border-border/60 shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock size={16} className="text-primary" /> Shift & Working Hours
            </CardTitle>
            <CardDescription className="text-xs">
              Assigned shift timings and daily schedule
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-3 text-xs">
            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
              <span className="text-muted-foreground font-medium">Assigned Shift</span>
              <span className="font-semibold text-foreground bg-primary/10 text-primary px-2.5 py-0.5 rounded-full">
                {shiftInfo.shiftName}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
              <span className="text-muted-foreground font-medium">Shift Timings</span>
              <span className="font-semibold text-foreground">{shiftInfo.shiftStart} – {shiftInfo.shiftEnd}</span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
              <span className="text-muted-foreground font-medium">Required Working Hours</span>
              <span className="font-semibold text-foreground">{shiftInfo.shiftHours} Hours / day</span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-muted-foreground font-medium">Shift Type</span>
              <span className="font-medium text-foreground">Fixed Hours</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Compensation Overview */}
        <Card className="border-border/60 shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-base flex items-center gap-2">
              <IndianRupee size={16} className="text-emerald-600" /> Compensation & Pay Basis
            </CardTitle>
            <CardDescription className="text-xs">
              Standard compensation structured by administration
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-3 text-xs">
            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
              <span className="text-muted-foreground font-medium">Base Salary</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                ₹{shiftInfo.monthlySalary.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
              <span className="text-muted-foreground font-medium">Approx. Per-Day Rate</span>
              <span className="font-semibold text-foreground">₹{shiftInfo.perDaySalary}</span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
              <span className="text-muted-foreground font-medium">Approx. Hourly Rate</span>
              <span className="font-semibold text-foreground">₹{shiftInfo.hourRate} / hr</span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-muted-foreground font-medium">Pay Type</span>
              <span className="font-semibold text-primary">{(employee as any).payType || 'MONTHLY'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Contact & Residential Address */}
        <Card className="border-border/60 shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin size={16} className="text-primary" /> Contact & Residential Address
            </CardTitle>
            <CardDescription className="text-xs">
              Registered contact numbers and residential location
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-3 text-xs">
            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
              <span className="text-muted-foreground font-medium">Phone Number</span>
              <span className="font-semibold text-foreground">
                {employee.phone || <span className="text-muted-foreground italic">Not provided</span>}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
              <span className="text-muted-foreground font-medium">Email Address</span>
              <span className="font-semibold text-foreground">{employee.email}</span>
            </div>
            <div className="pt-1">
              <span className="text-muted-foreground font-medium block mb-1">Residential Address</span>
              <div className="p-3 bg-muted/25 rounded-xl border border-border/40 text-foreground font-normal leading-relaxed">
                {employee.address ? (
                  employee.address
                ) : (
                  <span className="text-muted-foreground italic">No residential address recorded on file.</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Emergency Contact Information */}
        <Card className="border-border/60 shadow-sm flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-base flex items-center gap-2">
              <HeartPulse size={16} className="text-rose-500" /> Emergency Contact
            </CardTitle>
            <CardDescription className="text-xs">
              Primary person to contact in urgent or medical situations
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-3 text-xs">
            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
              <span className="text-muted-foreground font-medium">Contact Person</span>
              <span className="font-semibold text-foreground">
                {employee.emergencyContactName || <span className="text-muted-foreground italic">Not provided</span>}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-border/40">
              <span className="text-muted-foreground font-medium">Relationship</span>
              <span className="font-semibold text-foreground">
                {employee.emergencyContactRelation || <span className="text-muted-foreground italic">Not provided</span>}
              </span>
            </div>
            <div className="flex justify-between items-center py-1.5">
              <span className="text-muted-foreground font-medium">Emergency Phone</span>
              <span className="font-semibold text-foreground">
                {employee.emergencyContactPhone || <span className="text-muted-foreground italic">Not provided</span>}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Info notice banner */}
      <div className="bg-muted/40 rounded-2xl p-4 text-xs text-muted-foreground flex items-start gap-3 border border-border/60">
        <ShieldCheck size={18} className="shrink-0 text-primary mt-0.5" />
        <p className="leading-relaxed">
          Official employee profiles, shift timings, and compensation records are configured and maintained by company administration. If any personal details, contact numbers, or addresses have changed, please contact HR or your system administrator.
        </p>
      </div>
    </div>
  );
}
