import type { Role } from '@attendance/shared';

export interface NavItem {
  to: string;
  label: string;
  roles: Role[];
}

export const EMPLOYEE_NAV: NavItem[] = [
  { to: '/me', label: 'Dashboard', roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'] },
  { to: '/me/attendance', label: 'My Attendance', roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'] },
  { to: '/me/salary', label: 'My Salary', roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'] },
  { to: '/me/leaves', label: 'My Leaves', roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'] },
  { to: '/me/profile', label: 'Profile', roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'] },
];

export const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Admin Dashboard', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { to: '/admin/employees', label: 'Employees', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { to: '/admin/attendance', label: 'Attendance', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { to: '/admin/leaves', label: 'Leaves', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { to: '/admin/salary', label: 'Salary', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
  { to: '/admin/organization', label: 'Organization', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { to: '/admin/announcements', label: 'Announcements', roles: ['SUPER_ADMIN', 'ADMIN'] },
  { to: '/admin/reports', label: 'Reports', roles: ['SUPER_ADMIN', 'ADMIN', 'HR'] },
];

export const SETTINGS_NAV: NavItem = {
  to: '/settings',
  label: 'Settings',
  roles: ['SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE'],
};
