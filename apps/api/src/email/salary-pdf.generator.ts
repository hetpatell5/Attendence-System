import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';
import type { SalaryTemplateVariables } from './email.service';

/**
 * `nest build` (sourceRoot "src", no rootDir override) compiles this file to
 * `dist/src/email/salary-pdf.generator.js` while the nest-cli "assets" copy step puts
 * static files at `dist/assets/...` — one directory shallower than `__dirname` would
 * suggest. A single hardcoded `path.join(__dirname, '..', 'assets', ...)` (what this file
 * used to do for the default logo) resolves to `dist/src/assets/...`, which never exists,
 * so the fallback logo has silently never loaded in a production build. Trying both depths
 * makes this resilient to that build-layout quirk and to running via ts-node in dev, where
 * `__dirname` is `src/email` and only one `..` is needed.
 */
function resolveAssetPath(...segments: string[]): string {
  const candidates = [
    path.join(__dirname, '..', 'assets', ...segments),
    path.join(__dirname, '..', '..', 'assets', ...segments),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;
}

// Helvetica (PDFKit's built-in font) is a Type1/WinAnsi font with no glyph for the Indian
// Rupee sign (U+20B9) — it silently substitutes a wrong glyph (renders as "¹"). Noto Sans
// is bundled here specifically because it covers ₹, and used for every string in this
// document (not just the ones with ₹) so headings/body text stay visually consistent
// rather than mixing two different typefaces.
const FONT_REGULAR_PATH = resolveAssetPath('fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD_PATH = resolveAssetPath('fonts', 'NotoSans-Bold.ttf');
const FONT_REGULAR = 'NotoSans';
const FONT_BOLD = 'NotoSans-Bold';

/**
 * Fills a rect with a translucent color. PDFKit's `fillColor()` does not parse CSS-style
 * `rgba(...)` strings the way a browser does — passing one silently fails and falls back
 * to solid black, which is why the logo background and "SALARY SLIP" pill used to render
 * as solid black / blank boxes. The correct PDFKit idiom is a solid hex fillColor plus a
 * separate fillOpacity call, reset back to 1 afterward so it doesn't leak into later draws.
 */
function fillTranslucent(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  hexColor: string,
  opacity: number,
  radius?: number,
): void {
  doc.save();
  if (radius !== undefined) {
    doc.roundedRect(x, y, w, h, radius);
  } else {
    doc.rect(x, y, w, h);
  }
  doc.fillColor(hexColor).fillOpacity(opacity).fill();
  doc.restore();
}

/**
 * Generates a clean, professional salary slip PDF.
 * Design: white card with dark blue header band, simple info grid, two-column table.
 * Mirrors the "Salary Slip Document Preview" React modal (SalaryManagementPage.tsx /
 * MySalaryPage.tsx) as closely as PDFKit's coordinate-based drawing allows.
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
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Layout constants
    const pageW = 595.28;
    const margin = 32;
    const cardX = margin;
    const cardW = pageW - margin * 2;
    let y = margin;

    // ─── Outer card border ────────────────────────────────────────────────────
    doc.save();
    doc.roundedRect(cardX, y, cardW, 760, 10)
      .lineWidth(1)
      .strokeColor('#e2e8f0')
      .fillColor('#ffffff')
      .fillAndStroke();
    doc.restore();

    // ─── Header band (dark blue) ──────────────────────────────────────────────
    const headerH = 92;
    doc.save();
    doc.roundedRect(cardX, y, cardW, headerH, 10).fill('#0f4c81');
    // mask bottom corners to stay square
    doc.rect(cardX, y + headerH - 10, cardW, 10).fill('#0f4c81');
    doc.restore();

    // Logo (left side of header) — sized to fill most of the header height (matches the
    // React preview's h-12/h-14 logo box) rather than a small icon lost in the band.
    let logoBuffer: Buffer | null = null;
    if (vars.company_logo && vars.company_logo.startsWith('data:image')) {
      try {
        const base64Data = vars.company_logo.split(',')[1];
        if (base64Data) logoBuffer = Buffer.from(base64Data, 'base64');
      } catch { logoBuffer = null; }
    }
    if (!logoBuffer) {
      const defaultLogoPath = resolveAssetPath('logo.jpeg');
      if (fs.existsSync(defaultLogoPath)) {
        try { logoBuffer = fs.readFileSync(defaultLogoPath); } catch { logoBuffer = null; }
      }
    }

    const logoBoxSize = 64;
    const logoPad = 10;
    const logoX = cardX + 18;
    const logoY = y + (headerH - logoBoxSize) / 2;

    if (logoBuffer) {
      try {
        // Solid white plate behind the logo — most company logos are designed for a white
        // background, so a translucent navy tint (the old rgba() background) makes them
        // muddy. A crisp white rounded plate matches how logos usually read.
        doc.save();
        doc.roundedRect(logoX, logoY, logoBoxSize, logoBoxSize, 8).fillColor('#ffffff').fill();
        doc.restore();
        doc.image(logoBuffer, logoX + logoPad / 2, logoY + logoPad / 2, {
          fit: [logoBoxSize - logoPad, logoBoxSize - logoPad],
          align: 'center',
          valign: 'center',
        });
      } catch { /* ignore a corrupt logo image, header still renders without it */ }
    }

    // Company name + address (right of logo)
    const textX = logoBuffer ? logoX + logoBoxSize + 14 : cardX + 18;
    doc.font(FONT_BOLD)
      .fontSize(16)
      .fillColor('#ffffff')
      .text(vars.company_name || 'BMAP Pvt Ltd', textX, y + 20, { width: cardW - (textX - cardX) - 110 });

    const address = vars.company_address || '';
    doc.font(FONT_REGULAR)
      .fontSize(7.5)
      .fillColor('#dcebff')
      .text(address, textX, y + 40, { width: cardW - (textX - cardX) - 110, lineGap: 1 });

    // "SALARY SLIP" pill (right of header)
    const pillW = 100;
    const pillH = 24;
    const pillX = cardX + cardW - pillW - 18;
    const pillY = y + (headerH - pillH) / 2;
    fillTranslucent(doc, pillX, pillY, pillW, pillH, '#ffffff', 0.16, 12);
    doc.font(FONT_BOLD)
      .fontSize(9)
      .fillColor('#ffffff')
      .text('SALARY SLIP', pillX, pillY + 8, { width: pillW, align: 'center' });

    y += headerH + 4;

    // Month badge below header band (right aligned)
    doc.font(FONT_BOLD)
      .fontSize(8.5)
      .fillColor('#1a6fba')
      .text(vars.month_name || '', cardX, y + 6, { width: cardW - 8, align: 'right' });

    y += 22;

    // ─── Employee info grid (2×2) ─────────────────────────────────────────────
    const gridX = cardX + 14;
    const gridW = cardW - 28;
    const colW = gridW / 2;
    const gridRowH = 36;

    const shiftDisplay = vars.shift_time
      ? `${vars.shift_name} (${vars.shift_time})`
      : vars.shift_name || 'Full Day';

    const payDateDisplay = vars.pay_date || vars.pay_period;

    const infoItems: [string, string][] = [
      ['EMPLOYEE NAME', vars.employee_name || ''],
      ['EMPLOYEE ID', vars.employee_id || ''],
      ['SHIFT', shiftDisplay],
      ['PAY DATE', payDateDisplay || ''],
    ];

    infoItems.forEach((item, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const ix = gridX + col * colW;
      const iy = y + row * gridRowH;

      // light border
      doc.save();
      doc.rect(ix, iy, colW, gridRowH).strokeColor('#f0f4f8').lineWidth(0.5).stroke();
      doc.restore();

      doc.font(FONT_REGULAR)
        .fontSize(7)
        .fillColor('#94a3b8')
        .text(item[0], ix + 10, iy + 7, { width: colW - 14 });

      doc.font(FONT_BOLD)
        .fontSize(9.5)
        .fillColor('#1e293b')
        .text(item[1], ix + 10, iy + 18, { width: colW - 14 });
    });

    y += 2 * gridRowH + 8;

    // ─── Section headers ──────────────────────────────────────────────────────
    const tableX = cardX + 14;
    const tableW = cardW - 28;
    const halfW = tableW / 2;
    const rowH = 21;

    // Earnings header
    doc.save();
    doc.rect(tableX, y, halfW, 20).fill('#f0f7ff');
    doc.restore();
    doc.font(FONT_BOLD).fontSize(8).fillColor('#1563ac')
      .text('EARNINGS', tableX + 8, y + 6);

    // Attendance header
    doc.save();
    doc.rect(tableX + halfW, y, halfW, 20).fill('#fff7ed');
    doc.restore();
    doc.font(FONT_BOLD).fontSize(8).fillColor('#c2570a')
      .text('ATTENDANCE & HOURS', tableX + halfW + 8, y + 6);

    y += 20;

    // ─── Table rows ───────────────────────────────────────────────────────────
    const rows = [
      { eL: 'Monthly Salary',       eV: `₹ ${vars.monthly_salary}`,        bold: true,   aL: 'Total Days in Month',   aV: vars.total_days },
      { eL: 'Salary Per Day',        eV: `₹ ${vars.per_day_salary}`,        bold: false,  aL: 'Salary Per Hour',       aV: `₹ ${vars.per_hour_salary}` },
      { eL: 'Basic Salary',          eV: `₹ ${vars.basic_salary}`,          bold: false,  aL: 'Total Working Days',    aV: vars.working_days },
      { eL: 'Sunday & Holiday Pay',  eV: `₹ ${vars.sunday_holiday_pay}`,    bold: false,  aL: 'Mon-Sat Present Days',  aV: vars.present_days },
      { eL: 'Overtime Payout',       eV: `₹ ${vars.overtime_pay}`,          bold: false,  aL: 'Overtime Hours',        aV: vars.overtime_hours },
      { eL: 'Commission / Extra',    eV: `₹ ${vars.commission}`,            bold: false,  aL: 'Total Hours Worked',    aV: vars.total_hours_worked },
      { eL: 'Advance Deducted',      eV: `– ₹ ${vars.advance_deducted}`, deduct: true, aL: 'Expected Hours', aV: vars.expected_hours },
    ];

    rows.forEach((r, idx) => {
      const isEven = idx % 2 === 0;
      if (isEven) {
        doc.save();
        doc.rect(tableX, y, tableW, rowH).fill('#f8fafc');
        doc.restore();
      }

      // Left: Earnings
      doc.font(FONT_REGULAR).fontSize(8.5)
        .fillColor(r.deduct ? '#dc2626' : '#475569')
        .text(r.eL, tableX + 8, y + 6);

      doc.font(r.bold || r.deduct ? FONT_BOLD : FONT_REGULAR).fontSize(8.5)
        .fillColor(r.deduct ? '#dc2626' : '#0f172a')
        .text(r.eV, tableX + 8, y + 6, { width: halfW - 16, align: 'right' });

      // Right: Attendance
      doc.font(FONT_REGULAR).fontSize(8.5)
        .fillColor('#475569')
        .text(r.aL, tableX + halfW + 8, y + 6);

      doc.font(FONT_REGULAR).fontSize(8.5)
        .fillColor('#0f172a')
        .text(r.aV, tableX + halfW + 8, y + 6, { width: halfW - 16, align: 'right' });

      // row bottom border
      doc.save();
      doc.moveTo(tableX, y + rowH).lineTo(tableX + tableW, y + rowH)
        .lineWidth(0.4).strokeColor('#e9eef3').stroke();
      doc.restore();

      y += rowH;
    });

    // ─── Net Salary band ──────────────────────────────────────────────────────
    const netH = 36;
    doc.save();
    doc.rect(tableX, y, tableW, netH).fill('#e8f5ee');
    doc.restore();

    doc.font(FONT_BOLD).fontSize(9).fillColor('#059669')
      .text('NET SALARY', tableX + 10, y + 8);
    doc.font(FONT_BOLD).fontSize(16).fillColor('#047857')
      .text(`₹ ${vars.net_salary} /-`, tableX + 10, y + 18);

    // Status pill (mirrors the React preview's rounded "Paid"/"Pending" badge instead of
    // plain colored text)
    const isPaid = vars.payment_status.toLowerCase() === 'paid';
    const statusColor = isPaid ? '#16a34a' : '#d97706';
    const statusLabel = isPaid ? 'Paid' : 'Pending';
    const statusPillW = doc.font(FONT_BOLD).fontSize(8.5).widthOfString(statusLabel) + 20;
    const statusPillH = 18;
    const statusPillX = tableX + tableW - 10 - statusPillW;
    const statusPillY = y + 8;
    doc.save();
    doc.roundedRect(statusPillX, statusPillY, statusPillW, statusPillH, 9)
      .fillColor(isPaid ? '#16a34a' : '#fef3c7')
      .fill();
    doc.restore();
    doc.font(FONT_BOLD).fontSize(8.5)
      .fillColor(isPaid ? '#ffffff' : '#92400e')
      .text(statusLabel, statusPillX, statusPillY + 5, { width: statusPillW, align: 'center' });

    doc.font(FONT_REGULAR).fontSize(7.5).fillColor('#6b7280')
      .text('All amounts in INR', tableX, statusPillY + statusPillH + 3, { width: tableW - 10, align: 'right' });

    y += netH + 12;

    // ─── Payment footer ───────────────────────────────────────────────────────
    const footerX = tableX;
    doc.font(FONT_BOLD).fontSize(8.5).fillColor('#64748b').text('Payment Status:', footerX, y);
    doc.font(FONT_BOLD).fontSize(8.5).fillColor(statusColor).text(statusLabel, footerX + 90, y);

    doc.font(FONT_BOLD).fontSize(8.5).fillColor('#64748b').text('Paid On:', footerX + 240, y);
    doc.font(FONT_REGULAR).fontSize(8.5).fillColor('#1e293b').text(vars.paid_on || 'Pending', footerX + 290, y, { width: 160 });

    if (vars.remarks) {
      y += 15;
      doc.font(FONT_BOLD).fontSize(8.5).fillColor('#64748b').text('Remarks:', footerX, y);
      doc.font(FONT_REGULAR).fontSize(8.5).fillColor('#1e293b').text(vars.remarks, footerX + 58, y, { width: tableW - 58 });
    }

    y += 24;

    // ─── Footer note ──────────────────────────────────────────────────────────
    doc.font(FONT_REGULAR).fontSize(7).fillColor('#94a3b8')
      .text('This is a computer-generated salary slip and does not require a signature.', cardX, y, { width: cardW, align: 'center' });

    doc.end();
  });
}
