import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import type { MigrationContext, PhaseResult } from '../phase-types';
import { emptyResult } from '../phase-types';
import { splitName, dateOnlyToUtcMidnight } from '../transforms';

export interface IssuedCredential {
  employeeCode: string;
  name: string;
  email: string;
  tempPassword: string;
}

const TEMP_PASSWORD_ALPHABET =
  'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateTempPassword(length = 12): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[bytes[i]! % TEMP_PASSWORD_ALPHABET.length];
  }
  return out;
}

async function resolveJoiningDate(
  ctx: MigrationContext,
  legacyId: number,
  joiningDateRaw: string | null,
  createdAtRaw: string,
): Promise<{ date: Date; source: string }> {
  if (joiningDateRaw) {
    return { date: dateOnlyToUtcMidnight(joiningDateRaw), source: 'joining_date' };
  }
  const earliestAttendance = await ctx.source.earliestAttendanceDate(legacyId);
  if (earliestAttendance) {
    return { date: dateOnlyToUtcMidnight(earliestAttendance), source: 'MIN(attendance.date)' };
  }
  // createdAtRaw is a 'YYYY-MM-DD HH:MM:SS' string (dateStrings: true on the pool); take the date part only.
  const datePart = createdAtRaw.slice(0, 10);
  return { date: dateOnlyToUtcMidnight(datePart), source: 'created_at' };
}

export async function runEmployees(
  ctx: MigrationContext,
  issuedCredentials: IssuedCredential[],
): Promise<PhaseResult> {
  const result = emptyResult('employees');
  const rows = await ctx.source.employees();
  const realIds = new Set(rows.map((r) => r.id));

  for (const row of rows) {
    const { firstName, lastName } = splitName(row.full_name);
    const { date: joiningDate, source: joiningSource } = await resolveJoiningDate(
      ctx,
      row.id,
      row.joining_date,
      row.created_at,
    );
    if (joiningSource !== 'joining_date') {
      result.warnings.push(
        `Employee ${row.id} (${row.full_name}): joiningDate had no source value, used ${joiningSource}.`,
      );
    }

    const email = row.email && row.email.trim() ? row.email.trim() : `legacy-${row.id}@invalid.local`;
    const shiftId = row.shift_id ? ctx.idMap.shifts.get(row.shift_id) : undefined;

    if (!ctx.commit) {
      ctx.idMap.employees.set(row.id, `dry-run-employee-${row.id}`);
      result.created += 1;
      continue;
    }

    const existingByLegacyId = await ctx.prisma.employee.findUnique({
      where: { legacySourceId: row.id },
    });

    let userId: string | undefined = existingByLegacyId?.userId ?? undefined;
    if (!userId) {
      const tempPassword = generateTempPassword();
      const passwordHash = await argon2.hash(tempPassword, { type: argon2.argon2id });
      const user = await ctx.prisma.user.create({
        data: {
          username: email,
          email,
          passwordHash,
          name: row.full_name,
          role: 'EMPLOYEE',
          isActive: row.status === 'active',
        },
      });
      userId = user.id;
      issuedCredentials.push({
        employeeCode: `BMA-${row.id}`,
        name: row.full_name,
        email,
        tempPassword,
      });
    }

    const employee = await ctx.prisma.employee.upsert({
      where: { legacySourceId: row.id },
      update: {
        firstName,
        lastName,
        phone: row.mobile_number || undefined,
        addressLine1: row.address || undefined,
        baseSalary: row.monthly_salary,
        payType: 'HOURLY',
        status: row.status === 'active' ? 'ACTIVE' : 'INACTIVE',
        dateOfBirth: row.dob ? dateOnlyToUtcMidnight(row.dob) : undefined,
        targetSalary: row.target_salary ? parseFloat(row.target_salary) : undefined,
        monthlyIncrement: row.monthly_increment ? parseFloat(row.monthly_increment) : undefined,
        incrementInterval: row.increment_interval ?? 1,
        incrementEffectiveFrom: row.increment_effective_from
          ? dateOnlyToUtcMidnight(row.increment_effective_from)
          : undefined,
      },
      create: {
        employeeCode: `BMA-${row.id}`,
        userId,
        firstName,
        lastName,
        email,
        phone: row.mobile_number || undefined,
        dateOfBirth: row.dob ? dateOnlyToUtcMidnight(row.dob) : undefined,
        joiningDate,
        baseSalary: row.monthly_salary,
        payType: 'HOURLY',
        status: row.status === 'active' ? 'ACTIVE' : 'INACTIVE',
        addressLine1: row.address || undefined,
        legacySourceId: row.id,
        targetSalary: row.target_salary ? parseFloat(row.target_salary) : undefined,
        monthlyIncrement: row.monthly_increment ? parseFloat(row.monthly_increment) : undefined,
        incrementInterval: row.increment_interval ?? 1,
        incrementEffectiveFrom: row.increment_effective_from
          ? dateOnlyToUtcMidnight(row.increment_effective_from)
          : undefined,
      },
    });

    ctx.idMap.employees.set(row.id, employee.id);

    if (shiftId) {
      const hasAssignment = await ctx.prisma.employeeShift.findFirst({
        where: { employeeId: employee.id },
      });
      if (!hasAssignment) {
        await ctx.prisma.employeeShift.create({
          data: { employeeId: employee.id, shiftId, effectiveFrom: joiningDate },
        });
      }
    }

    if (!existingByLegacyId) {
      const currentYear = new Date().getUTCFullYear();
      const leaveTypes = await ctx.prisma.leaveType.findMany({ where: { isActive: true } });
      for (const leaveType of leaveTypes) {
        await ctx.prisma.leaveBalance.upsert({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: employee.id,
              leaveTypeId: leaveType.id,
              year: currentYear,
            },
          },
          update: {},
          create: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year: currentYear,
            entitledDays: leaveType.defaultAnnualDays,
          },
        });
      }
      result.created += 1;
    } else {
      result.updated += 1;
    }
  }

  if (ctx.orphanStrategy === 'tombstone') {
    const referencedIds = await ctx.source.allReferencedEmployeeIds();
    const orphanIds = [...new Set(referencedIds)].filter((id) => !realIds.has(id));

    for (const legacyId of orphanIds) {
      if (!ctx.commit) {
        ctx.idMap.employees.set(legacyId, `dry-run-tombstone-${legacyId}`);
        result.created += 1;
        continue;
      }

      const existing = await ctx.prisma.employee.findUnique({
        where: { legacySourceId: legacyId },
      });
      if (existing) {
        ctx.idMap.employees.set(legacyId, existing.id);
        continue;
      }

      const earliest = await ctx.source.earliestAttendanceDate(legacyId);
      const latest = await ctx.source.latestAttendanceDate(legacyId);
      const joiningDate = earliest ? dateOnlyToUtcMidnight(earliest) : new Date();
      const deactivatedAt = latest ? dateOnlyToUtcMidnight(latest) : new Date();

      const tombstone = await ctx.prisma.employee.create({
        data: {
          employeeCode: `LEGACY-${legacyId}`,
          firstName: 'Former',
          lastName: `Employee ${legacyId}`,
          email: `legacy-orphan-${legacyId}@invalid.local`,
          joiningDate,
          baseSalary: 0,
          payType: 'HOURLY',
          status: 'TERMINATED',
          deactivatedAt,
          legacySourceId: legacyId,
        },
      });
      ctx.idMap.employees.set(legacyId, tombstone.id);
      result.created += 1;
    }
  }

  return result;
}
