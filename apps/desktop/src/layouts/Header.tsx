import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { authClient } from '@/lib/auth-client';
import { useAuthStore } from '@/state/auth-store';
import { Button } from '@/components/ui/button';
import { notificationsApi } from '@/lib/api';

export function Header(): JSX.Element {
  const { user, clear } = useAuthStore();
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 60_000,
  });

  const handleLogout = async (): Promise<void> => {
    await authClient.logout();
    clear();
    navigate('/login', { replace: true });
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <div className="text-sm text-muted-foreground">
        {now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        {' · '}
        {now.toLocaleTimeString()}
      </div>

      <div className="flex items-center gap-4">
        <div className="relative text-sm group cursor-pointer">
          <span className="text-xl">🔔</span>
          {unread && unread.count > 0 ? (
            <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
              {unread.count}
            </span>
          ) : null}
          <div className="absolute right-0 mt-2 w-64 rounded-md border bg-popover text-popover-foreground shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
            <div className="p-3 border-b flex justify-between items-center">
              <span className="font-semibold">Notifications</span>
              <button 
                className="text-xs text-primary hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  notificationsApi.markAllRead();
                }}
              >
                Mark all read
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto p-2">
              <div className="p-2 text-xs text-muted-foreground text-center">
                Notifications list coming soon
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="text-sm">
            <div className="font-medium leading-none">{user?.name}</div>
            <div className="text-xs text-muted-foreground mt-1">{user?.role}</div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleLogout} className="ml-2">
          Logout
        </Button>
      </div>
    </header>
  );
}
