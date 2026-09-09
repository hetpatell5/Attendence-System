import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { leaveApi, attendanceRequestsApi, type AttendanceRequestItem } from '@/lib/api';
import { Card } from '@/components/ui/card';
import {
  FileText,
  CalendarDays,
  ArrowUpRight,
  Pencil,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

type FilterType = 'ALL' | 'PENDING' | 'LEAVE' | 'PUNCH_EDIT';

interface UnifiedRequestItem {
  id: string;
  category: 'LEAVE' | 'PUNCH_EDIT';
  title: string;
  subtitle: string;
  dateLabel: string;
  reason?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  reviewRemarks?: string | null;
}

function fmt12h(timeStr?: string | null): string {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr || '0', 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

function formatDate(isoStr?: string | null): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr.slice(0, 10);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatShortDate(isoStr?: string | null): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr.slice(0, 10);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

export function RequestsStatusCard(): JSX.Element {
  const [filter, setFilter] = useState<FilterType>('ALL');

  // Query Leave Requests
  const { data: leaveRequests = [], isLoading: isLoadingLeaves } = useQuery({
    queryKey: ['leave', 'me'],
    queryFn: leaveApi.mine,
  });

  // Query Punch Edit Requests
  const { data: punchRequests = [], isLoading: isLoadingPunches } = useQuery<AttendanceRequestItem[]>({
    queryKey: ['attendance', 'requests', 'mine'],
    queryFn: () => attendanceRequestsApi.mine(),
  });

  // Unify and sort (PENDING FIRST, then by newest createdAt)
  const unifiedRequests = useMemo(() => {
    const list: UnifiedRequestItem[] = [];

    // 1. Map Leave Requests
    leaveRequests.forEach((req: any) => {
      const isSingleDay = !req.endDate || req.startDate === req.endDate;
      const dateLabel = isSingleDay
        ? formatDate(req.startDate)
        : `${formatShortDate(req.startDate)} – ${formatDate(req.endDate)}`;

      const daysCount = Number(req.totalDays) || 1;
      const subtitle = `${daysCount} day${daysCount > 1 ? 's' : ''}${
        req.dayPart && req.dayPart !== 'FULL_DAY' ? ` · ${req.dayPart.replace('_', ' ')}` : ''
      }`;

      list.push({
        id: `leave-${req.id}`,
        category: 'LEAVE',
        title: req.leaveType?.name || 'Leave Request',
        subtitle,
        dateLabel,
        reason: req.reason,
        status: req.status,
        createdAt: req.createdAt,
        reviewRemarks: req.reviewRemarks,
      });
    });

    // 2. Map Punch Edit Requests
    punchRequests.forEach((req) => {
      let punchTimes = '';
      if (Array.isArray(req.punchPairs) && req.punchPairs.length > 0) {
        punchTimes = `${req.punchPairs.length} punch pair${req.punchPairs.length > 1 ? 's' : ''}`;
      } else if (req.punchInAt || req.punchOutAt) {
        const inStr = req.punchInAt ? fmt12h(extractTime(req.punchInAt)) : '--';
        const outStr = req.punchOutAt ? fmt12h(extractTime(req.punchOutAt)) : '--';
        punchTimes = `In: ${inStr} · Out: ${outStr}`;
      } else {
        punchTimes = 'Correction requested';
      }

      list.push({
        id: `punch-${req.id}`,
        category: 'PUNCH_EDIT',
        title: 'Punch Correction',
        subtitle: punchTimes,
        dateLabel: formatDate(req.attendanceDate),
        reason: req.reason,
        status: req.status,
        createdAt: req.createdAt,
        reviewRemarks: req.reviewRemarks,
      });
    });

    // Sort: PENDING requests on top, then newest by createdAt
    list.sort((a, b) => {
      if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
      if (b.status === 'PENDING' && a.status !== 'PENDING') return 1;
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    return list;
  }, [leaveRequests, punchRequests]);

  function extractTime(isoStr?: string | null): string {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // Filtered view
  const filteredList = useMemo(() => {
    if (filter === 'PENDING') return unifiedRequests.filter((r) => r.status === 'PENDING');
    if (filter === 'LEAVE') return unifiedRequests.filter((r) => r.category === 'LEAVE');
    if (filter === 'PUNCH_EDIT') return unifiedRequests.filter((r) => r.category === 'PUNCH_EDIT');
    return unifiedRequests;
  }, [unifiedRequests, filter]);

  const pendingCount = useMemo(() => {
    return unifiedRequests.filter((r) => r.status === 'PENDING').length;
  }, [unifiedRequests]);

  const isLoading = isLoadingLeaves || isLoadingPunches;

  return (
    <Card className="rounded-2xl border border-border/70 shadow-sm bg-card p-5 flex flex-col justify-between h-full min-h-[420px]">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950/60 border border-teal-200/50 dark:border-teal-800/40 flex items-center justify-center text-teal-600 dark:text-teal-400">
              <FileText size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base sm:text-lg text-foreground tracking-tight">
                  Requests Status
                </h3>
                {pendingCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-[11px] font-semibold animate-pulse">
                    {pendingCount} Pending
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Leaves & Punch Edit requests
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Link
              to="/me/leaves"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors bg-primary/5 hover:bg-primary/10 px-2.5 py-1.5 rounded-lg"
              title="Apply for Leave"
            >
              <span>Apply</span>
              <ArrowUpRight size={13} />
            </Link>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 pb-3 mb-2 border-b border-border/40 overflow-x-auto text-xs">
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all shrink-0 ${
              filter === 'ALL'
                ? 'bg-foreground text-background font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            All ({unifiedRequests.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('PENDING')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all shrink-0 ${
              filter === 'PENDING'
                ? 'bg-amber-500 text-white font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('LEAVE')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all shrink-0 ${
              filter === 'LEAVE'
                ? 'bg-foreground text-background font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            Leaves ({leaveRequests.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('PUNCH_EDIT')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all shrink-0 ${
              filter === 'PUNCH_EDIT'
                ? 'bg-foreground text-background font-semibold shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            Punch Edits ({punchRequests.length})
          </button>
        </div>

        {/* List of Requests */}
        {isLoading ? (
          <div className="py-12 text-center text-xs text-muted-foreground animate-pulse">
            Loading requests...
          </div>
        ) : filteredList.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            <p className="font-medium text-foreground/80">No requests found</p>
            <p className="mt-1 text-[11px]">
              {filter === 'PENDING'
                ? 'You have no pending requests at this time.'
                : 'Submit a leave application or punch correction when needed.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[290px] overflow-y-auto pr-1">
            {filteredList.map((item) => {
              const isPending = item.status === 'PENDING';
              const isApproved = item.status === 'APPROVED';
              const isRejected = item.status === 'REJECTED';

              // User rule: "show status approved in green and rejected in red, pending on top"
              let statusBadgeClass = 'bg-muted text-muted-foreground border-border/50';
              let statusLabel: string = item.status;
              let StatusIcon = AlertCircle;

              if (isPending) {
                statusBadgeClass = 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30';
                statusLabel = 'Pending';
                StatusIcon = AlertCircle;
              } else if (isApproved) {
                statusBadgeClass = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
                statusLabel = 'Approved';
                StatusIcon = CheckCircle2;
              } else if (isRejected) {
                statusBadgeClass = 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30';
                statusLabel = 'Rejected';
                StatusIcon = XCircle;
              }

              return (
                <div
                  key={item.id}
                  className={`p-3 rounded-xl border transition-all ${
                    isPending
                      ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-300/40 dark:border-amber-800/30 shadow-xs'
                      : 'bg-muted/30 border-border/40 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {/* Left Icon & Details */}
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          item.category === 'LEAVE'
                            ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/40'
                            : 'bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 border border-purple-200/50 dark:border-purple-800/40'
                        }`}
                      >
                        {item.category === 'LEAVE' ? (
                          <CalendarDays size={14} />
                        ) : (
                          <Pencil size={13} />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-xs text-foreground truncate">
                            {item.title}
                          </span>
                          <span className="text-[10px] text-muted-foreground">·</span>
                          <span className="text-[11px] font-medium text-foreground/80">
                            {item.dateLabel}
                          </span>
                        </div>

                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {item.subtitle}
                        </p>

                        {item.reason && (
                          <p className="text-[11px] text-muted-foreground/90 italic mt-1 line-clamp-1">
                            "{item.reason}"
                          </p>
                        )}

                        {item.reviewRemarks && (
                          <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium mt-1">
                            Remarks: {item.reviewRemarks}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right Status Badge */}
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadgeClass}`}
                      >
                        <StatusIcon size={12} className="shrink-0" />
                        <span>{statusLabel}</span>
                      </span>

                      <span className="text-[9px] text-muted-foreground">
                        {formatShortDate(item.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Footer Actions */}
      <div className="pt-3 mt-2 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
        <span className="text-[11px]">
          Total: {unifiedRequests.length} requests
        </span>
        <div className="flex items-center gap-3">
          <Link
            to="/me/attendance"
            className="text-[11px] font-medium text-primary hover:underline"
          >
            Punch History
          </Link>
          <span>·</span>
          <Link
            to="/me/leaves"
            className="text-[11px] font-medium text-primary hover:underline"
          >
            Leave History
          </Link>
        </div>
      </div>
    </Card>
  );
}
