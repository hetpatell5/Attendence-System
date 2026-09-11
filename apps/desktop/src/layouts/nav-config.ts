import type { Role } from '@attendance/shared';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  CalendarCheck,
  Wallet,
  CalendarDays,
  User,
  Users,
  Building2,
  Megaphone,
  FileText,
  Settings,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  roles: Role[];
  icon: LucideIcon;
}

export const EMPLOYEE_NAV: NavItem[] = [
  { to: '/me', label: 'Dashboard', roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'], icon: LayoutDashboard },
  { to: '/me/attendance', label: 'My Attendance', roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'], icon: CalendarCheck },
  { to: '/me/salary', label: 'My Salary', roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'], icon: Wallet },
  { to: '/me/leaves', label: 'My Leaves', roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'], icon: CalendarDays },
  { to: '/me/profile', label: 'Profile', roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'], icon: User },
];

export const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], icon: LayoutDashboard },
  { to: '/admin/employees', label: 'Employees', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], icon: Users },
  { to: '/admin/attendance', label: 'Attendance', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], icon: CalendarCheck },
  { to: '/admin/leaves', label: 'Leaves', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], icon: CalendarDays },
  { to: '/admin/salary', label: 'Salary', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], icon: Wallet },
  { to: '/admin/organization', label: 'Organization', roles: ['SUPER_ADMIN', 'ADMIN'], icon: Building2 },
  { to: '/admin/announcements', label: 'Announcements', roles: ['SUPER_ADMIN', 'ADMIN'], icon: Megaphone },
  { to: '/admin/reports', label: 'Reports', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], icon: FileText },
  { to: '/settings', label: 'Settings', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'], icon: Settings },
];
