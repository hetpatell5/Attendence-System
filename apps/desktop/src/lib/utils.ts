import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Alphabetical sort key for an employee name: first name primary, last name as tiebreaker. */
export function employeeNameSortKey(emp: { firstName?: string | null; lastName?: string | null }): [string, string] {
  const primary = (emp.firstName || '').toLowerCase();
  const secondary = (emp.lastName || '').toLowerCase();
  return [primary, secondary];
}

export function compareEmployeesByName(
  a: { firstName?: string | null; lastName?: string | null },
  b: { firstName?: string | null; lastName?: string | null },
): number {
  const [aPrimary, aSecondary] = employeeNameSortKey(a);
  const [bPrimary, bSecondary] = employeeNameSortKey(b);
  const primaryCmp = aPrimary.localeCompare(bPrimary);
  if (primaryCmp !== 0) return primaryCmp;
  return aSecondary.localeCompare(bSecondary);
}

/**
 * Converts a "HH:MM" 24h time string to "H:MM AM/PM" 12h format.
 * e.g. "09:00" → "9:00 AM", "18:30" → "6:30 PM"
 * Returns the original string unchanged if it cannot be parsed.
 */
export function to12h(time: string | null | undefined): string {
  if (!time) return '';
  const parts = time.split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (isNaN(h) || isNaN(m)) return time;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}
