import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/state/auth-store';
import { notificationsApi } from '@/lib/api';
import { Bell, CheckCheck, Clock, Inbox } from 'lucide-react';

export function Header(): JSX.Element {
  const { user } = useAuthStore();
  const [now, setNow] = useState(new Date());
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const { data: unread, refetch: refetchUnread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 5_000,
  });

  const { data: notifications = [], refetch: refetchList } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: notificationsApi.list,
    refetchInterval: 5_000,
  });

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllRead();
    void refetchUnread();
    void refetchList();
  };

  return (
    <header className="relative flex h-14 items-center justify-between border-b bg-card/60 backdrop-blur-md px-6 select-none z-30">
      {/* Live Date & Time Display */}
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Clock size={14} className="text-muted-foreground/70" />
        <span>
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
        <span className="text-border">•</span>
        <span className="font-mono text-foreground font-semibold">
          {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
        </span>
      </div>

      {/* Right controls: Notifications & Profile badge */}
      <div className="flex items-center gap-4">
        {/* Notifications Dropdown Container */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
              isOpen
                ? 'border-primary bg-primary/10 text-primary shadow-xs'
                : 'border-border/80 bg-background hover:bg-secondary text-muted-foreground hover:text-foreground'
            }`}
            title="Notifications"
          >
            <Bell size={16} />
            {unread && unread.count > 0 ? (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white shadow-sm animate-pulse">
                {unread.count > 9 ? '9+' : unread.count}
              </span>
            ) : null}
          </button>

          {/* Solid Opaque Notification Popover */}
          {isOpen && (
            <div className="absolute right-0 mt-2 w-84 sm:w-96 rounded-2xl border border-border bg-white text-zinc-950 shadow-2xl z-50 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
              {/* Header */}
              <div className="p-3.5 border-b border-border bg-zinc-50 flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-600">
                  Notifications {unread?.count ? `(${unread.count})` : ''}
                </span>
                <button
                  type="button"
                  className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 transition-colors"
                  onClick={handleMarkAllRead}
                >
                  <CheckCheck size={13} />
                  <span>Mark all read</span>
                </button>
              </div>

              {/* Notification List */}
              <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100 bg-white">
                {notifications.length === 0 ? (
                  <div className="py-10 text-center flex flex-col items-center justify-center text-muted-foreground gap-2">
                    <Inbox size={24} className="opacity-40" />
                    <span className="text-xs">No notifications yet</span>
                  </div>
                ) : (
                  notifications.slice(0, 10).map((notif: any) => {
                    const isUnread = !notif.readAt;
                    return (
                      <div
                        key={notif.id}
                        className={`p-3.5 text-xs transition-colors flex gap-3 ${
                          isUnread ? 'bg-sky-50/60 hover:bg-sky-50' : 'bg-white hover:bg-zinc-50/80'
                        }`}
                      >
                        <div className="mt-0.5">
                          <span
                            className={`flex h-2 w-2 rounded-full ${
                              isUnread ? 'bg-sky-500' : 'bg-transparent'
                            }`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline gap-2">
                            <span className="font-bold text-zinc-900 truncate">
                              {notif.title}
                            </span>
                            <span className="text-[10px] text-zinc-400 shrink-0 font-medium">
                              {new Date(notif.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-zinc-600 text-[11px] mt-0.5 leading-relaxed break-words">
                            {notif.body}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* User avatar badge */}
        <div className="flex items-center gap-2.5 pl-2 border-l border-border/60">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-sm shadow-primary/20">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex flex-col text-left">
            <span className="text-xs font-semibold text-foreground max-w-[130px] truncate leading-tight">
              {user?.name || 'User'}
            </span>
            <span className="text-[10px] text-muted-foreground uppercase font-medium">
              {user?.role === 'SUPER_ADMIN' ? 'Admin' : user?.role || 'Employee'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
