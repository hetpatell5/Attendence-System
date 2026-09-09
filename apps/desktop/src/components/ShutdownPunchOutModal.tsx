import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, LogOut, AlertTriangle } from 'lucide-react';
import { attendanceApi } from '@/lib/api';

interface ShutdownPunchOutModalProps {
  onDone: () => void;
}

/**
 * Full-screen blocking overlay shown when the OS tries to shut down / log off
 * while the employee is still clocked in. The employee must punch out before
 * the shutdown can proceed.
 */
export function ShutdownPunchOutModal({ onDone }: ShutdownPunchOutModalProps): JSX.Element {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const punchOutMutation = useMutation({
    mutationFn: attendanceApi.punchOut,
    onSuccess: () => {
      // Update punch status file in main process so the helper unblocks future shutdowns
      try {
        const eApi = (window as any).electronApi;
        if (eApi?.shutdown?.updatePunchStatus) {
          void eApi.shutdown.updatePunchStatus(false);
        }
      } catch { /* ignore */ }

      // Invalidate cached attendance data
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'employee'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });

      onDone();
    },
    onError: (err: any) => {
      setErrorMsg(err?.message || 'Failed to punch out. Please try again.');
    },
  });

  return (
    /* Full-screen fixed overlay — sits above everything, cannot be dismissed */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        animation: 'shutdown-fade-in 0.25s ease',
      }}
    >
      <style>{`
        @keyframes shutdown-fade-in {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes shutdown-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
          50%       { box-shadow: 0 0 0 20px rgba(239, 68, 68, 0); }
        }
        .shutdown-pulse { animation: shutdown-pulse 2s ease-in-out infinite; }
      `}</style>

      <div
        style={{
          background: 'linear-gradient(135deg, #1a0505 0%, #2d0808 50%, #1a0505 100%)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: '20px',
          padding: '40px 48px',
          maxWidth: '480px',
          width: '90%',
          textAlign: 'center',
          boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(239,68,68,0.2) inset',
        }}
      >
        {/* Animated warning icon */}
        <div
          className="shutdown-pulse"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '2px solid rgba(239, 68, 68, 0.5)',
            marginBottom: 24,
          }}
        >
          <ShieldAlert size={40} color="#ef4444" strokeWidth={1.5} />
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            color: '#ef4444',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          ⚠ PC Shutdown Blocked
        </div>

        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: '#fff',
            margin: '0 0 16px',
            lineHeight: 1.3,
          }}
        >
          You're Still Clocked&nbsp;In
        </h2>

        <p
          style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.65)',
            lineHeight: 1.6,
            marginBottom: 28,
          }}
        >
          Windows cannot shut down while you are logged into the Attendance
          System. Please <strong style={{ color: 'rgba(255,255,255,0.9)' }}>
            punch out
          </strong> first, then you can shut down normally.
        </p>

        {/* Error message */}
        {errorMsg && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 10,
              marginBottom: 20,
              textAlign: 'left',
            }}
          >
            <AlertTriangle size={15} color="#ef4444" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#fca5a5' }}>{errorMsg}</span>
          </div>
        )}

        {/* Punch-out button */}
        <button
          onClick={() => {
            setErrorMsg(null);
            punchOutMutation.mutate();
          }}
          disabled={punchOutMutation.isPending}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            width: '100%',
            padding: '14px 24px',
            background: punchOutMutation.isPending
              ? 'rgba(239,68,68,0.4)'
              : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
            border: 'none',
            borderRadius: 12,
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            cursor: punchOutMutation.isPending ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: punchOutMutation.isPending
              ? 'none'
              : '0 4px 20px rgba(239,68,68,0.4)',
          }}
          onMouseEnter={(e) => {
            if (!punchOutMutation.isPending) {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 24px rgba(239,68,68,0.55)';
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow = punchOutMutation.isPending
              ? 'none'
              : '0 4px 20px rgba(239,68,68,0.4)';
          }}
        >
          <LogOut size={18} />
          {punchOutMutation.isPending ? 'Punching Out…' : 'Punch Out Now'}
        </button>

        <p
          style={{
            marginTop: 18,
            fontSize: 11,
            color: 'rgba(255,255,255,0.3)',
          }}
        >
          After punching out, try shutting down Windows again.
        </p>
      </div>
    </div>
  );
}
