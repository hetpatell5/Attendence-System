import mysql from "mysql2/promise";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseDuration(t) {
  if (!t) return 0;
  const parts = String(t).split(":").map(Number);
  return ((parts[0] ?? 0) * 60) + (parts[1] ?? 0) + Math.round((parts[2] ?? 0) / 60);
}

function safeTime(dateBase, timeStr) {
  if (!timeStr) return undefined;
  const s = String(timeStr);
  if (s === "00:00:00" || s === "") return undefined;
  const parts = s.split(":").map(Number);
  if (parts.some(isNaN)) return undefined;
  const dt = new Date(dateBase);
  dt.setUTCHours(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, 0);
  return isNaN(dt.getTime()) ? undefined : dt;
}

async function main() {
  const conn = await mysql.createConnection({ host: "127.0.0.1", user: "root", database: "attendance_dev", dateStrings: true });
  try {
    const [rows] = await conn.query("SELECT employee_id, date, punch_type, time, total_hours FROM attendance_log ORDER BY employee_id, date, time");
    console.log("Loaded " + rows.length + " rows from attendance_log");

    const grouped = new Map();
    for (const row of rows) {
      const key = row.employee_id + "__" + row.date;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }

    let updated = 0, created = 0, skipped = 0;
    for (const [key, dayRows] of grouped) {
      const parts = key.split("__");
      const legacyId = parseInt(parts[0]);
      const dateStr  = parts[1];
      const emp = await prisma.employee.findUnique({ where: { legacySourceId: legacyId }, select: { id: true } });
      if (!emp) { skipped++; continue; }

      const dp = dateStr.split("-").map(Number);
      const attendanceDate = new Date(Date.UTC(dp[0], dp[1] - 1, dp[2]));

      const ins  = dayRows.filter(r => r.punch_type === "in");
      const outs = dayRows.filter(r => r.punch_type === "out");
      const firstIn = safeTime(attendanceDate, ins[0]?.time);
      const lastOut = safeTime(attendanceDate, outs.length ? outs[outs.length - 1].time : null);

      if (!firstIn && !lastOut) { skipped++; continue; }

      const punchPairs = [];
      for (let i = 0; i < Math.max(ins.length, outs.length); i++) {
        const pin  = safeTime(attendanceDate, ins[i]?.time);
        const pout = safeTime(attendanceDate, outs[i]?.time);
        if (pin || pout) punchPairs.push({ punchInAt: pin ? pin.toISOString() : "", punchOutAt: pout ? pout.toISOString() : null });
      }

      const workedMinutes = outs.length ? parseDuration(outs[outs.length - 1].total_hours) : 0;
      const existing = await prisma.attendance.findUnique({
        where: { employeeId_attendanceDate: { employeeId: emp.id, attendanceDate } },
      });

      if (existing) {
        // Only overwrite LEGACY_IMPORT records (not manually entered data)
        if (existing.source === "LEGACY_IMPORT" || existing.source === null) {
          await prisma.attendance.update({
            where: { id: existing.id },
            data: {
              punchInAt: firstIn,
              punchOutAt: lastOut,
              workedMinutes: workedMinutes || 0,
              punchPairs: punchPairs.length > 1 ? punchPairs : [],
              source: "LEGACY_IMPORT",
            },
          });
          updated++;
        } else {
          // Manual/WiFi records - skip
          skipped++;
        }
      } else {
        await prisma.attendance.create({
          data: {
            employeeId: emp.id, attendanceDate, punchInAt: firstIn, punchOutAt: lastOut,
            status: "PRESENT", workedMinutes, source: "LEGACY_IMPORT",
            punchPairs: punchPairs.length > 1 ? punchPairs : [],
          },
        });
        created++;
      }
    }
    console.log("Done: " + created + " created, " + updated + " updated, " + skipped + " skipped");
  } finally {
    await conn.end();
    await prisma.$disconnect();
  }
}
main().catch(console.error);
