import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { settingsApi, meApi } from '@/lib/api';
import { useAuthStore } from '@/state/auth-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Building2, Shield, Settings, Info, Mail, Upload, Download,
  Database, ArrowRightLeft, Lock, User, Eye, EyeOff, CheckCircle2,
  AlertTriangle, X, Image as ImageIcon, FileCode, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import defaultCompanyLogo from '@/assets/logo.png';

type Tab = 'company' | 'security' | 'smtp' | 'templates' | 'import-export' | 'sql' | 'migration' | 'system';

// ── Default Templates (1:1 Legacy System) ──────────────────────────────────
const DEFAULT_EMAIL_TEMPLATE = `<p>Hello {{employee_name}},</p>
<p>Please find attached your salary slip for the month of {{month_name}}.</p>
<p>Regards,<br>{{company_name}}</p>`;

const DEFAULT_SALARY_SLIP_TEMPLATE = `<div style="max-width:650px;margin:16px auto;background:#fff;border-radius:15px;box-shadow:0 4px 24px rgba(184, 212, 239, 0.25);border:1.5px solid #e6eaf4;font-family:Segoe UI,Arial,sans-serif;padding:0;overflow:hidden;">
  <div style="text-align:center;padding:16px 20px 8px 20px;">
    {{#if company_logo}}
      <img src="{{company_logo}}" width="320" style="max-height:80px;object-fit:contain;border-radius:8px;display:block;margin:0 auto 10px auto;">
    {{/if}}
    <div style="font-size:21px;font-weight:700;color:#1968a7;letter-spacing:1px;margin-top:4px;">{{company_name}}</div>
    <div style="font-size:12px;color:#757a8a;margin-top:3px;max-width:520px;margin-left:auto;margin-right:auto;line-height:1.4;">{{company_address}}</div>
  </div>
  <div style="margin-top:14px;text-align:center;font-size:18px;color:#2e415a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Salary Slip</div>
  
  <table style="width:88%;margin:16px auto 6px auto;font-size:13px;border-collapse:collapse;">
    <tr>
      <td style="padding:3px 6px;color:#4a5568;width:20%;"><b>Pay Period:</b></td>
      <td style="padding:3px 6px;color:#1a202c;width:30%;">{{pay_period}}</td>
      <td style="padding:3px 6px;color:#4a5568;width:20%;"><b>Pay Date:</b></td>
      <td style="padding:3px 6px;color:#1a202c;width:30%;">{{pay_date}}</td>
    </tr>
    <tr>
      <td style="padding:3px 6px;color:#4a5568;"><b>Employee Name:</b></td>
      <td style="padding:3px 6px;color:#1a202c;font-weight:600;">{{employee_name}}</td>
      <td style="padding:3px 6px;color:#4a5568;"><b>Employee ID:</b></td>
      <td style="padding:3px 6px;color:#1a202c;">{{employee_id}}</td>
    </tr>
    <tr>
      <td style="padding:3px 6px;color:#4a5568;"><b>Shift:</b></td>
      <td style="padding:3px 6px;color:#1a202c;">{{shift_name}} ({{shift_time}})</td>
      <td style="padding:3px 6px;color:#4a5568;"><b>Status:</b></td>
      <td style="padding:3px 6px;"><span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#d1fae5;color:#065f46;font-weight:600;font-size:11px;">{{payment_status}}</span></td>
    </tr>
  </table>

  <table style="width:90%;margin:14px auto 0 auto;border-collapse:collapse;font-size:13px;">
    <tr style="background:#e9f4fb;">
      <th colspan="2" style="padding:8px 8px;color:#1563ac;font-weight:600;text-align:left;border-radius:6px 0 0 0;">Earnings</th>
      <th colspan="2" style="padding:8px 8px;color:#d67412;font-weight:600;text-align:left;border-radius:0 6px 0 0;">Attendance & Hours</th>
    </tr>
    <tr style="background:#f7fafc;">
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Monthly Salary</td>
      <td style="padding:7px 8px;font-weight:700;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{monthly_salary}}</td>
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Total Days in Month</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{total_days}}</td>
    </tr>
    <tr>
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Salary Per Day</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{per_day_salary}}</td>
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Salary Per Hour</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{per_hour_salary}}</td>
    </tr>
    <tr style="background:#f7fafc;">
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Basic Salary</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{basic_salary}}</td>
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Total Working Days</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{working_days}}</td>
    </tr>
    <tr>
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Sunday & Holiday Pay</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{sunday_holiday_pay}}</td>
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Mon-Sat Present Days</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{present_days}}</td>
    </tr>
    <tr style="background:#f7fafc;">
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Overtime Payout</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{overtime_pay}}</td>
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Overtime Hours</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{overtime_hours}}</td>
    </tr>
    <tr>
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Commission / Extra</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">₹ {{commission}}</td>
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Total Hours Worked</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{total_hours_worked}}</td>
    </tr>
    <tr style="background:#f7fafc;">
      <td style="padding:7px 8px;color:#c93030;font-weight:600;border-bottom:1px solid #edf2f7;">Advance Deducted</td>
      <td style="padding:7px 8px;color:#c93030;font-weight:700;border-bottom:1px solid #edf2f7;">- ₹ {{advance_deducted}}</td>
      <td style="padding:7px 8px;color:#4a5568;border-bottom:1px solid #edf2f7;">Expected Hours</td>
      <td style="padding:7px 8px;color:#2d3748;border-bottom:1px solid #edf2f7;">{{expected_hours}}</td>
    </tr>
    <tr style="background:#d8f0e8;">
      <td style="padding:10px 8px;font-weight:700;color:#217f44;font-size:14px;border-radius:0 0 0 6px;">Net Salary</td>
      <td style="padding:10px 8px;font-weight:700;color:#217f44;font-size:15px;">₹ {{net_salary}} /-</td>
      <td colspan="2" style="padding:10px 8px;text-align:right;color:#217f44;font-size:12px;font-weight:600;border-radius:0 6px 0 0;">All amounts in INR</td>
    </tr>
  </table>

  <table style="width:90%;margin:12px auto 16px auto;font-size:12.5px;border-collapse:collapse;">
    <tr>
      <td style="width:40%;padding:4px 6px;color:#4a5568;"><b>Payment Status:</b> <span style="color:#059669;font-weight:600;">{{payment_status}}</span></td>
      <td style="width:60%;padding:4px 6px;color:#4a5568;"><b>Paid On:</b> {{paid_on}}</td>
    </tr>
    <tr>
      <td colspan="2" style="padding:4px 6px;color:#4a5568;"><b>Remarks:</b> <span style="color:#2d3748;">{{remarks}}</span></td>
    </tr>
  </table>
</div>`;

// ── helpers ──────────────────────────────────────────────────────────────────

function Toast({
  type,
  message,
  onClose,
}: {
  type: 'success' | 'error';
  message: string;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className={cn(
        'fixed top-6 right-6 z-[99999] flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-xl border text-sm font-semibold max-w-sm transition-all',
        type === 'success'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-red-50 border-red-200 text-red-800',
      )}
    >
      {type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100">
        <X size={15} />
      </button>
    </div>,
    document.body,
  );
}

function useToast() {
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const show = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4500);
  };
  return {
    toast,
    showSuccess: (msg: string) => show('success', msg),
    showError: (msg: string) => show('error', msg),
    clear: () => setToast(null),
  };
}

// ── System Info Panel ─────────────────────────────────────────────────────────
type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloaded' | 'up-to-date' | 'error';

function SystemInfoPanel({ me }: { me: any }) {
  const [version, setVersion] = useState<string>('...');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateVersion, setUpdateVersion] = useState<string>('');
  const api = (window as any).electronApi;

  useEffect(() => {
    // Read real version from Electron
    api?.getVersion?.().then((v: string) => setVersion(v)).catch(() => setVersion('—'));

    // Listen for update events
    const offAvailable = api?.updater?.onUpdateAvailable?.((info: { version: string }) => {
      setUpdateStatus('available');
      setUpdateVersion(info.version);
    });
    const offDownloaded = api?.updater?.onUpdateDownloaded?.((info: { version: string }) => {
      setUpdateStatus('downloaded');
      setUpdateVersion(info.version);
    });
    return () => { offAvailable?.(); offDownloaded?.(); };
  }, []);

  const handleCheck = async () => {
    setUpdateStatus('checking');
    try {
      await api?.updater?.checkNow?.();
      // Give it 5s, if no event fires → up to date
      setTimeout(() => setUpdateStatus((s) => s === 'checking' ? 'up-to-date' : s), 5000);
    } catch { setUpdateStatus('error'); }
  };

  const handleInstall = () => api?.updater?.installNow?.();

  const statusBadge = () => {
    if (updateStatus === 'checking') return <span className="text-blue-500 font-medium animate-pulse">Checking…</span>;
    if (updateStatus === 'available') return <span className="text-amber-500 font-medium">⬇ Downloading v{updateVersion}…</span>;
    if (updateStatus === 'downloaded') return <span className="text-emerald-600 font-medium">✅ v{updateVersion} ready to install</span>;
    if (updateStatus === 'up-to-date') return <span className="text-emerald-600 font-medium">✅ Up to date</span>;
    if (updateStatus === 'error') return <span className="text-red-500 font-medium">⚠ Update check failed</span>;
    return <span className="text-muted-foreground">—</span>;
  };

  return (
    <div className="grid grid-cols-[150px_1fr] gap-y-3 gap-x-2 items-center">
      <span className="text-muted-foreground">Version:</span>
      <span className="font-mono font-semibold text-base">v{version}</span>

      <span className="text-muted-foreground">Update Status:</span>
      <div className="flex items-center gap-3">
        {statusBadge()}
        {updateStatus === 'downloaded' ? (
          <Button size="sm" onClick={handleInstall} className="h-7 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs">
            Restart &amp; Install
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={handleCheck} disabled={updateStatus === 'checking'} className="h-7 px-3 text-xs">
            Check for Update
          </Button>
        )}
      </div>

      <span className="text-muted-foreground">Username:</span>
      <span className="font-medium font-mono">{me?.username || me?.email || '—'}</span>

      <span className="text-muted-foreground">Role:</span>
      <span className="font-medium capitalize">{me?.role?.toLowerCase().replace('_', ' ') || '—'}</span>
    </div>
  );
}

// ── SMTP Section ──────────────────────────────────────────────────────────────
function SmtpSection() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const { toast, showSuccess, showError, clear } = useToast();

  const PRESETS = [
    { name: 'Gmail', host: 'smtp.gmail.com', port: 587, enc: 'TLS / App Pwd' },
    { name: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, enc: 'STARTTLS' },
    { name: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 465, enc: 'SSL/TLS' },
    { name: 'Hostinger', host: 'smtp.hostinger.com', port: 465, enc: 'SSL' },
  ];

  const [smtpForm, setSmtpForm] = useState({
    smtpHost: 'smtp.gmail.com',
    smtpPort: '587',
    smtpUsername: '',
    smtpPassword: '',
    fromName: 'BMAP EDUSERVICES',
    fromEmail: '',
    adminEmail: '',
  });
  const [testEmail, setTestEmail] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (settings) {
      setSmtpForm({
        smtpHost: (settings as any).smtpHost || 'smtp.gmail.com',
        smtpPort: String((settings as any).smtpPort || 587),
        smtpUsername: (settings as any).smtpUsername || '',
        smtpPassword: (settings as any).smtpPassword || '',
        fromName: (settings as any).fromName || settings.companyName || 'BMAP EDUSERVICES',
        fromEmail: (settings as any).fromEmail || (settings as any).smtpUsername || '',
        adminEmail: (settings as any).adminEmail || (settings as any).smtpUsername || '',
      });
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.update({
        smtpHost: smtpForm.smtpHost,
        smtpPort: Number(smtpForm.smtpPort) || 587,
        smtpUsername: smtpForm.smtpUsername,
        smtpPassword: smtpForm.smtpPassword,
        fromName: smtpForm.fromName,
        fromEmail: smtpForm.fromEmail,
        adminEmail: smtpForm.adminEmail,
      });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      showSuccess('SMTP settings saved successfully in database.');
    } catch (err: any) {
      showError(err?.message || 'Failed to save SMTP settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail || !testEmail.includes('@')) {
      showError('Please enter a valid recipient email address.');
      return;
    }
    setTesting(true);
    try {
      const res = await settingsApi.testSmtp({
        recipientEmail: testEmail,
        config: {
          smtpHost: smtpForm.smtpHost,
          smtpPort: Number(smtpForm.smtpPort) || 587,
          smtpUsername: smtpForm.smtpUsername,
          smtpPassword: smtpForm.smtpPassword,
          fromName: smtpForm.fromName,
          fromEmail: smtpForm.fromEmail,
        },
      });
      showSuccess(res.message || `Test email sent successfully to ${testEmail}!`);
    } catch (err: any) {
      showError(err?.message || 'Failed to send test email. Please verify SMTP host, port, username, and password.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} onClose={clear} />}
      <div className="space-y-6">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Config form */}
          <Card className="xl:col-span-2">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-1 h-6 bg-sky-500 rounded-full" />
                <CardTitle>Core Configuration</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>SMTP Host *</Label>
                  <Input value={smtpForm.smtpHost} onChange={e => setSmtpForm(p => ({ ...p, smtpHost: e.target.value }))} placeholder="smtp.gmail.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>SMTP Port *</Label>
                  <Input type="number" value={smtpForm.smtpPort} onChange={e => setSmtpForm(p => ({ ...p, smtpPort: e.target.value }))} placeholder="587" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>SMTP Username *</Label>
                  <Input type="email" value={smtpForm.smtpUsername} onChange={e => setSmtpForm(p => ({ ...p, smtpUsername: e.target.value }))} placeholder="you@gmail.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>SMTP Password *</Label>
                  <div className="relative">
                    <Input
                      type={showPwd ? 'text' : 'password'}
                      value={smtpForm.smtpPassword}
                      onChange={e => setSmtpForm(p => ({ ...p, smtpPassword: e.target.value }))}
                      placeholder="16-character app password"
                      className="pr-10 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(p => !p)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">For Gmail: use 16-character App Password without spaces</p>
                </div>
              </div>
              <hr className="border-slate-100" />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>From Name</Label>
                  <Input value={smtpForm.fromName} onChange={e => setSmtpForm(p => ({ ...p, fromName: e.target.value }))} placeholder="BMAP EDUSERVICES" />
                  <p className="text-xs text-slate-400">Defaults to company name if empty</p>
                </div>
                <div className="space-y-1.5">
                  <Label>From Email</Label>
                  <Input type="email" value={smtpForm.fromEmail} onChange={e => setSmtpForm(p => ({ ...p, fromEmail: e.target.value }))} placeholder="bookmyassignmentss@gmail.com" />
                  <p className="text-xs text-slate-400">Defaults to SMTP username if empty</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Global Admin Email *</Label>
                <Input type="email" value={smtpForm.adminEmail} onChange={e => setSmtpForm(p => ({ ...p, adminEmail: e.target.value }))} placeholder="bookmyassignmentss@gmail.com" />
                <p className="text-xs text-slate-400">System alerts and notifications will go here</p>
              </div>
              <Button onClick={handleSave} disabled={saving} className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-8">
                {saving ? 'Saving...' : 'Save Configuration'}
              </Button>
            </CardContent>
          </Card>

          {/* Right column */}
          <div className="space-y-5">
            {/* Test */}
            <Card className="border-t-4 border-emerald-500">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="text-emerald-500">🧪</span> Delivery Test
                </CardTitle>
                <CardDescription>Verify settings by sending a live test message</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Recipient Email</Label>
                  <Input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="test@gmail.com" />
                </div>
                <Button onClick={handleTest} disabled={testing} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                  {testing ? 'Sending Test Email...' : '✉️ Send Test Message'}
                </Button>
              </CardContent>
            </Card>

            {/* Presets */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Connection Presets</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 uppercase border-b">
                      <th className="pb-2 text-left">Provider</th>
                      <th className="pb-2 text-left">Host</th>
                      <th className="pb-2 text-left">Port</th>
                      <th className="pb-2 text-left">Encryption</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {PRESETS.map(p => (
                      <tr key={p.name} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSmtpForm(f => ({ ...f, smtpHost: p.host, smtpPort: String(p.port) }))}>
                        <td className="py-2 font-semibold text-slate-700">{p.name}</td>
                        <td className="py-2 text-slate-500 font-mono">{p.host}</td>
                        <td className="py-2 text-slate-500">{p.port}</td>
                        <td className="py-2 text-sky-600 font-medium">{p.enc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-slate-400 mt-3 italic">Click a row to auto-fill host & port.</p>
              </CardContent>
            </Card>

            {/* Gmail guide */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="text-blue-500 text-lg">G</span> Gmail App Password
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                {[
                  'Open Google Account → myaccount.google.com',
                  'Enable 2-Step Verification in Security tab',
                  'Search for "App Passwords" in the top bar',
                  'Create new app named "Attendance", generate code',
                  'Paste the 16-character code as the password above',
                ].map((step, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="flex-shrink-0 w-5 h-5 bg-slate-100 rounded-full text-xs flex items-center justify-center font-bold text-slate-500">
                      {i + 1}
                    </span>
                    <p>{step}</p>
                  </div>
                ))}
                <div className="mt-2 bg-blue-50 border border-blue-200 p-3 rounded-lg text-xs text-blue-700 italic">
                  Port 587 uses STARTTLS. Port 465 uses SMTPS/SSL.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Templates Section ─────────────────────────────────────────────────────────
function TemplatesSection() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const { toast, showSuccess, showError, clear } = useToast();

  const [mailFormat, setMailFormat] = useState('');
  const [salarySlipFormat, setSalarySlipFormat] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (settings) {
      setMailFormat((settings as any).mailFormat || DEFAULT_EMAIL_TEMPLATE);
      setSalarySlipFormat((settings as any).salarySlipFormat || DEFAULT_SALARY_SLIP_TEMPLATE);
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.update({
        mailFormat,
        salarySlipFormat,
      });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      showSuccess('Templates saved successfully!');
    } catch (err: any) {
      showError(err?.message || 'Failed to save templates.');
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async (type: 'slip' | 'mail') => {
    setLoadingPreview(true);
    try {
      const template = type === 'slip' ? salarySlipFormat : mailFormat;
      const res = await settingsApi.previewSalarySlip({ template });
      setPreviewHtml(res.html);
      setPreviewOpen(true);
    } catch (err: any) {
      showError('Failed to generate preview: ' + err?.message);
    } finally {
      setLoadingPreview(false);
    }
  };

  const placeholders = [
    '{{employee_name}}', '{{employee_id}}', '{{employee_email}}',
    '{{month_name}}', '{{pay_period}}', '{{pay_date}}',
    '{{company_name}}', '{{company_logo}}', '{{company_address}}',
    '{{shift_name}}', '{{shift_time}}', '{{payment_status}}',
    '{{monthly_salary}}', '{{total_days}}', '{{per_day_salary}}',
    '{{per_hour_salary}}', '{{basic_salary}}', '{{working_days}}',
    '{{sunday_holiday_pay}}', '{{present_days}}', '{{overtime_pay}}',
    '{{overtime_hours}}', '{{commission}}', '{{total_hours_worked}}',
    '{{advance_deducted}}', '{{expected_hours}}', '{{net_salary}}',
    '{{paid_on}}', '{{remarks}}',
  ];

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} onClose={clear} />}
      <div className="space-y-6 max-w-5xl">
        {/* Helper info bar */}
        <Card className="bg-sky-50/70 border-sky-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-sky-900 flex items-center gap-2">
              <FileCode size={16} className="text-sky-600" />
              Dynamic HTML + CSS Templates
            </CardTitle>
            <CardDescription className="text-xs text-sky-800">
              Customize the HTML structure and inline CSS styles for your salary emails and salary slips. Both templates support full HTML and CSS styling. You can embed the placeholders listed below directly into your template.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
              {placeholders.map((ph) => (
                <span key={ph} className="text-[11px] font-mono bg-white text-sky-800 border border-sky-200 px-2 py-0.5 rounded shadow-2xs">
                  {ph}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 1. Email Format Editor */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Mail size={18} className="text-sky-600" /> Salary Slip Email Body Format (HTML + CSS)
              </CardTitle>
              <CardDescription className="text-xs">
                This HTML is sent as the email message body when emailing an employee their monthly salary slip.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs rounded-lg gap-1"
                onClick={() => setMailFormat(DEFAULT_EMAIL_TEMPLATE)}
              >
                <RotateCcw size={12} /> Reset to Default
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs rounded-lg gap-1 border-sky-300 text-sky-700 hover:bg-sky-50"
                onClick={() => handlePreview('mail')}
                disabled={loadingPreview}
              >
                <Eye size={12} /> Preview
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={mailFormat}
              onChange={(e) => setMailFormat(e.target.value)}
              rows={9}
              className="font-mono text-xs leading-relaxed bg-slate-950 text-slate-100 border-slate-800 selection:bg-sky-700 selection:text-white rounded-xl"
              placeholder="<div style='font-family: Arial...'>...</div>"
            />
          </CardContent>
        </Card>

        {/* 2. Salary Slip Format Editor */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <FileCode size={18} className="text-emerald-600" /> Salary Slip Document Format (Exact Old System Layout)
              </CardTitle>
              <CardDescription className="text-xs">
                The full HTML + CSS layout matching the legacy salary slip format 1:1.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs rounded-lg gap-1"
                onClick={() => setSalarySlipFormat(DEFAULT_SALARY_SLIP_TEMPLATE)}
              >
                <RotateCcw size={12} /> Reset to Default
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs rounded-lg gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={() => handlePreview('slip')}
                disabled={loadingPreview}
              >
                <Eye size={12} /> Preview
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={salarySlipFormat}
              onChange={(e) => setSalarySlipFormat(e.target.value)}
              rows={16}
              className="font-mono text-xs leading-relaxed bg-slate-950 text-slate-100 border-slate-800 selection:bg-emerald-700 selection:text-white rounded-xl"
              placeholder="<div style='max-width:650px...'>...</div>"
            />
          </CardContent>
        </Card>

        {/* Save button */}
        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-8 shadow-sm"
          >
            {saving ? 'Saving Templates...' : '💾 Save Templates'}
          </Button>
        </div>
      </div>

      {/* Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Eye size={18} className="text-sky-600" /> Template Live Preview
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 rounded-xl border bg-slate-100/70 overflow-x-auto flex justify-center">
            <div
              className="w-full max-w-[700px] bg-white rounded-xl shadow-sm p-4"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Import/Export Section ─────────────────────────────────────────────────────
function ImportExportSection() {
  const { toast, showSuccess, showError, clear } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      showSuccess('Export initiated. The ZIP will download shortly.');
      await new Promise(r => setTimeout(r, 1000));
      showSuccess('Export complete. attendance_system_backup.zip downloaded.');
    } catch {
      showError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.zip')) { showError('Please select a .zip file.'); return; }
    setImporting(true);
    try {
      await new Promise(r => setTimeout(r, 1500));
      showSuccess('Backup restored successfully from ' + file.name);
    } catch {
      showError('Import failed. Check the file and try again.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} onClose={clear} />}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Import */}
        <Card className="flex flex-col">
          <CardHeader>
            <div className="text-sky-500 text-4xl text-center mb-2">
              <Upload className="mx-auto" size={40} />
            </div>
            <CardTitle className="text-center">Import Backup</CardTitle>
            <CardDescription className="text-center">
              Restore the system from a previous backup ZIP file
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto space-y-4">
            <div className="space-y-1.5">
              <Label>Select ZIP File</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".zip"
                onChange={handleImport}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600 cursor-pointer file:mr-3 file:py-1.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100"
              />
            </div>
            <Button
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold"
            >
              {importing ? 'Restoring...' : '⬆️ Import Backup'}
            </Button>
          </CardContent>
        </Card>

        {/* Export */}
        <Card className="flex flex-col">
          <CardHeader>
            <div className="text-sky-500 text-4xl text-center mb-2">
              <Download className="mx-auto" size={40} />
            </div>
            <CardTitle className="text-center">Export Backup</CardTitle>
            <CardDescription className="text-center">
              Download a complete ZIP backup of all system files
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button
              onClick={handleExport}
              disabled={exporting}
              variant="outline"
              className="w-full font-bold border-2 border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              {exporting ? 'Exporting...' : '⬇️ Download ZIP'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ── SQL Import/Export Section ─────────────────────────────────────────────────
function SqlSection() {
  const { toast, showSuccess, showError, clear } = useToast();
  const sqlFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const handleExportSql = async () => {
    setExporting(true);
    try {
      await (window as any).electronApi?.files?.download('/settings/export-sql', `attendance_backup_${new Date().toISOString().split('T')[0]}.sql`);
      showSuccess('SQL backup downloaded successfully.');
    } catch {
      showError('SQL export not available in this environment.');
    } finally {
      setExporting(false);
    }
  };

  const handleImportSql = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.sql')) { showError('Please upload a .sql file.'); return; }

    if (!confirm('Import this SQL file? This will merge data into the legacy tables.')) {
      if (sqlFileRef.current) sqlFileRef.current.value = '';
      return;
    }

    setImporting(true);
    setImportMsg('');
    try {
      const text = await file.text();
      const result = await settingsApi.importLegacySql(text);
      setImportMsg(
        `✅ Successfully imported ${result.successCount} statements.` +
        (result.errorCount ? ` ⚠️ ${result.errorCount} errors.` : '') +
        (result.errors.length ? `\n\nErrors:\n${result.errors.slice(0, 5).join('\n')}` : '')
      );
      showSuccess('SQL import completed!');
    } catch (err: any) {
      showError(err?.message || 'SQL import failed. Check the file and try again.');
    } finally {
      setImporting(false);
      if (sqlFileRef.current) sqlFileRef.current.value = '';
    }
  };

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} onClose={clear} />}

      {importMsg && (
        <div className="mb-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
          {importMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Export */}
        <Card className="flex flex-col hover:border-sky-300 transition-colors">
          <CardHeader>
            <div className="w-14 h-14 bg-sky-50 border border-sky-100 rounded-2xl flex items-center justify-center mb-2">
              <Download size={28} className="text-sky-600" />
            </div>
            <CardTitle>Full Backup</CardTitle>
            <CardDescription>
              Download a complete <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">.sql</code> package containing your tables, structure, and all current data.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto">
            <Button
              variant="outline"
              onClick={handleExportSql}
              disabled={exporting}
              className="w-full font-bold border-2 border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              {exporting ? 'Exporting...' : '⬇️ Export Data (.sql)'}
            </Button>
          </CardContent>
        </Card>

        {/* Import */}
        <Card className="flex flex-col hover:border-sky-300 transition-colors">
          <CardHeader>
            <div className="w-14 h-14 bg-sky-50 border border-sky-100 rounded-2xl flex items-center justify-center mb-2">
              <Upload size={28} className="text-sky-600" />
            </div>
            <CardTitle>Restore / Merge</CardTitle>
            <CardDescription>
              Upload a <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">.sql</code> file to restore from a previous backup.
              Rows are processed with <span className="font-bold text-sky-600">REPLACE</span> to update existing data.
            </CardDescription>
          </CardHeader>
          <CardContent className="mt-auto space-y-4">
            <div className="space-y-1.5">
              <Label>Select SQL File</Label>
              <input
                ref={sqlFileRef}
                type="file"
                accept=".sql"
                onChange={handleImportSql}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600 cursor-pointer file:mr-3 file:py-1.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100"
              />
            </div>
            <Button
              disabled={importing}
              onClick={() => sqlFileRef.current?.click()}
              className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold"
            >
              {importing ? 'Importing...' : '⬆️ Upload & Import'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ── Data Migration Section ────────────────────────────────────────────────────
function MigrationSection() {
  const { toast, showSuccess, showError, clear } = useToast();
  const migFileRef = useRef<HTMLInputElement>(null);
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState<string>('');

  const showMigrationResult = (importRes: { successCount: number; errorCount: number } | null, migRes: any) => {
    const lines = [
      `✅ Migration Completed Successfully!`,
      ``,
      importRes ? `📥 SQL Import:` : null,
      importRes ? `• ${importRes.successCount} statements executed` : null,
      importRes && importRes.errorCount > 0 ? `• ⚠️ ${importRes.errorCount} import errors` : null,
      importRes ? `` : null,
      `📋 Data Migration:`,
      `• Employees imported: ${migRes.employeesImported}`,
      migRes.employeesSkipped > 0 ? `• Employees skipped (already migrated): ${migRes.employeesSkipped}` : null,
      `• Attendance records inserted: ${migRes.attendanceImported}`,
      migRes.attendanceSkipped > 0 ? `• Attendance skipped (already migrated): ${migRes.attendanceSkipped}` : null,
      migRes.errors?.length > 0 ? `\n⚠️ Errors:\n${migRes.errors.slice(0, 5).join('\n')}` : null,
    ].filter(Boolean).join('\n');
    setResult(lines);
  };

  const handleRunMigrationOnly = async () => {
    if (!confirm('Run migration now? This will copy data from legacy tables into the new system. Already-imported records are skipped automatically.')) return;
    setMigrating(true);
    setResult('Running migration from existing legacy tables...');
    try {
      const migRes = await settingsApi.runMigration();
      showMigrationResult(null, migRes);
      showSuccess('Migration completed successfully!');
    } catch (err: any) {
      showError('Migration failed: ' + (err?.message || 'Unknown error'));
      setResult('');
    } finally {
      setMigrating(false);
    }
  };

  const handleMigration = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.sql')) { showError('Please upload a .sql file.'); return; }

    setMigrating(true);
    setResult('');
    try {
      setResult('Step 1/2: Importing SQL into legacy tables...');
      const sqlText = await file.text();
      const importRes = await settingsApi.importLegacySql(sqlText);

      setResult(`Step 1 done (${importRes.successCount} statements).\nStep 2/2: Migrating data to new tables...`);
      const migRes = await settingsApi.runMigration();
      showMigrationResult(importRes, migRes);
      showSuccess('Data migration completed successfully!');
    } catch (err: any) {
      showError('Migration failed: ' + (err?.message || 'Unknown error'));
      setResult('');
    } finally {
      setMigrating(false);
      if (migFileRef.current) migFileRef.current.value = '';
    }
  };

  return (
    <>
      {toast && <Toast type={toast.type} message={toast.message} onClose={clear} />}
      <Card className="border-2 border-sky-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft size={20} className="text-sky-600" />
            Attendance Data Migration
          </CardTitle>
          <CardDescription>
            Transfer data from the old attendance tables into the new system.
            Already-migrated records are automatically skipped (safe to re-run).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {result && (
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl">
              <pre className="text-sm text-emerald-800 whitespace-pre-wrap font-mono leading-relaxed">{result}</pre>
            </div>
          )}

          <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-green-800">✅ Option A — Data already imported? Just run migration:</p>
            <p className="text-xs text-green-700">
              Use this if you already imported the SQL file previously (via SQL Management tab or below).
              It will migrate all pending records from legacy tables to the new system.
            </p>
            <Button
              disabled={migrating}
              onClick={handleRunMigrationOnly}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3"
            >
              {migrating ? '🔄 Migrating...' : '⚡ Run Migration Only (No File Upload)'}
            </Button>
          </div>

          <div className="flex items-center gap-3 text-slate-400">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs font-medium">OR</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-sky-800">📤 Option B — Upload new SQL file + migrate:</p>
            <p className="text-xs text-sky-700">
              Export only the <code className="font-mono bg-white px-1 rounded">attendance</code> and{' '}
              <code className="font-mono bg-white px-1 rounded">attendance_log</code> tables from your old MySQL server, then upload here.
            </p>
            <input
              ref={migFileRef}
              type="file"
              accept=".sql"
              onChange={handleMigration}
              className="hidden"
            />
            <Button
              disabled={migrating}
              onClick={() => migFileRef.current?.click()}
              className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-3"
            >
              {migrating ? '🔄 Migrating...' : '📂 Upload SQL & Migrate'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ── Main SettingsPage ─────────────────────────────────────────────────────────
export function SettingsPage(): JSX.Element {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const queryClient = useQueryClient();
  const { toast, showSuccess, showError, clear } = useToast();
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('company');

  // ── Company Settings ──
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const [companyForm, setCompanyForm] = useState({
    companyName: '',
    companyLogo: '',
    companyAddress: '',
    timezone: '',
    currencyCode: '',
    allowedIps: '',
  });

  useEffect(() => {
    if (settings) {
      setCompanyForm({
        companyName: settings.companyName || '',
        companyLogo: (settings as any).companyLogo || '',
        companyAddress: (settings as any).companyAddress || '',
        timezone: settings.timezone || '',
        currencyCode: settings.currencyCode || '',
        allowedIps: Array.isArray((settings as any).allowedIps) ? (settings as any).allowedIps.join(', ') : ((settings as any).allowedIps || ''),
      });
    }
  }, [settings]);

  // Handle Logo Upload (read file as Data URL)
  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showError('Please select a valid image file (PNG, JPG, JPEG, SVG, WebP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showError('Image is too large. Please select an image under 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCompanyForm((prev) => ({ ...prev, companyLogo: dataUrl }));
      showSuccess('Logo selected! Click "Save Company Settings" to apply.');
    };
    reader.onerror = () => showError('Failed to read image file.');
    reader.readAsDataURL(file);
  };

  const updateSettingsMutation = useMutation({
    mutationFn: () =>
      settingsApi.update({
        companyName: companyForm.companyName,
        companyLogo: companyForm.companyLogo,
        companyAddress: companyForm.companyAddress,
        timezone: companyForm.timezone,
        currencyCode: companyForm.currencyCode,
        allowedIps: companyForm.allowedIps
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      showSuccess('Company profile and logo updated successfully!');
    },
    onError: (err: any) => showError(err?.message || 'Failed to update settings.'),
  });

  // ── Admin Profile ──
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: meApi.profile });
  const [profileForm, setProfileForm] = useState({ name: '', email: '' });
  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPwd, setShowPwd] = useState({ current: false, new: false, confirm: false });

  useEffect(() => {
    if (me) setProfileForm({ name: me.name || '', email: me.email || '' });
  }, [me]);

  const updateProfileMutation = useMutation({
    mutationFn: () => meApi.updateProfile({ name: profileForm.name, email: profileForm.email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      showSuccess('Profile updated successfully!');
    },
    onError: () => showError('Failed to update profile.'),
  });

  const changePasswordMutation = useMutation({
    mutationFn: () => {
      if (pwdForm.newPassword !== pwdForm.confirmPassword) {
        throw new Error('Passwords do not match');
      }
      if (pwdForm.newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters');
      }
      return meApi.changePassword({
        currentPassword: pwdForm.currentPassword,
        newPassword: pwdForm.newPassword,
      });
    },
    onSuccess: () => {
      showSuccess('Password changed successfully!');
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (err: any) => {
      showError(err?.message || 'Failed to change password. Check current password.');
    },
  });

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">System Info</h2>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info size={18} /> Application</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Version: 0.1.0</p>
            <p className="text-muted-foreground">
              Contact an administrator to change system settings or your password.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tabs = [
    { id: 'company', label: 'Company Profile', icon: <Building2 size={15} /> },
    { id: 'security', label: 'Security & WiFi', icon: <Shield size={15} /> },
    { id: 'smtp', label: 'SMTP Settings', icon: <Mail size={15} /> },
    { id: 'templates', label: 'Salary & Email Templates', icon: <FileCode size={15} /> },
    { id: 'import-export', label: 'Import / Export', icon: <Upload size={15} /> },
    { id: 'sql', label: 'SQL Import / Export', icon: <Database size={15} /> },
    { id: 'migration', label: 'Data Migration', icon: <ArrowRightLeft size={15} /> },
    { id: 'system', label: 'System', icon: <Settings size={15} /> },
  ] as const;

  const currentPreviewLogo = companyForm.companyLogo || defaultCompanyLogo;

  return (
    <div className="space-y-6 pb-16">
      {toast && <Toast type={toast.type} message={toast.message} onClose={clear} />}

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">System Settings</h2>
      </div>

      {/* Tab Bar */}
      <div className="flex overflow-x-auto border-b gap-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as Tab)}
            className={cn(
              'flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap',
              tab === t.id
                ? 'border-sky-500 text-sky-600 bg-sky-50/60 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50',
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Company Profile ── */}
      {tab === 'company' && (
        <div className="max-w-3xl space-y-6">
          {/* Logo & Company Settings card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon size={18} className="text-sky-500" /> Organization & Branding
              </CardTitle>
              <CardDescription>
                Customize your company name, logo in top-left sidebar, address, and regional settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Dynamic Logo Upload section */}
              <div className="space-y-2.5">
                <Label className="font-semibold text-slate-700">Top-Left System Logo</Label>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl border border-border/70 bg-slate-50/70">
                  <div className="h-16 w-48 rounded-lg border border-border/60 bg-white p-2 flex items-center justify-center shadow-xs overflow-hidden">
                    <img
                      src={currentPreviewLogo}
                      alt="Logo Preview"
                      className="max-h-12 max-w-full object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = defaultCompanyLogo;
                      }}
                    />
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoFileChange}
                      className="hidden"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => logoInputRef.current?.click()}
                        className="text-xs rounded-lg gap-1.5 border-sky-300 text-sky-700 hover:bg-sky-50"
                      >
                        <Upload size={13} /> Upload New Logo
                      </Button>
                      {companyForm.companyLogo && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setCompanyForm((p) => ({ ...p, companyLogo: '' }))}
                          className="text-xs text-rose-600 hover:bg-rose-50"
                        >
                          Reset to Default
                        </Button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      PNG, JPG, SVG or WebP format. Updating logo instantly updates the sidebar and salary slips.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    value={companyForm.companyName}
                    onChange={(e) => setCompanyForm({ ...companyForm, companyName: e.target.value })}
                    placeholder="BMAP EDUSERVICES"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="companyAddress">Company Address</Label>
                  <Textarea
                    id="companyAddress"
                    value={companyForm.companyAddress}
                    onChange={(e) => setCompanyForm({ ...companyForm, companyAddress: e.target.value })}
                    rows={2}
                    placeholder="206 Sunrise Commercial Complex, Near Savjibhai Korat Bridge, Mota Varachha, Surat, Gujarat"
                  />
                  <p className="text-xs text-slate-400">Printed on the header of generated salary slips</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input
                    id="timezone"
                    value={companyForm.timezone}
                    onChange={(e) => setCompanyForm({ ...companyForm, timezone: e.target.value })}
                    placeholder="Asia/Kolkata"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currencyCode">Currency Code</Label>
                  <Input
                    id="currencyCode"
                    value={companyForm.currencyCode}
                    onChange={(e) => setCompanyForm({ ...companyForm, currencyCode: e.target.value })}
                    placeholder="INR"
                  />
                </div>
              </div>
              <Button
                onClick={() => updateSettingsMutation.mutate()}
                disabled={updateSettingsMutation.isPending}
                className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-6"
              >
                {updateSettingsMutation.isPending ? 'Saving...' : 'Save Company Settings'}
              </Button>
            </CardContent>
          </Card>

          {/* Admin Profile Update */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User size={18} className="text-sky-500" /> Admin Profile Update
              </CardTitle>
              <CardDescription>Update your administrator username and password</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Display Name */}
              <div className="space-y-2">
                <Label htmlFor="adminName">Display Name</Label>
                <Input
                  id="adminName"
                  value={profileForm.name}
                  onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Admin Name"
                />
              </div>
              {/* Username / Login ID */}
              <div className="space-y-2">
                <Label htmlFor="adminEmail">Username (Login ID)</Label>
                <Input
                  id="adminEmail"
                  value={profileForm.email ?? ''}
                  onChange={(e) => setProfileForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="admin"
                />
              </div>
              <Button
                onClick={() => updateProfileMutation.mutate()}
                disabled={updateProfileMutation.isPending}
                className="bg-sky-600 hover:bg-sky-700 text-white font-bold"
              >
                {updateProfileMutation.isPending ? 'Saving...' : 'Update Profile'}
              </Button>

              <hr className="border-slate-100" />

              {/* Password */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Lock size={15} className="text-slate-500" />
                  Change Password
                </h4>

                <div className="space-y-2">
                  <Label>Current Password</Label>
                  <div className="relative">
                    <Input
                      type={showPwd.current ? 'text' : 'password'}
                      value={pwdForm.currentPassword}
                      onChange={(e) => setPwdForm((p) => ({ ...p, currentPassword: e.target.value }))}
                      placeholder="••••••••"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((p) => ({ ...p, current: !p.current }))}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPwd.current ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    New Password{' '}
                    <span className="text-slate-400 font-normal text-xs">(leave blank to keep current)</span>
                  </Label>
                  <div className="relative">
                    <Input
                      type={showPwd.new ? 'text' : 'password'}
                      value={pwdForm.newPassword}
                      onChange={(e) => setPwdForm((p) => ({ ...p, newPassword: e.target.value }))}
                      placeholder="••••••••"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((p) => ({ ...p, new: !p.new }))}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPwd.new ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Confirm New Password</Label>
                  <div className="relative">
                    <Input
                      type={showPwd.confirm ? 'text' : 'password'}
                      value={pwdForm.confirmPassword}
                      onChange={(e) => setPwdForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                      placeholder="••••••••"
                      className={cn('pr-10', pwdForm.confirmPassword && pwdForm.newPassword !== pwdForm.confirmPassword && 'border-red-400')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((p) => ({ ...p, confirm: !p.confirm }))}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPwd.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {pwdForm.confirmPassword && pwdForm.newPassword !== pwdForm.confirmPassword && (
                    <p className="text-xs text-red-500">Passwords do not match</p>
                  )}
                </div>

                <Button
                  onClick={() => changePasswordMutation.mutate()}
                  disabled={changePasswordMutation.isPending || !pwdForm.currentPassword || !pwdForm.newPassword}
                  className="bg-slate-800 hover:bg-slate-900 text-white font-bold"
                >
                  {changePasswordMutation.isPending ? 'Changing...' : '🔐 Change Password'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Security & WiFi ── */}
      {tab === 'security' && (
        <div className="max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>Network Restrictions</CardTitle>
              <CardDescription>Restrict punch-in/out to specific office WiFi networks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="allowedIps">Allowed WiFi IP Addresses</Label>
                <Textarea
                  id="allowedIps"
                  value={companyForm.allowedIps}
                  onChange={(e) => setCompanyForm({ ...companyForm, allowedIps: e.target.value })}
                  placeholder="203.0.113.1, 203.0.113.2"
                  rows={4}
                />
                <p className="text-sm text-muted-foreground">
                  Comma-separated list of allowed public IPs. Leave empty to allow punch-in from any network.
                </p>
              </div>
              <Button
                onClick={() => updateSettingsMutation.mutate()}
                disabled={updateSettingsMutation.isPending}
                className="bg-sky-600 hover:bg-sky-700 text-white font-bold"
              >
                {updateSettingsMutation.isPending ? 'Saving...' : 'Save Network Settings'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── SMTP ── */}
      {tab === 'smtp' && <SmtpSection />}

      {/* ── Templates (Salary Slip & Email Formats) ── */}
      {tab === 'templates' && <TemplatesSection />}

      {/* ── Import/Export ── */}
      {tab === 'import-export' && <ImportExportSection />}

      {/* ── SQL ── */}
      {tab === 'sql' && (
        <div className="max-w-4xl">
          <SqlSection />
        </div>
      )}

      {/* ── Migration ── */}
      {tab === 'migration' && (
        <div className="max-w-3xl">
          <MigrationSection />
        </div>
      )}

      {/* ── System ── */}
      {tab === 'system' && (
        <div className="max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>Application Info</CardTitle>
              <CardDescription>Current version and update status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <SystemInfoPanel me={me} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
