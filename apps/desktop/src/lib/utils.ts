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
