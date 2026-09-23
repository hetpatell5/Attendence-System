import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { recoveryApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/state/auth-store';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Eye,
  EyeOff,
  Lock,
  User,
  AlertCircle,
  Loader2,
  KeyRound,
  CheckCircle2,
} from 'lucide-react';
import { AnalogClock } from '@/components/AnalogClock';
import companyLogo from '@/assets/logo.png';

// ---------------------------------------------------------------------------
// Hidden admin password recovery — Ctrl+F on the login screen opens this.
// Three steps: request an OTP for a username, verify it, set a new password.
// ---------------------------------------------------------------------------
type RecoveryStep = 'request' | 'verify' | 'reset' | 'done';

function RecoveryDialog({
  open,
  onOpenChange,
  initialUsername,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUsername: string;
}): JSX.Element {
  const [step, setStep] = useState<RecoveryStep>('request');
  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset all state whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setStep('request');
      setUsername(initialUsername);
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      setResetToken('');
      setError(null);
    }
  }, [open, initialUsername]);

  const handleSendOtp = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!username.trim()) {
      setError('Enter the admin username to reset.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await recoveryApi.requestOtp(username.trim());
      setStep('verify');
    } catch (err) {
      // Operational errors (no recovery email configured, SMTP not set up) are shown
      // verbatim — they're system state, not information about a specific account.
      setError(err instanceof ApiError ? err.message : 'Failed to send code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { resetToken: token } = await recoveryApi.verifyOtp(username.trim(), code.trim());
      setResetToken(token);
      setStep('reset');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid or expired code.');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await recoveryApi.resetPassword(resetToken, newPassword);
      setStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reset password. Please start over.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={17} className="text-sky-600" /> Admin Password Recovery
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive font-medium">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 'request' && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <p className="text-xs text-muted-foreground">
              A one-time code will be emailed to the recovery address configured in Settings.
            </p>
            <div className="space-y-1.5">
              <Label>Admin Username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoFocus />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'Send Code'}
            </Button>
          </form>
        )}

        {step === 'verify' && (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Enter the 6-digit code sent to the recovery email. It expires in 10 minutes.
            </p>
            <div className="space-y-1.5">
              <Label>Verification Code</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                className="text-center text-lg tracking-[0.3em] font-mono"
                autoFocus
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'Verify Code'}
            </Button>
            <button
              type="button"
              onClick={() => setStep('request')}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              ← Back
            </button>
          </form>
        )}

        {step === 'reset' && (
          <form onSubmit={handleReset} className="space-y-4">
            <div className="space-y-1.5">
              <Label>New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'Reset Password'}
            </Button>
          </form>
        )}

        {step === 'done' && (
          <div className="text-center space-y-3 py-2">
            <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
            <p className="text-sm font-medium">Password reset. Please log in with your new password.</p>
            <Button onClick={() => onOpenChange(false)} className="w-full">
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
  const [recoveryOpen, setRecoveryOpen] = useState(false);
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

  // Hidden admin recovery shortcut: Ctrl+F opens the OTP dialog. Intercepted here (rather
  // than left to the browser) so it doesn't trigger Chromium's in-page "Find" in Electron.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setRecoveryOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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

      <RecoveryDialog open={recoveryOpen} onOpenChange={setRecoveryOpen} initialUsername={username} />
    </div>
  );
}
