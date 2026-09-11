import { useEffect, useState, useRef } from 'react';
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
  Bell, CheckCheck, Clock, Inbox, AlertCircle 
} from 'lucide-react';

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

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllRead();
    void refetchUnread();
    void refetchList();
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

        {/* Middle Section: Top Bar Access Buttons Centered Exactly in the Middle */}
        {effectiveIsUserSide && (
          <nav className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 sm:gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-1">
            {EMPLOYEE_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/me'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-all duration-150 shrink-0 select-none',
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
          {/* User Side Date & Time (visible on wide screens) */}
          {effectiveIsUserSide && (
            <div className="hidden xl:flex items-center gap-2 text-xs font-medium text-muted-foreground mr-1">
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
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-border bg-card text-card-foreground shadow-2xl z-50 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
                <div className="p-3.5 border-b border-border bg-muted/40 flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Notifications {unread?.count ? `(${unread.count})` : ''}
                  </span>
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 transition-colors cursor-pointer"
                    onClick={handleMarkAllRead}
                  >
                    <CheckCheck size={13} />
                    <span>Mark all read</span>
                  </button>
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-border/40 bg-card">
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
                          className={cn(
                            'p-3.5 text-xs transition-colors flex gap-3',
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
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-baseline gap-2">
                              <span className="font-bold text-foreground truncate">
                                {notif.title}
                              </span>
                              <span className="text-[10px] text-muted-foreground shrink-0 font-medium">
                                {new Date(notif.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <p className="text-muted-foreground text-[11px] mt-0.5 leading-relaxed break-words">
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
