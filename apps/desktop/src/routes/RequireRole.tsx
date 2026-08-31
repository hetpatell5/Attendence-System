import { Navigate } from 'react-router-dom';
import type { Role } from '@attendance/shared';
import { useAuthStore } from '@/state/auth-store';

/**
 * UX-only guard: hides admin routes from roles that shouldn't see them in
 * the nav. The real security boundary is the backend's RolesGuard — never
 * treat this as the enforcement point.
 */
export function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: React.ReactNode;
}): JSX.Element {
  const role = useAuthStore((s) => s.user?.role);

  if (!role || !roles.includes(role)) {
    return <Navigate to="/me" replace />;
  }

  return <>{children}</>;
}
