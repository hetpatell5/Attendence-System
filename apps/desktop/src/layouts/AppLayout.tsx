import { Outlet, useLocation } from 'react-router-dom';
import { RequireAuth } from '@/routes/RequireAuth';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { UpdateBanner } from '@/components/UpdateBanner';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';
import { useAuthStore } from '@/state/auth-store';

/** Activates real-time SSE stream + native notification push for the entire app session. */
function RealtimeNotificationProvider(): null {
  useRealtimeNotifications();
  return null;
}

export function AppLayout(): JSX.Element {
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const isAdminCapable = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';
  const isUserSide = !isAdminCapable || location.pathname.startsWith('/me');

  return (
    <RequireAuth>
      <RealtimeNotificationProvider />
      <div className="flex h-screen overflow-hidden">
        {!isUserSide && <Sidebar />}
        <div className="flex flex-1 flex-col overflow-hidden">
          <UpdateBanner />
          <Header isUserSide={isUserSide} />
          <main className="flex-1 overflow-y-auto bg-secondary/20 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}

