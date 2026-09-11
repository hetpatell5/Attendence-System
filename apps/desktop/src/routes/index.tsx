import { createHashRouter, Navigate } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { EmployeeDashboardPage } from '@/pages/employee/EmployeeDashboardPage';
import { MyAttendancePage } from '@/pages/employee/MyAttendancePage';
import { MySalaryPage } from '@/pages/employee/MySalaryPage';
import { MyLeavesPage } from '@/pages/employee/MyLeavesPage';
import { ProfilePage } from '@/pages/employee/ProfilePage';
import { AdminDashboardPage } from '@/pages/admin/AdminDashboardPage';
import { EmployeesPage } from '@/pages/admin/EmployeesPage';
import { EmployeeDetailPage } from '@/pages/admin/EmployeeDetailPage';
import { AttendanceManagementPage } from '@/pages/admin/AttendanceManagementPage';
import { LeaveManagementPage } from '@/pages/admin/LeaveManagementPage';
import { SalaryManagementPage } from '@/pages/admin/SalaryManagementPage';
import { OrganizationPage } from '@/pages/admin/OrganizationPage';
import { ReportsPage } from '@/pages/admin/ReportsPage';
import { AnnouncementsPage } from '@/pages/admin/AnnouncementsPage';
import { AppLayout } from '@/layouts/AppLayout';
import { RequireRole } from './RequireRole';
import { useAuthStore } from '@/state/auth-store';

// Sends admins straight to /admin and employees to /me on first load.
function RootRedirect(): JSX.Element {
  const role = useAuthStore((s) => s.user?.role);
  const isAdminCapable = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';
  return <Navigate to={isAdminCapable ? '/admin' : '/me'} replace />;
}

export const router = createHashRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <RootRedirect /> },
      { path: 'me', element: <EmployeeDashboardPage /> },
      { path: 'me/attendance', element: <MyAttendancePage /> },
      { path: 'me/salary', element: <MySalaryPage /> },
      { path: 'me/leaves', element: <MyLeavesPage /> },
      { path: 'me/profile', element: <ProfilePage /> },
      {
        path: 'settings',
        element: (
          <RequireRole roles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
            <SettingsPage />
          </RequireRole>
        ),
      },
      {
        path: 'admin',
        element: (
          <RequireRole roles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
            <AdminDashboardPage />
          </RequireRole>
        ),
      },
      {
        path: 'admin/employees',
        element: (
          <RequireRole roles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
            <EmployeesPage />
          </RequireRole>
        ),
      },
      {
        path: 'admin/employees/:id',
        element: (
          <RequireRole roles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
            <EmployeeDetailPage />
          </RequireRole>
        ),
      },
      {
        path: 'admin/attendance',
        element: (
          <RequireRole roles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
            <AttendanceManagementPage />
          </RequireRole>
        ),
      },
      {
        path: 'admin/leaves',
        element: (
          <RequireRole roles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
            <LeaveManagementPage />
          </RequireRole>
        ),
      },
      {
        path: 'admin/salary',
        element: (
          <RequireRole roles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
            <SalaryManagementPage />
          </RequireRole>
        ),
      },
      {
        path: 'admin/organization',
        element: (
          <RequireRole roles={['SUPER_ADMIN', 'ADMIN']}>
            <OrganizationPage />
          </RequireRole>
        ),
      },
      {
        path: 'admin/reports',
        element: (
          <RequireRole roles={['SUPER_ADMIN', 'ADMIN', 'HR']}>
            <ReportsPage />
          </RequireRole>
        ),
      },

      {
        path: 'admin/announcements',
        element: (
          <RequireRole roles={['SUPER_ADMIN', 'ADMIN']}>
            <AnnouncementsPage />
          </RequireRole>
        ),
      },
    ],
  },
]);
