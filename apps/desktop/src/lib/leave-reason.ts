/** Converts "HH:MM" or "HH:MM:SS" (seconds ignored) to "H:MM AM/PM". */
function to12h(hms: string): string {
  const [hStr, mStr] = hms.split(':');
  const h = parseInt(hStr ?? '0', 10);
  const m = (mStr ?? '00').padStart(2, '0');
  if (isNaN(h)) return hms;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

/**
 * Splits a leave request's `reason` back into the actual typed-in reason and a separate
 * timing label. Partial-day legacy imports store the time range baked into `reason` itself
 * as "Partial-day leave (HH:MM–HH:MM): <reason>" — this pulls it back apart so the Reason
 * column can show just the reason, with timing shown in its own column instead.
 */
export function parseLeaveReason(reason?: string | null): { reason: string; timing: string } {
  if (!reason) return { reason: '', timing: 'Full Day' };
  const match = reason.match(/^Partial-day leave \(([\d:]+)\s*[–-]\s*([\d:]+)\):\s*(.*)$/s);
  if (!match) return { reason, timing: 'Full Day' };
  const [, from, to, rest] = match;
  return {
    reason: (rest ?? '').trim(),
    timing: `${to12h(from!)} – ${to12h(to!)}`,
  };
}
