import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leaveApi } from '@/lib/api';
import { Dialog, DialogHeader, DialogTitle, DialogFooter, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { CalendarDays, Plus, Info, XCircle, Clock } from 'lucide-react';
import type { LeaveRequest } from '@attendance/shared';

type LeaveMode = 'day' | 'break';

interface LeaveForm {
  mode: LeaveMode;
  startDate: string;
  endDate: string;
  fromTime: string;
  toTime: string;
  reason: string;
}

const EMPTY_FORM: LeaveForm = {
  mode: 'day',
  startDate: '',
  endDate: '',
  fromTime: '',
  toTime: '',
  reason: '',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function MyLeavesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<LeaveForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leave', 'types'], queryFn: leaveApi.types });
  const { data: requests = [], isLoading } = useQuery({ queryKey: ['leave', 'me'], queryFn: leaveApi.mine });

  const sortedRequests = useMemo(() => {
    if (!requests) return [];
    return [...requests].sort((a, b) => {
      if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
      if (a.status !== 'PENDING' && b.status === 'PENDING') return 1;
      const dateA = new Date(a.startDate || a.createdAt).getTime();
      const dateB = new Date(b.startDate || b.createdAt).getTime();
      return dateB - dateA;
    });
  }, [requests]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['leave'] });
  };

  const buildPayload = () => {
    // Pick first available leave type (or the one most suitable)
    const defaultType = leaveTypes[0];
    if (!defaultType) return null;

    if (form.mode === 'day') {
      return {
        leaveTypeId: defaultType.id,
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        reason: form.reason,
      };
    } else {
      // Break / short leave — use today's date if no date provided
      const today = new Date().toISOString().slice(0, 10);
      const d = form.startDate || today;
      const reasonWithTime = form.fromTime
        ? `${form.reason} (${form.fromTime}${form.toTime ? ' – ' + form.toTime : ''})`
        : form.reason;
      return {
        leaveTypeId: defaultType.id,
        startDate: d,
        endDate: d,
        reason: reasonWithTime,
        dayPart: 'FULL_DAY',
      };
    }
  };

  const createMutation = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      if (!payload) throw new Error('No leave type available');
      return leaveApi.create(payload);
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setError(null);
    },
    onError: (err: any) => {
      const msg = err?.message ?? '';
      if (msg.includes('balance')) {
        setError('Insufficient leave balance for the selected dates.');
      } else if (msg.includes('overlap') || msg.includes('overlapping')) {
        setError('You already have a leave request for overlapping dates.');
      } else if (msg.includes('working')) {
        setError('The selected date range contains no working days.');
      } else {
        setError('Unable to submit request. Please check dates and try again.');
      }
    },
  });

  const cancelMutation = useMutation({ mutationFn: leaveApi.cancel, onSuccess: invalidate });

  const canSubmit = useMemo(() => {
    if (!form.reason.trim()) return false;
    if (form.mode === 'day') return !!form.startDate;
    // break mode: must have at least a time or date
    return !!(form.fromTime || form.startDate);
  }, [form]);

  const columns: DataTableColumn<LeaveRequest>[] = [
    {
      key: 'leaveType',
      header: 'Type',
      render: (r) => <span className="font-medium">{r.leaveType?.name ?? 'Leave'}</span>,
    },
    {
      key: 'startDate',
      header: 'Duration',
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-sm">
            {formatDate(r.startDate as unknown as string)}
            {r.endDate !== r.startDate ? ` → ${formatDate(r.endDate as unknown as string)}` : ''}
          </span>
          <span className="text-xs text-muted-foreground">
            {Number(r.totalDays) === 0.5 ? 'Half Day' : `${r.totalDays} Day${Number(r.totalDays) !== 1 ? 's' : ''}`}
          </span>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => (
        <span className="text-muted-foreground text-sm truncate max-w-[200px] inline-block">{r.reason}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.status === 'PENDING' ? (
          <button
            type="button"
            className="clay-button-subtle h-7 px-2.5 rounded-xl text-xs font-semibold text-rose-600 hover:text-rose-700 hover:border-rose-300 flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
            onClick={() => {
              if (confirm('Are you sure you want to cancel this leave request?')) {
                cancelMutation.mutate(r.id);
              }
            }}
          >
            <XCircle size={13} className="text-rose-500" />
            <span>Cancel</span>
          </button>
        ) : null,
    },
  ];

  return (
    <div className="relative space-y-6 max-w-7xl mx-auto pb-10">
      {/* Ambient background glow accents for rich claymorphism depth */}
      <div className="absolute -top-12 -right-12 -z-10 w-96 h-96 bg-emerald-100/35 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-48 -left-12 -z-10 w-96 h-96 bg-sky-100/35 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200/70">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">Leave Requests</h2>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">Apply for planned time off or report short breaks.</p>
        </div>
        <button
          type="button"
          onClick={() => { setForm(EMPTY_FORM); setError(null); setDialogOpen(true); }}
          className="clay-btn-green h-10 px-4 rounded-2xl flex items-center gap-2 text-xs sm:text-sm font-bold text-white cursor-pointer active:scale-95 transition-transform"
        >
          <Plus size={16} />
          <span>New Request</span>
        </button>
      </div>

      {/* Leave History Table */}
      <div className="clay-card p-6 sm:p-7 relative overflow-hidden transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-200/60">
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <CalendarDays size={18} className="text-emerald-600" />
              <span>Leave History</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Track your submitted requests and their approval statuses</p>
          </div>
        </div>
        <div className="pt-3">
          <DataTable columns={columns} rows={sortedRequests} getRowKey={(r) => r.id} isLoading={isLoading} />
        </div>
      </div>

      {/* Request Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-3xl bg-white/95 backdrop-blur-xl border border-white/60 shadow-[0_20px_50px_rgba(0,0,0,0.18)] p-6">
          <DialogHeader className="pb-3 border-b border-slate-100">
            <DialogTitle className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
              <CalendarDays size={18} className="text-emerald-600" />
              <span>Request Time Off</span>
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => { e.preventDefault(); if (canSubmit && !createMutation.isPending) createMutation.mutate(); }}
          >
          <div className="space-y-4 py-2">
            {error && (
              <div className="clay-pod bg-rose-50/50 border-2 border-rose-500/30 text-rose-700 text-xs p-3 rounded-2xl flex items-start gap-2">
                <Info size={15} className="mt-0.5 shrink-0 text-rose-500" />
                <p className="font-medium">{error}</p>
              </div>
            )}

            {/* Leave mode radio */}
            <div className="grid grid-cols-2 gap-2.5">
              {(['day', 'break'] as LeaveMode[]).map((mode) => {
                const isSelected = form.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, mode }))}
                    className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? 'clay-pod border-2 border-emerald-500 text-emerald-800 shadow-[inset_0_2px_4px_rgba(255,255,255,0.9),0_4px_12px_rgba(16,185,129,0.15)]'
                        : 'clay-button-subtle text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {mode === 'day' ? (
                      <CalendarDays size={15} className={isSelected ? 'text-emerald-600' : 'text-slate-400'} />
                    ) : (
                      <Clock size={15} className={isSelected ? 'text-emerald-600' : 'text-slate-400'} />
                    )}
                    <span>{mode === 'day' ? 'Full Day Leave' : 'Short Break'}</span>
                  </button>
                );
              })}
            </div>

            {/* Date fields */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fromDate" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  From Date {form.mode === 'break' && <span className="font-normal normal-case tracking-normal">(optional)</span>}
                </Label>
                <Input
                  id="fromDate"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="toDate" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  To Date {form.mode === 'break' && <span className="font-normal normal-case tracking-normal">(optional)</span>}
                </Label>
                <Input
                  id="toDate"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  min={form.startDate}
                  className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-medium"
                />
              </div>
            </div>

            {/* Time fields — only shown for break mode */}
            {form.mode === 'break' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fromTime" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    From Time <span className="font-normal normal-case tracking-normal">(optional)</span>
                  </Label>
                  <Input
                    id="fromTime"
                    type="time"
                    value={form.fromTime}
                    onChange={(e) => setForm((f) => ({ ...f, fromTime: e.target.value }))}
                    className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-medium"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="toTime" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    To Time <span className="font-normal normal-case tracking-normal">(optional)</span>
                  </Label>
                  <Input
                    id="toTime"
                    type="time"
                    value={form.toTime}
                    onChange={(e) => setForm((f) => ({ ...f, toTime: e.target.value }))}
                    className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-medium"
                  />
                </div>
              </div>
            )}

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Reason
              </Label>
              <Textarea
                id="reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder={form.mode === 'day' ? 'e.g. Vacation, Sick Leave...' : 'e.g. Doctor appointment, Personal errand...'}
                rows={3}
                className="resize-none text-xs rounded-xl border border-slate-200 bg-white font-medium"
              />
            </div>
          </div>
          </form>

          <DialogFooter className="gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="clay-button-subtle h-9 px-4 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !canSubmit}
              className="clay-btn-green h-9 px-5 rounded-xl text-xs font-bold text-white cursor-pointer active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all"
            >
              {createMutation.isPending ? 'Submitting...' : 'Submit Request'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
