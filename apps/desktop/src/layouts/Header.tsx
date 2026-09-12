import { useEffect, useState, useRef, useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/state/auth-store';
import { notificationsApi, settingsApi } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { EMPLOYEE_NAV } from './nav-config';
import defaultCompanyLogo from '@/assets/logo.png';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { 
  Bell, CheckCheck, Clock, Inbox, AlertCircle, Loader2, X, Calendar 
} from 'lucide-react';

function formatNotificationDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  const timeStr = d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  if (isToday) return `Today, ${timeStr}`;
  if (isYesterday) return `Yesterday, ${timeStr}`;

  const sameYear = d.getFullYear() === now.getFullYear();
  const datePart = d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });

  return `${datePart}, ${timeStr}`;
}

function getDateGroupLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Earlier';

  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isToday) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return 'Yesterday';

  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

interface HeaderProps {
  isUserSide?: boolean;
}

export function Header({ isUserSide }: HeaderProps): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, clear } = useAuthStore();
  
  const [now, setNow] = useState(new Date());
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const notifDropdownRef = useRef<HTMLDivElement>(null);

  const isAdminCapable = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR';
  const effectiveIsUserSide = isUserSide ?? (!isAdminCapable || location.pathname.startsWith('/me'));

  // Company logo branding for top bar
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 30_000,
  });

  const activeLogo = settings?.companyLogo || defaultCompanyLogo;
  const companyName = settings?.companyName || 'Attendance System';

  // Live timer
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Close notifications dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    if (isNotifOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isNotifOpen]);

  // Notification queries
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

  // Group notifications date-wise, newest first (Today on top, then descending dates)
  const sortedAndGroupedNotifications = useMemo(() => {
    if (!notifications || notifications.length === 0) return [];

    const sorted = [...notifications].sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime() || 0;
      const timeB = new Date(b.createdAt).getTime() || 0;
      return timeB - timeA;
    });

    const groups: Array<{ label: string; items: any[] }> = [];
    const groupMap = new Map<string, any[]>();

    sorted.forEach((notif, flatIdx) => {
      const groupKey = getDateGroupLabel(notif.createdAt);
      if (!groupMap.has(groupKey)) {
        const list: any[] = [];
        groupMap.set(groupKey, list);
        groups.push({ label: groupKey, items: list });
      }
      groupMap.get(groupKey)!.push({ ...notif, flatIdx });
    });

    return groups;
  }, [notifications]);

  const [isClearingAll, setIsClearingAll] = useState(false);
  const [clearingIds, setClearingIds] = useState<Set<string>>(new Set());

  const handleMarkAllReadAndClear = async () => {
    if (notifications.length === 0 || isClearingAll) return;
    setIsClearingAll(true);

    // Staggered Android-like wipe animation duration
    const animDuration = Math.min(notifications.length * 35 + 320, 750);

    setTimeout(async () => {
      try {
        await notificationsApi.clearAll();
      } catch (err) {
        console.error('Failed to clear notifications:', err);
      } finally {
        queryClient.setQueryData(['notifications', 'list'], []);
        queryClient.setQueryData(['notifications', 'unread-count'], { count: 0 });
        void refetchUnread();
        void refetchList();
        setIsClearingAll(false);
        setClearingIds(new Set());
      }
    }, animDuration);
  };

  const handleClearSingle = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (clearingIds.has(id)) return;
    setClearingIds((prev) => new Set(prev).add(id));

    setTimeout(async () => {
      try {
        await notificationsApi.remove(id);
      } catch (err) {
        console.error('Failed to remove notification:', err);
      } finally {
        queryClient.setQueryData(['notifications', 'list'], (old: any[] = []) =>
          old.filter((n) => n.id !== id)
        );
        void refetchUnread();
        void refetchList();
        setClearingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }, 300);
  };

  const handleConfirmLogout = async (): Promise<void> => {
    setIsLoggingOut(true);
    try {
      await authClient.logout();
    } catch {
      /* ignore */
    } finally {
      queryClient.clear();
      clear();
      setIsLogoutConfirmOpen(false);
      setIsLoggingOut(false);
      navigate('/login', { replace: true });
    }
  };

  return (
    <>
      <header
        className={cn(
          'relative flex items-center justify-between border-b bg-card/85 backdrop-blur-md px-4 sm:px-6 select-none z-30',
          effectiveIsUserSide ? 'h-16' : 'h-14'
        )}
      >
        {/* Left Section: Company Logo on User Side / Date & Time on Admin Side */}
        {effectiveIsUserSide ? (
          <div className="flex items-center shrink-0">
            <NavLink to="/me" className="flex items-center">
              <img
                src={activeLogo}
                alt={companyName}
                className="h-8 sm:h-9 w-auto max-w-[130px] sm:max-w-[160px] object-contain object-left"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = defaultCompanyLogo;
                }}
              />
            </NavLink>
          </div>
        ) : (
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
        )}

        {/* Middle Section: Top Bar Access Buttons Centered in available space */}
        {effectiveIsUserSide && (
          <nav className="flex-1 flex justify-center items-center gap-1 sm:gap-1.5 px-2 min-w-0 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-1">
            {EMPLOYEE_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/me'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-all duration-150 shrink-0 select-none whitespace-nowrap',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )
                  }
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="hidden lg:inline">{item.label}</span>
                  <span className="lg:hidden">
                    {item.label.replace('My ', '')}
                  </span>
                </NavLink>
              );
            })}
          </nav>
        )}

        {/* Right Section: Live Time, Notifications & Employee Profile (Click to Sign Out) */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* User Side Date & Time (visible on 2xl screens to avoid cramped navigation) */}
          {effectiveIsUserSide && (
            <div className="hidden 2xl:flex items-center gap-2 text-xs font-medium text-muted-foreground mr-1 shrink-0">
              <Clock size={14} className="text-muted-foreground/70" />
              <span>
                {now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}
              </span>
              <span className="text-border">•</span>
              <span className="font-mono text-foreground font-semibold">
                {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </span>
            </div>
          )}

          {/* Notifications Dropdown */}
          <div className="relative" ref={notifDropdownRef}>
            <button
              type="button"
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className={cn(
                'relative flex h-8.5 w-8.5 sm:h-9 sm:w-9 items-center justify-center rounded-xl border transition-all cursor-pointer',
                isNotifOpen
                  ? 'border-primary bg-primary/10 text-primary shadow-xs'
                  : 'border-border/80 bg-background hover:bg-secondary text-muted-foreground hover:text-foreground'
              )}
              title="Notifications"
            >
              <Bell size={16} />
              {unread && unread.count > 0 ? (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white shadow-sm animate-pulse">
                  {unread.count > 9 ? '9+' : unread.count}
                </span>
              ) : null}
            </button>

            {/* Notifications Popover */}
            {isNotifOpen && (
              <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-[360px] max-w-[360px] max-h-[min(420px,calc(100vh-5rem))] rounded-2xl border border-border bg-card text-card-foreground shadow-2xl z-50 overflow-hidden flex flex-col animate-in fade-in-50 zoom-in-95 duration-150">
                <div className="px-3.5 py-2.5 border-b border-border bg-muted/40 flex justify-between items-center shrink-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Notifications {unread?.count ? `(${unread.count})` : ''}
                  </span>
                  <button
                    type="button"
                    disabled={notifications.length === 0 || isClearingAll}
                    className={cn(
                      'text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer select-none',
                      notifications.length === 0 || isClearingAll
                        ? 'text-muted-foreground/50 cursor-not-allowed opacity-60'
                        : 'text-primary hover:text-primary/80 hover:underline active:scale-95'
                    )}
                    onClick={handleMarkAllReadAndClear}
                    title="Mark all as read and clear"
                  >
                    {isClearingAll ? (
                      <>
                        <Loader2 size={13} className="animate-spin text-primary" />
                        <span>Clearing…</span>
                      </>
                    ) : (
                      <>
                        <CheckCheck size={13} />
                        <span>Mark all read & clear</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto overflow-x-hidden bg-card relative [scrollbar-width:thin]">
                  {notifications.length === 0 ? (
                    <div className="py-10 text-center flex flex-col items-center justify-center text-muted-foreground gap-2">
                      <Inbox size={24} className="opacity-40" />
                      <span className="text-xs">No notifications yet</span>
                    </div>
                  ) : (
                    sortedAndGroupedNotifications.map((group) => (
                      <div key={group.label} className="relative">
                        <div className="sticky top-0 z-10 px-3.5 py-1.5 bg-muted/95 backdrop-blur-xs border-y border-border/50 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between shadow-2xs">
                          <span className="flex items-center gap-1.5">
                            <Calendar size={11} className="text-primary/70" />
                            <span>{group.label}</span>
                          </span>
                          <span className="text-[9px] font-medium opacity-60">
                            {group.items.length}
                          </span>
                        </div>
                        <div className="divide-y divide-border/30">
                          {group.items.map((notif: any) => {
                            const isUnread = !notif.readAt;
                            const isLeaving = isClearingAll || clearingIds.has(notif.id);
                            const staggerDelay = isClearingAll ? `${notif.flatIdx * 30}ms` : '0ms';

                            return (
                              <div
                                key={notif.id}
                                style={{
                                  transform: isLeaving ? 'translateX(115%)' : 'translateX(0)',
                                  opacity: isLeaving ? 0 : 1,
                                  transition: 'transform 320ms cubic-bezier(0.2, 0, 0, 1), opacity 280ms ease',
                                  transitionDelay: staggerDelay,
                                }}
                                className={cn(
                                  'px-3.5 py-2.5 text-xs flex gap-2.5 relative group select-none transition-colors',
                                  isUnread ? 'bg-primary/5 hover:bg-primary/10' : 'bg-card hover:bg-muted/40'
                                )}
                              >
                                <div className="mt-0.5">
                                  <span
                                    className={cn(
                                      'flex h-2 w-2 rounded-full',
                                      isUnread ? 'bg-sky-500' : 'bg-transparent'
                                    )}
                                  />
                                </div>
                                <div className="flex-1 min-w-0 pr-5">
                                  <div className="flex justify-between items-baseline gap-2">
                                    <span className="font-bold text-foreground truncate">
                                      {notif.title}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground shrink-0 font-medium whitespace-nowrap">
                                      {formatNotificationDate(notif.createdAt)}
                                    </span>
                                  </div>
                                  <p className="text-muted-foreground text-[11px] mt-0.5 leading-relaxed break-words">
                                    {notif.body}
                                  </p>
                                </div>

                                {/* Individual Clear/Dismiss Button on Hover */}
                                <button
                                  type="button"
                                  onClick={(e) => handleClearSingle(e, notif.id)}
                                  className="absolute right-2.5 top-2.5 p-1 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-muted/80 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                  title="Dismiss notification"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Employee Profile Icon - Clicking directly prompts Sign Out */}
          <div className="flex items-center pl-2 border-l border-border/60">
            <button
              type="button"
              onClick={() => setIsLogoutConfirmOpen(true)}
              className="flex items-center gap-2 p-1 sm:px-2 sm:py-1 rounded-xl hover:bg-destructive/10 hover:border-destructive/30 border border-transparent transition-all cursor-pointer select-none group"
              title="Click to Sign Out"
            >
              <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-xs group-hover:bg-destructive transition-colors">
                {user?.name?.[0]?.toUpperCase() || 'U'}
                <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" />
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-xs font-semibold text-foreground group-hover:text-destructive max-w-[110px] lg:max-w-[130px] truncate leading-tight transition-colors">
                  {user?.name || 'User'}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase font-medium group-hover:text-destructive/80 transition-colors">
                  {user?.role === 'SUPER_ADMIN' ? 'Admin' : user?.role || 'Employee'}
                </span>
              </div>
            </button>
          </div>
        </div>
      </header>

      {/* Sign Out Confirmation Modal */}
      <Dialog open={isLogoutConfirmOpen} onOpenChange={setIsLogoutConfirmOpen}>
        <DialogContent className="sm:max-w-[360px] rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <AlertCircle size={18} className="text-rose-500" /> Sign Out
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-xs text-muted-foreground leading-relaxed">
            Are you sure you want to log out of your account?
          </div>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-xs"
              onClick={() => setIsLogoutConfirmOpen(false)}
              disabled={isLoggingOut}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="rounded-lg text-xs"
              onClick={handleConfirmLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? 'Signing out...' : 'Sign Out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
