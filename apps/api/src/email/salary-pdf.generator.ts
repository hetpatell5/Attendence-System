import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';
import type { SalaryTemplateVariables } from './email.service';

/**
 * Resolves a static asset path that works both in dev (ts-node, __dirname = src/email)
 * and in the compiled dist build (dist/src/email).
 */
function resolveAssetPath(...segments: string[]): string {
  const candidates = [
    path.join(__dirname, '..', 'assets', ...segments),
    path.join(__dirname, '..', '..', 'assets', ...segments),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;
}

// NotoSans is used so the Rupee sign (₹, U+20B9) renders correctly.
const FONT_REGULAR_PATH = resolveAssetPath('fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD_PATH    = resolveAssetPath('fonts', 'NotoSans-Bold.ttf');
const FONT_REGULAR = 'NotoSans';
const FONT_BOLD    = 'NotoSans-Bold';

/**
 * Generates a salary slip PDF matching the OLD system format:
 *
 *  ┌────────────────────────────────────────────────────────────┐
 *  │                    [LOGO  centered]                        │
 *  │                   Company Name (bold)                      │
 *  │                   Company Address (gray)                   │
 *  │                      Salary Slip                           │
 *  ├───────────────────────────┬────────────────────────────────┤
 *  │ Pay Period:   Aug 2026    │ Pay Date:      15 Sep 2026     │
 *  │ Employee Name: Het Patel  │ Employee ID:   38              │
 *  │ Shift:  Full Day ...      │ Status:        Paid            │
 *  ├───────────────────────────┴────────────────────────────────┤
 *  │    Earnings (blue)        │   Attendance & Hours (orange)  │
 *  │ Monthly Salary    ₹ X    │ Total Days in Month        31  │
 *  │ ...                       │ ...                            │
 *  │ Net Salary                          ₹ X,XXX /-            │  <- full-width green row
 *  ├────────────────────────────────────────────────────────────┤
 *  │ Payment Status: Paid   Paid On: 15 Sep 2026, 11:02 AM     │
 *  │ Remarks:                                                   │
 *  └────────────────────────────────────────────────────────────┘
 */
export function generateSalarySlipPdf(vars: SalaryTemplateVariables): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title: `Salary Slip - ${vars.employee_name} (${vars.month_name})`,
        Author: vars.company_name,
      },
    });

    doc.registerFont(FONT_REGULAR, FONT_REGULAR_PATH);
    doc.registerFont(FONT_BOLD, FONT_BOLD_PATH);

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW   = 595.28;
    const marginX = 40;
    const contentW = pageW - marginX * 2;
    let y = 36;

    // ── Logo (centered) ───────────────────────────────────────────────────────
    let logoBuffer: Buffer | null = null;
    if (vars.company_logo && vars.company_logo.startsWith('data:image')) {
      try {
        const b64 = vars.company_logo.split(',')[1];
        if (b64) logoBuffer = Buffer.from(b64, 'base64');
      } catch { logoBuffer = null; }
    }
    if (!logoBuffer) {
      const p = resolveAssetPath('logo.jpeg');
      if (fs.existsSync(p)) {
        try { logoBuffer = fs.readFileSync(p); } catch { logoBuffer = null; }
      }
    }

    if (logoBuffer) {
      try {
        const logoMaxW = 180;
        const logoMaxH = 70;
        doc.image(logoBuffer, (pageW - logoMaxW) / 2, y, {
          fit: [logoMaxW, logoMaxH],
          align: 'center',
          valign: 'center',
        });
        y += logoMaxH + 8;
      } catch {
        y += 8;
      }
    } else {
      y += 8;
    }

    // ── Company Name (centered, bold, navy) ───────────────────────────────────
    doc.font(FONT_BOLD).fontSize(16).fillColor('#1a3a6b')
      .text(vars.company_name || 'Company', marginX, y, { width: contentW, align: 'center' });
    y += 22;

    // ── Company Address (centered, gray) ──────────────────────────────────────
    const address = vars.company_address || '';
    if (address) {
      doc.font(FONT_REGULAR).fontSize(8).fillColor('#555555')
        .text(address, marginX, y, { width: contentW, align: 'center', lineGap: 1 });
      y += doc.heightOfString(address, { width: contentW }) + 6;
    }

    // ── Thin divider ──────────────────────────────────────────────────────────
    doc.save();
    doc.moveTo(marginX, y).lineTo(pageW - marginX, y).lineWidth(0.8).strokeColor('#cbd5e1').stroke();
    doc.restore();
    y += 8;

    // ── "Salary Slip" heading (centered) ─────────────────────────────────────
    doc.font(FONT_BOLD).fontSize(13).fillColor('#1e293b')
      .text('Salary Slip', marginX, y, { width: contentW, align: 'center' });
    y += 20;

    // ── Thin divider ──────────────────────────────────────────────────────────
    doc.save();
    doc.moveTo(marginX, y).lineTo(pageW - marginX, y).lineWidth(0.8).strokeColor('#cbd5e1').stroke();
    doc.restore();
    y += 10;

    // ── Info grid (3 rows × 2 cols) ───────────────────────────────────────────
    // Each row: [Label, Value, Label, Value]
    const colL  = marginX;
    const colM  = pageW / 2 + 10;
    const infoRowH = 16;
    const labelColor = '#374151';
    const valueColor = '#111827';

    const infoRows: [string, string, string, string][] = [
      ['Pay Period:',    vars.pay_period || vars.month_name || '',   'Pay Date:',    vars.pay_date || ''],
      ['Employee Name:', vars.employee_name || '',                   'Employee ID:', vars.employee_id || ''],
      ['Shift:',         vars.shift_time ? `${vars.shift_name} (${vars.shift_time})` : vars.shift_name || '', 'Status:', vars.payment_status || ''],
    ];

    infoRows.forEach(([lLabel, lVal, rLabel, rVal]) => {
      // left label bold
      doc.font(FONT_BOLD).fontSize(9).fillColor(labelColor).text(lLabel, colL, y);
      // left value
      doc.font(FONT_REGULAR).fontSize(9).fillColor(valueColor)
        .text(lVal, colL + 90, y, { width: contentW / 2 - 90 });

      // right label bold
      doc.font(FONT_BOLD).fontSize(9).fillColor(labelColor).text(rLabel, colM, y);
      // right value
      doc.font(FONT_REGULAR).fontSize(9).fillColor(valueColor)
        .text(rVal, colM + 82, y, { width: contentW / 2 - 82 });

      y += infoRowH;
    });

    y += 10;

    // ── Thin divider ──────────────────────────────────────────────────────────
    doc.save();
    doc.moveTo(marginX, y).lineTo(pageW - marginX, y).lineWidth(0.8).strokeColor('#cbd5e1').stroke();
    doc.restore();
    y += 6;

    // ── Table ─────────────────────────────────────────────────────────────────
    const tableX = marginX;
    const tableW = contentW;
    const halfW  = tableW / 2;
    const rowH   = 20;

    // Section header row
    // Left: EARNINGS (blue on light blue)
    doc.save();
    doc.rect(tableX, y, halfW, 20).fill('#dbeafe');
    doc.restore();
    doc.font(FONT_BOLD).fontSize(9).fillColor('#1d4ed8')
      .text('Earnings', tableX, y + 5, { width: halfW, align: 'center' });

    // Right: ATTENDANCE & HOURS (orange on light orange)
    doc.save();
    doc.rect(tableX + halfW, y, halfW, 20).fill('#ffedd5');
    doc.restore();
    doc.font(FONT_BOLD).fontSize(9).fillColor('#c2410c')
      .text('Attendance & Hours', tableX + halfW, y + 5, { width: halfW, align: 'center' });

    y += 20;

    // Data rows
    const tableRows = [
      { eL: 'Monthly Salary',       eV: `\u20B9 ${vars.monthly_salary}`,            deduct: false, aL: 'Total Days in Month',  aV: vars.total_days },
      { eL: 'Salary Per Day',        eV: `\u20B9 ${vars.per_day_salary}`,            deduct: false, aL: 'Salary Per Hour',      aV: `\u20B9 ${vars.per_hour_salary}` },
      { eL: 'Basic Salary',          eV: `\u20B9 ${vars.basic_salary}`,              deduct: false, aL: 'Total Working Days',   aV: vars.working_days },
      { eL: 'Sunday & Holiday Pay',  eV: `\u20B9 ${vars.sunday_holiday_pay}`,        deduct: false, aL: 'Mon-Sat Present Days', aV: vars.present_days },
      { eL: 'Overtime Payout',       eV: `\u20B9 ${vars.overtime_pay}`,              deduct: false, aL: 'Overtime Hours',       aV: vars.overtime_hours },
      { eL: 'Commission/Pending',    eV: `\u20B9 ${vars.commission}`,                deduct: false, aL: 'Total Hours Worked',   aV: vars.total_hours_worked },
      { eL: 'Advance Deducted',      eV: `- \u20B9 ${vars.advance_deducted}`,        deduct: true,  aL: 'Expected Hours',       aV: vars.expected_hours },
    ];

    tableRows.forEach((r, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.save();
      doc.rect(tableX, y, tableW, rowH).fill(bg);
      doc.restore();

      // Border between left and right columns
      doc.save();
      doc.moveTo(tableX + halfW, y).lineTo(tableX + halfW, y + rowH)
        .lineWidth(0.4).strokeColor('#e2e8f0').stroke();
      doc.restore();

      // Left: earnings label
      doc.font(FONT_REGULAR).fontSize(9).fillColor(r.deduct ? '#dc2626' : '#374151')
        .text(r.eL, tableX + 8, y + 5);

      // Left: earnings value (right-aligned)
      doc.font(FONT_REGULAR).fontSize(9).fillColor(r.deduct ? '#dc2626' : '#111827')
        .text(r.eV, tableX + 8, y + 5, { width: halfW - 16, align: 'right' });

      // Right: attendance label
      doc.font(FONT_REGULAR).fontSize(9).fillColor('#374151')
        .text(r.aL, tableX + halfW + 8, y + 5);

      // Right: attendance value (right-aligned)
      doc.font(FONT_REGULAR).fontSize(9).fillColor('#111827')
        .text(r.aV, tableX + halfW + 8, y + 5, { width: halfW - 16, align: 'right' });

      // Row bottom border
      doc.save();
      doc.moveTo(tableX, y + rowH).lineTo(tableX + tableW, y + rowH)
        .lineWidth(0.4).strokeColor('#e2e8f0').stroke();
      doc.restore();

      y += rowH;
    });

    // ── Net Salary row (full-width, light green) ──────────────────────────────
    const netH = 22;
    doc.save();
    doc.rect(tableX, y, tableW, netH).fill('#dcfce7');
    doc.restore();

    doc.font(FONT_BOLD).fontSize(9.5).fillColor('#16a34a')
      .text('Net Salary', tableX + 8, y + 6);

    doc.font(FONT_BOLD).fontSize(10).fillColor('#15803d')
      .text(`\u20B9 ${vars.net_salary} /-`, tableX + 8, y + 6, { width: tableW - 16, align: 'right' });

    // bottom border of net row
    doc.save();
    doc.moveTo(tableX, y + netH).lineTo(tableX + tableW, y + netH)
      .lineWidth(0.8).strokeColor('#cbd5e1').stroke();
    doc.restore();

    y += netH + 12;

    // ── Payment Status footer ─────────────────────────────────────────────────
    const isPaid      = vars.payment_status.toLowerCase() === 'paid';
    const statusColor = isPaid ? '#16a34a' : '#d97706';
    const statusLabel = isPaid ? 'Paid' : 'Pending';

    doc.font(FONT_BOLD).fontSize(9).fillColor('#374151').text('Payment Status:', tableX, y);
    doc.font(FONT_BOLD).fontSize(9).fillColor(statusColor).text(statusLabel, tableX + 96, y);

    doc.font(FONT_BOLD).fontSize(9).fillColor('#374151').text('Paid On:', tableX + 250, y);
    doc.font(FONT_REGULAR).fontSize(9).fillColor('#111827')
      .text(vars.paid_on || 'Pending', tableX + 300, y, { width: tableW - 300 });

    y += 16;

    doc.font(FONT_BOLD).fontSize(9).fillColor('#374151').text('Remarks:', tableX, y);
    doc.font(FONT_REGULAR).fontSize(9).fillColor('#111827')
      .text(vars.remarks || '', tableX + 58, y, { width: tableW - 58 });

    doc.end();
  });
}
