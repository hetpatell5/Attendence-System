import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/state/auth-store';
import { authClient } from '@/lib/auth-client';
import { settingsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EMPLOYEE_NAV, ADMIN_NAV } from './nav-config';
import { LogOut, AlertCircle } from 'lucide-react';
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
      <aside className="flex h-full w-64 flex-col border-r bg-card/60 backdrop-blur-md p-4 select-none">
        {/* Top Company Logo Branding */}
        <div className="mb-6 px-2 pt-2 pb-4 flex items-center justify-start border-b border-border/40">
          <img
            src={activeLogo}
            alt={companyName}
            className="h-12 w-auto max-w-[210px] object-contain object-left"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = defaultCompanyLogo;
            }}
          />
        </div>

        {/* Navigation items list */}
        <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/me' || item.to === '/admin'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20 font-semibold'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )
                }
              >
                <Icon size={17} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom section with User Info & Logout Button */}
        <div className="border-t border-border/70 pt-3 space-y-2">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold text-foreground truncate">{user?.name}</span>
              <span className="text-[10px] text-muted-foreground truncate">{user?.role}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsLogoutConfirmOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 hover:bg-destructive hover:text-destructive-foreground px-3 py-2 text-xs font-semibold text-destructive transition-colors duration-150"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
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
