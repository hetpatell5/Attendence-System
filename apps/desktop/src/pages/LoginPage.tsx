import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useAuthStore } from '@/state/auth-store';
import { Button } from '@/components/ui/button';

function HealthBadge(): JSX.Element {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: apiClient.getHealth,
    retry: 1,
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return <span className="text-sm text-muted-foreground">Checking backend status…</span>;
  }

  if (isError || data?.status !== 'ok') {
    return (
      <span className="inline-flex items-center gap-2 text-sm font-medium text-destructive">
        <span className="h-2 w-2 rounded-full bg-destructive" />
        Backend unavailable
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      Backend healthy{data.database.connected ? ' · database connected' : ' · database unreachable'}
    </span>
  );
}

export function LoginPage(): JSX.Element {
  const [username, setUsername] = useState(() => {
    try {
      const saved = localStorage.getItem('atten_remember_login');
      if (saved) return JSON.parse(saved).username || '';
    } catch { /* ignore */ }
    return '';
  });
  const [password, setPassword] = useState(() => {
    try {
      const saved = localStorage.getItem('atten_remember_login');
      if (saved) return JSON.parse(saved).password || '';
    } catch { /* ignore */ }
    return '';
  });
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setUser = useAuthStore((state) => state.setUser);
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const user = await authClient.login(username, password);
      setUser(user);
      if (rememberMe) {
        localStorage.setItem('atten_remember_login', JSON.stringify({ username, password }));
      } else {
        localStorage.removeItem('atten_remember_login');
      }
      const isEmployee = user.role === 'EMPLOYEE';
      navigate(isEmployee ? '/me' : '/admin', { replace: true });
    } catch {
      setError('Invalid username or password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden w-1/2 flex-col justify-between bg-zinc-950 p-12 text-white lg:flex relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 to-zinc-950 z-0"></div>
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xl shadow-lg shadow-primary/20">
            A
          </div>
          <span className="text-2xl font-bold tracking-tight">AttenNew</span>
        </div>
        
        <div className="relative z-10 mb-20 space-y-6">
          <h1 className="text-5xl font-bold tracking-tight leading-tight">
            Streamline your<br />attendance management.
          </h1>
          <p className="text-zinc-400 text-lg max-w-md">
            The modern way to track attendance, manage leaves, and process salary with zero friction.
          </p>
        </div>
        
        <div className="relative z-10 text-sm text-zinc-500">
          <HealthBadge />
        </div>
      </div>
      
      <div className="flex w-full items-center justify-center lg:w-1/2 px-8">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden flex justify-center mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-2xl shadow-lg shadow-primary/20">
              A
            </div>
          </div>
          
          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-3xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-muted-foreground">Please sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6 mt-8">
            {error ? (
              <div className="rounded-md bg-destructive/15 p-4 text-sm text-destructive border border-destructive/20 flex items-center gap-2">
                <span className="text-base">⚠️</span> {error}
              </div>
            ) : null}
            
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium" htmlFor="password">
                    Password
                  </label>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-md border border-input bg-background px-4 py-3 pr-10 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                />
                Remember my login
              </label>
            </div>

            <Button type="submit" className="w-full h-12 text-base font-medium shadow-md shadow-primary/10" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign In'}
            </Button>
            
            <div className="lg:hidden text-center mt-6">
              <HealthBadge />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
