import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/state/auth-store';
import { useUiStore } from '@/state/ui-store';
import { authClient } from '@/lib/auth-client';
import { settingsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EMPLOYEE_NAV, ADMIN_NAV } from './nav-config';
import { LogOut, AlertCircle, PanelLeft } from 'lucide-react';
import defaultCompanyLogo from '@/assets/logo.png';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export function Sidebar(): JSX.Element {
  const role = useAuthStore((s) => s.user?.role);
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const isCollapsed = useUiStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 30_000,
  });

  const activeLogo = settings?.companyLogo || defaultCompanyLogo;
  const companyName = settings?.companyName || 'Attendance System';

  const isAdminCapable = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

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

  const navItems = isAdminCapable
    ? ADMIN_NAV.filter((item) => !role || item.roles.includes(role))
    : EMPLOYEE_NAV;

  return (
    <>
      <aside
        className={cn(
          'relative flex h-full flex-col border-r bg-card/60 backdrop-blur-md p-4 select-none',
          isCollapsed ? 'w-[68px] px-2' : 'w-48',
        )}
      >
        {/* Top Header: Logo + Collapse Toggle grouped together in one row so they read as one
            unit instead of the toggle floating off alone across an empty gap. Collapsed shows
            just the brand icon mark (cropped from the left of the wordmark logo) stacked above
            the toggle, since the full wordmark doesn't read well squeezed into a 44px rail. */}
        <div className="mb-6 pt-2 pb-4 border-b border-border/40">
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div className="h-10 w-10 overflow-hidden shrink-0">
                <img
                  src={defaultCompanyLogo}
                  alt={companyName}
                  style={{
                    width: '143px',
                    height: '49px',
                    maxWidth: 'none',
                    maxHeight: 'none',
                    marginTop: '-4px',
                    marginLeft: 0,
                  }}
                />
              </div>
              <button
                type="button"
                onClick={toggleSidebar}
                title="Expand sidebar"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm hover:text-primary hover:border-primary/40 hover:bg-secondary transition-colors"
              >
                <PanelLeft size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 px-2">
              <img
                src={activeLogo}
                alt={companyName}
                className="h-12 w-auto max-w-[130px] object-contain object-left"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = defaultCompanyLogo;
                }}
              />
              <button
                type="button"
                onClick={toggleSidebar}
                title="Collapse sidebar"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm hover:text-primary hover:border-primary/40 hover:bg-secondary transition-colors"
              >
                <PanelLeft size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Navigation items list */}
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden pr-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/me' || item.to === '/admin'}
                title={isCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                    isCollapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20 font-semibold'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )
                }
              >
                <Icon size={17} className="shrink-0" />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom section with User Info & Logout Button */}
        <div className="border-t border-border/70 pt-3 space-y-2">
          <div className={cn('flex items-center gap-2.5 py-1.5', isCollapsed ? 'justify-center px-0' : 'px-2')}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-semibold text-foreground truncate">{user?.name}</span>
                <span className="text-[10px] text-muted-foreground truncate">{user?.role}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsLogoutConfirmOpen(true)}
            title={isCollapsed ? 'Sign Out' : undefined}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 hover:bg-destructive hover:text-destructive-foreground px-3 py-2 text-xs font-semibold text-destructive transition-colors duration-150"
          >
            <LogOut size={14} />
            {!isCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Modern In-App Logout Confirmation Modal (replaces focus-stealing window.confirm) */}
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
