/**
 * compare-legacy-new.ts
 * 
 * Compares legacy MySQL attendance vs new DB attendance for Aug-Sep 2026.
 * Also checks for salary increments that should have been imported.
 * 
 * Run: cd apps/api && npx ts-node -P tsconfig.json scripts/compare-legacy-new.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import mysql from 'mysql2/promise';

const prisma = new PrismaClient();

async function main() {
  const LEGACY_URL = process.env.LEGACY_MYSQL_URL ?? 'mysql://root@localhost:3306/attensystem';
  
  let legacyPool: mysql.Pool | null = null;
  
  try {
    legacyPool = mysql.createPool({ uri: LEGACY_URL, dateStrings: true });
    
    // Test connection
    try {
      const conn = await legacyPool.getConnection();
      conn.release();
      console.log('✓ Connected to legacy MySQL (attensystem)');
    } catch (e: any) {
      console.error('✗ Cannot connect to legacy MySQL:', e.message);
      console.log('\nCannot connect to legacy DB — will only show new DB state.\n');
      legacyPool = null;
    }
    
    // ── New DB stats ──────────────────────────────────────────────────────────
    console.log('\n=== NEW DB: Attendance counts by month ===');
    const newAug = await prisma.attendance.count({
      where: { attendanceDate: { gte: new Date('2026-08-01'), lt: new Date('2026-09-01') } },
    });
    const newSep = await prisma.attendance.count({
      where: { attendanceDate: { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') } },
    });
    const newJul = await prisma.attendance.count({
      where: { attendanceDate: { gte: new Date('2026-07-01'), lt: new Date('2026-08-01') } },
    });
    console.log(`  Jul 2026: ${newJul} records`);
    console.log(`  Aug 2026: ${newAug} records`);
    console.log(`  Sep 2026: ${newSep} records`);
    
    // Per employee for Aug
    console.log('\n=== NEW DB: Aug 2026 attendance per employee ===');
    const augPerEmp = await prisma.attendance.groupBy({
      by: ['employeeId'],
      where: { attendanceDate: { gte: new Date('2026-08-01'), lt: new Date('2026-09-01') } },
      _count: { _all: true },
    });
    const empMap = new Map<string, any>();
    const allEmps = await prisma.employee.findMany({ select: { id: true, employeeCode: true, firstName: true, lastName: true, legacySourceId: true } });
    for (const e of allEmps) empMap.set(e.id, e);
    
    for (const r of augPerEmp.sort((a, b) => a._count._all - b._count._all)) {
      const e = empMap.get(r.employeeId);
      console.log(`  BMA-${e?.legacySourceId ?? '?'} ${e?.firstName} ${e?.lastName}: ${r._count._all} records`);
    }
    
    // Per employee for Sep
    console.log('\n=== NEW DB: Sep 2026 attendance per employee ===');
    const sepPerEmp = await prisma.attendance.groupBy({
      by: ['employeeId'],
      where: { attendanceDate: { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') } },
      _count: { _all: true },
    });
    for (const r of sepPerEmp.sort((a, b) => a._count._all - b._count._all)) {
      const e = empMap.get(r.employeeId);
      console.log(`  BMA-${e?.legacySourceId ?? '?'} ${e?.firstName} ${e?.lastName}: ${r._count._all} records`);
    }
    
    // Find employees who have NO attendance in Aug or Sep in new DB
    console.log('\n=== NEW DB: Employees MISSING Aug 2026 attendance ===');
    const empWithAug = new Set(augPerEmp.map(r => r.employeeId));
    const empWithSep = new Set(sepPerEmp.map(r => r.employeeId));
    for (const e of allEmps) {
      if (!empWithAug.has(e.id)) {
        // Check if active employee (not tombstone)
        const fullEmp = await prisma.employee.findUnique({ where: { id: e.id }, select: { status: true } });
        if (fullEmp?.status === 'ACTIVE') {
          console.log(`  BMA-${e.legacySourceId} ${e.firstName} ${e.lastName}: NO Aug records`);
        }
      }
    }

    console.log('\n=== NEW DB: Employees MISSING Sep 2026 attendance ===');
    for (const e of allEmps) {
      if (!empWithSep.has(e.id)) {
        const fullEmp = await prisma.employee.findUnique({ where: { id: e.id }, select: { status: true } });
        if (fullEmp?.status === 'ACTIVE') {
          console.log(`  BMA-${e.legacySourceId} ${e.firstName} ${e.lastName}: NO Sep records`);
        }
      }
    }

    if (!legacyPool) return;
    
    // ── Legacy DB stats ───────────────────────────────────────────────────────
    console.log('\n=== LEGACY DB: Attendance counts by month ===');
    const [legAugRows] = await legacyPool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as cnt FROM attendance WHERE date >= '2026-08-01' AND date < '2026-09-01'`
    );
    const [legSepRows] = await legacyPool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as cnt FROM attendance WHERE date >= '2026-09-01' AND date < '2026-10-01'`
    );
    const [legJulRows] = await legacyPool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as cnt FROM attendance WHERE date >= '2026-07-01' AND date < '2026-08-01'`
    );
    console.log(`  Jul 2026: ${legJulRows[0]?.cnt ?? 0} records`);
    console.log(`  Aug 2026: ${legAugRows[0]?.cnt ?? 0} records`);
    console.log(`  Sep 2026: ${legSepRows[0]?.cnt ?? 0} records`);
    
    // Per employee Aug in legacy
    console.log('\n=== LEGACY DB: Aug 2026 attendance per employee ===');
    const [legAugPerEmp] = await legacyPool.query<mysql.RowDataPacket[]>(
      `SELECT employee_id, COUNT(*) as cnt FROM attendance 
       WHERE date >= '2026-08-01' AND date < '2026-09-01' 
       GROUP BY employee_id ORDER BY cnt`
    );
    for (const r of legAugPerEmp) {
      console.log(`  Legacy employee ${r.employee_id}: ${r.cnt} records`);
    }
    
    // Per employee Sep in legacy
    console.log('\n=== LEGACY DB: Sep 2026 attendance per employee ===');
    const [legSepPerEmp] = await legacyPool.query<mysql.RowDataPacket[]>(
      `SELECT employee_id, COUNT(*) as cnt FROM attendance 
       WHERE date >= '2026-09-01' AND date < '2026-10-01' 
       GROUP BY employee_id ORDER BY cnt`
    );
    for (const r of legSepPerEmp) {
      console.log(`  Legacy employee ${r.employee_id}: ${r.cnt} records`);
    }
    
    // Check salary increments that may be missing
    console.log('\n=== LEGACY DB: Salary history entries for Aug-Sep 2026 ===');
    const [legSalHist] = await legacyPool.query<mysql.RowDataPacket[]>(
      `SELECT sh.*, e.full_name FROM salary_history sh 
       JOIN employees e ON e.id = sh.employee_id
       WHERE sh.effective_from >= '2026-07-01'
       ORDER BY sh.effective_from`
    );
    for (const r of legSalHist) {
      console.log(`  ${r.full_name} (id=${r.employee_id}): amount=${r.amount}, effective_from=${r.effective_from}`);
    }
    
    // Check salary_increment_log for recent entries
    console.log('\n=== LEGACY DB: Salary increment log for 2026 ===');
    const [legIncLog] = await legacyPool.query<mysql.RowDataPacket[]>(
      `SELECT sil.*, e.full_name FROM salary_increment_log sil 
       JOIN employees e ON e.id = sil.employee_id
       WHERE sil.applied_date >= '2026-07-01'
       ORDER BY sil.applied_date`
    );
    for (const r of legIncLog) {
      console.log(`  ${r.full_name} (id=${r.employee_id}): old=${r.old_salary} -> new=${r.new_salary}, applied=${r.applied_date}`);
    }
    
    // Check what the new DB has in salary history for the same period
    console.log('\n=== NEW DB: Salary history >= 2026-07-01 ===');
    const newSalHistRecent = await prisma.salaryHistory.findMany({
      where: { effectiveFrom: { gte: new Date('2026-07-01') } },
      orderBy: { effectiveFrom: 'asc' },
      include: { employee: { select: { legacySourceId: true, firstName: true } } },
    });
    for (const s of newSalHistRecent) {
      console.log(`  BMA-${s.employee.legacySourceId} ${s.employee.firstName}: amount=${s.amount}, effectiveFrom=${s.effectiveFrom.toISOString().slice(0, 10)}`);
    }
    
    // Check for AuditLog entries about increment_log imports
    console.log('\n=== NEW DB: AuditLog increment imports ===');
    const incAudit = await prisma.auditLog.findMany({
      where: {
        eventType: 'LEGACY_DATA_IMPORTED',
        metadata: { string_contains: 'salary_increment_log' },
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const a of incAudit) {
      const nv = a.newValue as any;
      console.log(`  employee=${a.entityId?.slice(-8)}, appliedDate=${nv?.appliedDate?.slice(0, 10)}, old=${nv?.oldSalary}, new=${nv?.newSalary}`);
    }

  } finally {
    if (legacyPool) await legacyPool.end();
    await prisma.$disconnect();
  }
}

main().catch(console.error);
