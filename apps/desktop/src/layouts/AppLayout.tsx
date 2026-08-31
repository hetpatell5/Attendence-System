import { Outlet } from 'react-router-dom';
import { RequireAuth } from '@/routes/RequireAuth';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';

/** Activates real-time SSE stream + native notification push for the entire app session. */
function RealtimeNotificationProvider(): null {
  useRealtimeNotifications();
  return null;
}

export function AppLayout(): JSX.Element {
  return (
    <RequireAuth>
      <RealtimeNotificationProvider />
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto bg-secondary/20 p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}
