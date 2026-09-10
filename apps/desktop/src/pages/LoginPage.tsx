import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { useAuthStore } from '@/state/auth-store';
import { Button } from '@/components/ui/button';
import {
  Eye,
  EyeOff,
  Lock,
  User,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { AnalogClock } from '@/components/AnalogClock';
import companyLogo from '@/assets/logo.png';

// ---------------------------------------------------------------------------
// Server health indicator (read-only — no config button in production)
// ---------------------------------------------------------------------------
function HealthBadge(): JSX.Element {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: apiClient.getHealth,
    retry: 2,
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
        <span>Connecting to server…</span>
      </div>
    );
  }

  if (isError || data?.status !== 'ok') {
    return (
      <div className="flex items-center justify-center gap-2 text-xs text-destructive font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-ping" />
        <span>Server unreachable — check your internet connection</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-2 text-xs text-emerald-600 font-medium">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      <span>System online</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------
export function LoginPage(): JSX.Element {
  const usernameInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    document.body.style.pointerEvents = 'auto';
    window.focus();
    const t = setTimeout(() => {
      usernameInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const user = await authClient.login(username.trim(), password);
      setUser(user);
      if (rememberMe) {
        localStorage.setItem(
          'atten_remember_login',
          JSON.stringify({ username: username.trim(), password })
        );
      } else {
        localStorage.removeItem('atten_remember_login');
      }
      const isEmployee = user.role === 'EMPLOYEE';
      navigate(isEmployee ? '/me' : '/admin', { replace: true });
    } catch (err: any) {
      const message = err?.message || '';
      const status = err?.status;
      if (status === 401 || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('invalid')) {
        setError('Invalid username or password.');
      } else if (
        message.includes('fetch') || message.includes('network') ||
        message.includes('connect') || message.includes('ECONNREFUSED') ||
        message.includes('Failed to fetch')
      ) {
        setError('Cannot reach the server. Please check your internet connection.');
      } else {
        setError(message || 'Login failed. Please check your credentials or connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-zinc-100/70 p-4 lg:p-8">
      {/* Background ambient lighting */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-1/3 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-200/40 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/3 h-[500px] w-[500px] translate-x-1/2 translate-y-1/2 rounded-full bg-indigo-200/30 blur-[100px]" />
      </div>

      {/* Main Dual-Panel Container */}
      <div className="flex w-full max-w-4xl overflow-hidden rounded-3xl border border-border/80 bg-card shadow-2xl shadow-zinc-950/10 transition-all">
        {/* Left Side: Login Form */}
        <div className="flex w-full flex-col justify-between p-8 sm:p-12 lg:w-1/2 bg-card">
          <div>
            {/* Logo */}
            <div className="flex justify-center pt-2 pb-6">
              <img
                src={companyLogo}
                alt="Logo"
                className="h-16 w-auto max-w-[260px] object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {error && (
                <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive font-medium animate-in fade-in-50">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Username */}
              <div className="space-y-1.5">
                <label
                  htmlFor="username"
                  className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-muted-foreground/60">
                    <User size={15} />
                  </div>
                  <input
                    ref={usernameInputRef}
                    id="username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-4 text-sm font-medium transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-muted-foreground/60">
                    <Lock size={15} />
                  </div>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-10 text-sm font-medium transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-muted-foreground/60 hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* Remember Me */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground transition-colors">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-primary/40"
                  />
                  <span>Remember my login</span>
                </label>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-11 text-sm font-semibold rounded-xl shadow-md shadow-primary/15 transition-all mt-2"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <Loader2 size={15} className="animate-spin" />
                    <span>Signing in...</span>
                  </div>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
          </div>

          {/* Server health indicator */}
          <div className="mt-8 pt-4 border-t border-border/50 text-center">
            <HealthBadge />
          </div>
        </div>

        {/* Right Side: Analog Clock */}
        <div className="hidden lg:flex w-1/2 flex-col items-center justify-center bg-zinc-950 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/90 via-zinc-950 to-zinc-950" />
          <div className="relative z-10 h-full w-full">
            <AnalogClock />
          </div>
        </div>
      </div>
    </div>
  );
}
