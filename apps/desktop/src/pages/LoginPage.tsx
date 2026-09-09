import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiBaseUrl, setApiBaseUrl } from '@/lib/api-client';
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
  Settings,
  Server,
  CheckCircle2,
  XCircle,
  X,
  Radio,
} from 'lucide-react';
import { AnalogClock } from '@/components/AnalogClock';
import companyLogo from '@/assets/logo.png';

interface ServerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function ServerSettingsModal({ isOpen, onClose }: ServerModalProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const [serverUrl, setServerUrl] = useState(() => getApiBaseUrl());
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    status: string;
    latencyMs: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setServerUrl(getApiBaseUrl());
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await apiClient.testUrl(serverUrl);
      setTestResult(res);
    } catch {
      setTestResult({ ok: false, status: 'Failed to connect', latencyMs: 0 });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    const saved = await setApiBaseUrl(serverUrl);
    setServerUrl(saved);
    void queryClient.invalidateQueries({ queryKey: ['health'] });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in-50 duration-200">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white text-zinc-950 p-6 shadow-2xl animate-in zoom-in-95 duration-150 relative">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-700 transition-colors"
        >
          <X size={18} />
        </button>

        {/* Title Header */}
        <div className="flex items-center gap-3 border-b border-zinc-100 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
            <Server size={20} />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-900 leading-tight">
              Server Connection Settings
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Configure backend host IP or domain for this machine
            </p>
          </div>
        </div>

        {/* Form Body */}
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Backend Server IP or URL
            </label>
            <div className="relative">
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => {
                  setServerUrl(e.target.value);
                  setTestResult(null);
                }}
                placeholder="http://192.168.1.32:3000"
                className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 text-sm font-mono font-medium focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              />
            </div>
            <p className="text-[11px] text-zinc-400">
              Example: <code className="text-zinc-600">http://192.168.1.32:3000</code> or simply <code className="text-zinc-600">192.168.1.32</code>
            </p>
          </div>

          {/* Quick preset buttons */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[11px] text-zinc-400 font-medium">Quick Set:</span>
            <button
              type="button"
              onClick={() => {
                setServerUrl('http://192.168.1.32:3000');
                setTestResult(null);
              }}
              className="text-xs px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-mono transition-colors"
            >
              192.168.1.32
            </button>
            <button
              type="button"
              onClick={() => {
                setServerUrl('http://localhost:3000');
                setTestResult(null);
              }}
              className="text-xs px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-mono transition-colors"
            >
              localhost
            </button>
          </div>

          {/* Test Status Banner */}
          {testResult && (
            <div
              className={`flex items-center gap-2 rounded-xl p-3 text-xs font-medium border ${
                testResult.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              ) : (
                <XCircle size={16} className="text-red-600 shrink-0" />
              )}
              <div className="flex-1">
                <span>
                  {testResult.ok ? 'Connection successful!' : 'Connection failed. Please check IP address.'}
                </span>
                {testResult.ok && (
                  <span className="ml-2 text-[10px] text-emerald-600 font-mono">
                    ({testResult.latencyMs}ms)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-100">
            <Button
              type="button"
              variant="outline"
              disabled={isTesting}
              onClick={handleTest}
              className="h-9 px-4 text-xs font-semibold rounded-xl border-zinc-200 hover:bg-zinc-100"
            >
              {isTesting ? (
                <div className="flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" />
                  <span>Testing...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Radio size={13} />
                  <span>Test Connection</span>
                </div>
              )}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              className="h-9 px-5 text-xs font-semibold rounded-xl bg-sky-600 hover:bg-sky-700 text-white shadow-xs"
            >
              Save & Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthBadge({ onOpenConfig }: { onOpenConfig: () => void }): JSX.Element {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: apiClient.getHealth,
    retry: 1,
    refetchInterval: 10_000,
  });

  const activeUrl = getApiBaseUrl().replace(/^https?:\/\//, '');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-pulse" />
        <span>Connecting to {activeUrl}...</span>
        <button
          type="button"
          onClick={onOpenConfig}
          title="Configure Server"
          className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings size={13} />
        </button>
      </div>
    );
  }

  if (isError || data?.status !== 'ok') {
    return (
      <div className="flex items-center justify-center gap-2 text-xs text-destructive font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-ping" />
        <span>Backend server unreachable ({activeUrl})</span>
        <button
          type="button"
          onClick={onOpenConfig}
          className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-md bg-destructive/10 hover:bg-destructive/20 text-destructive text-[11px] font-semibold transition-colors"
          title="Change Server IP"
        >
          <Settings size={11} />
          <span>Change IP</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-2 text-xs text-emerald-600 font-medium">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      <span>System online · {activeUrl}</span>
      <button
        type="button"
        onClick={onOpenConfig}
        className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-zinc-100"
        title="Server Settings"
      >
        <Settings size={12} />
      </button>
    </div>
  );
}

export function LoginPage(): JSX.Element {
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState(() => {
    try {
      const saved = localStorage.getItem('atten_remember_login');
      if (saved) return JSON.parse(saved).username || '';
    } catch {
      /* ignore */
    }
    return '';
  });
  const [password, setPassword] = useState(() => {
    try {
      const saved = localStorage.getItem('atten_remember_login');
      if (saved) return JSON.parse(saved).password || '';
    } catch {
      /* ignore */
    }
    return '';
  });
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
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
      } else if (message.includes('fetch') || message.includes('network') || message.includes('connect') || message.includes('ECONNREFUSED') || message.includes('Failed to fetch')) {
        setError('Cannot reach server at ' + getApiBaseUrl() + '. Click Change IP below if needed.');
      } else {
        setError(message || 'Login failed. Please check your credentials or connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-zinc-100/70 p-4 lg:p-8">
      {/* Dynamic Server Config Modal */}
      <ServerSettingsModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} />

      {/* Background ambient lighting */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-1/3 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-200/40 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/3 h-[500px] w-[500px] translate-x-1/2 translate-y-1/2 rounded-full bg-indigo-200/30 blur-[100px]" />
      </div>

      {/* Main Dual-Panel Container */}
      <div className="flex w-full max-w-4xl overflow-hidden rounded-3xl border border-border/80 bg-card shadow-2xl shadow-zinc-950/10 transition-all">
        {/* Left Side: Clean Login Form */}
        <div className="flex w-full flex-col justify-between p-8 sm:p-12 lg:w-1/2 bg-card">
          <div>
            {/* Top Logo */}
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

              {/* Submit Button */}
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

          {/* Bottom Health Indicator with Config Button */}
          <div className="mt-8 pt-4 border-t border-border/50 text-center">
            <HealthBadge onOpenConfig={() => setIsConfigOpen(true)} />
          </div>
        </div>

        {/* Right Side: Modern Minimalist Analog & Digital Watch Panel */}
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
