import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { authClient } from '@/lib/auth-client';
import { useAuthStore } from '@/state/auth-store';

export function RequireAuth({ children }: { children: React.ReactNode }): JSX.Element {
  const { status, setUser, setUnauthenticated } = useAuthStore();

  useEffect(() => {
    if (status !== 'loading') {
      return;
    }
    authClient
      .getSession()
      .then((user) => {
        if (user) {
          setUser(user);
        } else {
          setUnauthenticated();
        }
      })
      .catch(() => setUnauthenticated());
  }, [status, setUser, setUnauthenticated]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
