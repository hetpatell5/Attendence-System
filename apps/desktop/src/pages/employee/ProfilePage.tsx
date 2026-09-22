import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { employeesApi } from '@/lib/api';
import { 
  MapPin, HeartPulse, 
  Mail, Calendar, Clock, IndianRupee, Phone
} from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { to12h } from '@/lib/utils';

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
    <div className="relative space-y-6 max-w-7xl mx-auto pb-10">
      {/* Ambient background glow accents for rich claymorphism depth */}
      <div className="absolute -top-12 -right-12 -z-10 w-96 h-96 bg-emerald-100/35 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-48 -left-12 -z-10 w-96 h-96 bg-sky-100/35 rounded-full blur-3xl pointer-events-none" />

      {/* Page Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200/70">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
            My Profile
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">
            Personal employee credentials, assigned shift details, and compensation.
          </p>
        </div>
      </div>

      {/* Profile Header Hero Card */}
      <div className="clay-card p-6 sm:p-7 relative overflow-hidden transition-all">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          {/* Avatar Icon */}
          <div className="clay-pod h-20 w-20 sm:h-24 sm:w-24 rounded-3xl flex items-center justify-center text-2xl sm:text-3xl font-black text-emerald-700 border-2 border-emerald-500/30 shrink-0 select-none shadow-[inset_0_2px_6px_rgba(255,255,255,0.9),0_6px_16px_rgba(16,185,129,0.12)]">
            {employee.firstName.charAt(0)}{employee.lastName.charAt(0)}
          </div>

          {/* Name, Role & Core Identifiers */}
          <div className="flex-1 min-w-0 space-y-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight truncate">
                {employee.firstName} {employee.lastName}
              </h3>
              <StatusBadge status={employee.status} />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
              <span className="clay-pod px-3 py-1 text-slate-800 font-bold">{employee.designation?.title ?? 'Staff'}</span>
              <span className="clay-pod px-3 py-1 text-slate-600">{employee.department?.name ?? 'General'}</span>
              <span className="clay-pod px-3 py-1 font-mono text-emerald-700 font-bold border border-emerald-500/30">ID: {employee.employeeCode}</span>
            </div>

            {/* Quick Metadata Row */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <Mail size={14} className="text-slate-400 shrink-0" />
                <span className="text-slate-800 font-semibold">{employee.email}</span>
              </div>

              {employee.phone && (
                <div className="flex items-center gap-1.5">
                  <Phone size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-800 font-semibold">{employee.phone}</span>
                </div>
              )}

              {joinDate && (
                <div className="flex items-center gap-1.5">
                  <Calendar size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-500">Joined: <span className="text-slate-900 font-bold">{joinDate}</span></span>
                </div>
              )}

              {birthDate && (
                <div className="flex items-center gap-1.5">
                  <Calendar size={14} className="text-slate-400 shrink-0" />
                  <span className="text-slate-500">DOB: <span className="text-slate-900 font-bold">{birthDate}</span></span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Profile Details 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 w-full">
        {/* Card 1: Shift & Schedule */}
        <div className="clay-card p-5 sm:p-6 relative overflow-hidden transition-all border-t-2 border-t-emerald-500">
          <div className="pb-4 border-b border-slate-200/60">
            <div className="flex items-center gap-2.5">
              <div className="clay-pod p-2 text-emerald-600 shrink-0">
                <Clock size={18} />
              </div>
              <div>
                <h4 className="text-sm sm:text-base font-bold text-slate-900">Shift & Working Hours</h4>
                <span className="text-[10px] text-slate-500 block font-medium">Assigned work schedule and daily expectations</span>
              </div>
            </div>
          </div>
          <div className="pt-3 divide-y divide-slate-100 text-xs">
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Assigned Shift</span>
              <span className="clay-pod px-3 py-1 font-bold text-emerald-700">
                {shiftInfo.shiftName}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Shift Timings</span>
              <span className="font-bold text-slate-800">{to12h(shiftInfo.shiftStart)} – {to12h(shiftInfo.shiftEnd)}</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Required Working Hours</span>
              <span className="font-bold text-slate-800">{shiftInfo.shiftHours} Hours / day</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Shift Type</span>
              <span className="font-bold text-slate-700">Fixed Hours</span>
            </div>
          </div>
        </div>

        {/* Card 2: Compensation Overview */}
        <div className="clay-card p-5 sm:p-6 relative overflow-hidden transition-all border-t-2 border-t-blue-500">
          <div className="pb-4 border-b border-slate-200/60">
            <div className="flex items-center gap-2.5">
              <div className="clay-pod p-2 text-blue-600 shrink-0">
                <IndianRupee size={18} />
              </div>
              <div>
                <h4 className="text-sm sm:text-base font-bold text-slate-900">Compensation & Pay Basis</h4>
                <span className="text-[10px] text-slate-500 block font-medium">Base rate structure and calculation basis</span>
              </div>
            </div>
          </div>
          <div className="pt-3 divide-y divide-slate-100 text-xs">
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Base Salary</span>
              <span className="font-black text-emerald-600 text-sm">
                ₹{shiftInfo.monthlySalary.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Approx. Per-Day Rate</span>
              <span className="font-bold text-slate-800">₹{shiftInfo.perDaySalary}</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Approx. Hourly Rate</span>
              <span className="font-bold text-slate-800">₹{shiftInfo.hourRate} / hr</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Pay Type</span>
              <span className="clay-pod px-3 py-1 font-bold text-blue-700">{(employee as any).payType || 'MONTHLY'}</span>
            </div>
          </div>
        </div>

        {/* Card 3: Contact & Address */}
        <div className="clay-card p-5 sm:p-6 relative overflow-hidden transition-all border-t-2 border-t-amber-500">
          <div className="pb-4 border-b border-slate-200/60">
            <div className="flex items-center gap-2.5">
              <div className="clay-pod p-2 text-amber-600 shrink-0">
                <MapPin size={18} />
              </div>
              <div>
                <h4 className="text-sm sm:text-base font-bold text-slate-900">Contact & Address</h4>
                <span className="text-[10px] text-slate-500 block font-medium">Registered contact info and residential address</span>
              </div>
            </div>
          </div>
          <div className="pt-3 divide-y divide-slate-100 text-xs">
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Phone Number</span>
              <span className="font-bold text-slate-800">
                {employee.phone || <span className="text-slate-400 italic">Not provided</span>}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Email Address</span>
              <span className="font-bold text-slate-800">{employee.email}</span>
            </div>
            <div className="py-2.5">
              <span className="text-slate-500 font-medium block mb-1.5">Residential Address</span>
              <div className="clay-pod p-3 text-slate-800 font-medium leading-relaxed">
                {employee.address ? (
                  employee.address
                ) : (
                  <span className="text-slate-400 italic">No residential address recorded on file.</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Card 4: Emergency Contact */}
        <div className="clay-card p-5 sm:p-6 relative overflow-hidden transition-all border-t-2 border-t-rose-500">
          <div className="pb-4 border-b border-slate-200/60">
            <div className="flex items-center gap-2.5">
              <div className="clay-pod p-2 text-rose-600 shrink-0">
                <HeartPulse size={18} />
              </div>
              <div>
                <h4 className="text-sm sm:text-base font-bold text-slate-900">Emergency Contact</h4>
                <span className="text-[10px] text-slate-500 block font-medium">Primary point of contact in case of urgency</span>
              </div>
            </div>
          </div>
          <div className="pt-3 divide-y divide-slate-100 text-xs">
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Contact Person</span>
              <span className="font-bold text-slate-800">
                {employee.emergencyContactName || <span className="text-slate-400 italic">Not provided</span>}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Relationship</span>
              <span className="font-bold text-slate-800">
                {employee.emergencyContactRelation || <span className="text-slate-400 italic">Not provided</span>}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-slate-500 font-medium">Emergency Phone</span>
              <span className="font-bold text-rose-600">
                {employee.emergencyContactPhone || <span className="text-slate-400 italic">Not provided</span>}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
