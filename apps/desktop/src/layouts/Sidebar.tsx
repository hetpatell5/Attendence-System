import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/state/auth-store';
import { cn } from '@/lib/utils';
import { EMPLOYEE_NAV, ADMIN_NAV, SETTINGS_NAV } from './nav-config';

export function Sidebar(): JSX.Element {
  const role = useAuthStore((s) => s.user?.role);
  const isAdminCapable = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR';

  const linkClass = ({ isActive }: { isActive: boolean }): string =>
    cn(
      'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
      isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary',
    );

  return (
    <aside className="flex h-full w-60 flex-col border-r bg-background p-4">
      <div className="mb-6 px-2">
        <h1 className="text-base font-semibold">Attendance</h1>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto">
        {!isAdminCapable ? (
          <div className="space-y-1">
            <p className="px-3 text-xs font-semibold uppercase text-muted-foreground">My Space</p>
            {EMPLOYEE_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass} end={item.to === '/me'}>
                {item.label}
              </NavLink>
            ))}
          </div>
        ) : null}

        {isAdminCapable ? (
          <div className="space-y-1">
            {ADMIN_NAV.filter((item) => !role || item.roles.includes(role)).map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass} end={item.to === '/admin'}>
                {item.label}
              </NavLink>
            ))}
          </div>
        ) : null}
      </nav>

      <div className="border-t pt-4">
        <NavLink to={SETTINGS_NAV.to} className={linkClass}>
          {SETTINGS_NAV.label}
        </NavLink>
      </div>
    </aside>
  );
}
