import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';
import type { SalaryTemplateVariables } from './email.service';

/**
 * Generates an exact 1:1 legacy replica PDF for Salary Slips (Matching AttenOld/month_dashboard.php).
 */
export function generateSalarySlipPdf(vars: SalaryTemplateVariables): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // A4 dimensions in points: 595.28 x 841.89
    const doc = new PDFDocument({
      size: 'A4',
      margin: 30,
      info: {
        Title: `Salary Slip - ${vars.employee_name} (${vars.month_name})`,
        Author: vars.company_name,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const cardX = 35;
    const cardY = 30;
    const cardWidth = 525;
    const cardHeight = 770;

    // Draw outer card shadow & border
    doc.save();
    doc.roundedRect(cardX, cardY, cardWidth, cardHeight, 12)
      .lineWidth(1.5)
      .strokeColor('#e2e8f0')
      .fillColor('#ffffff')
      .fillAndStroke();
    doc.restore();

    let currentY = cardY + 16;

    // 1. Logo Header
    let logoBuffer: Buffer | null = null;
    if (vars.company_logo && vars.company_logo.startsWith('data:image')) {
      try {
        const base64Data = vars.company_logo.split(',')[1];
        if (base64Data) logoBuffer = Buffer.from(base64Data, 'base64');
      } catch {
        logoBuffer = null;
      }
    }

    if (!logoBuffer) {
      // Try local fallback logo
      const defaultLogoPath = path.join(__dirname, '..', 'assets', 'logo.jpeg');
      if (fs.existsSync(defaultLogoPath)) {
        try {
          logoBuffer = fs.readFileSync(defaultLogoPath);
        } catch {
          logoBuffer = null;
        }
      }
    }

    if (logoBuffer) {
      try {
        const logoWidth = 230;
        const logoX = cardX + (cardWidth - logoWidth) / 2;
        doc.image(logoBuffer, logoX, currentY, { width: logoWidth, fit: [logoWidth, 60], align: 'center' });
        currentY += 66;
      } catch {
        currentY += 10;
      }
    } else {
      currentY += 10;
    }

    // Company Name
    doc.font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#1968a7')
      .text(vars.company_name || 'BMAP Pvt Ltd', cardX, currentY, { width: cardWidth, align: 'center' });
    currentY += 20;

    // Company Address
    const address = vars.company_address || '206 Sunrise Commercial Complex - Near, Savjibhai Korat Bridge, Lajamani chowk, Shanti Niketan Society, Mota Varachha, Surat, Gujarat 394105 • bookmyassignments.com';
    doc.font('Helvetica')
      .fontSize(8)
      .fillColor('#718096')
      .text(address, cardX + 30, currentY, { width: cardWidth - 60, align: 'center', lineGap: 1.5 });
    currentY += 24;

    // Subtitle: SALARY SLIP
    doc.font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#2e415a')
      .text('Salary Slip', cardX, currentY, { width: cardWidth, align: 'center' });
    currentY += 22;

    // 2. Metadata Box
    const metaX = cardX + 25;
    const metaWidth = cardWidth - 50;
    const metaCol1 = metaX;
    const metaCol2 = metaX + 85;
    const metaCol3 = metaX + 265;
    const metaCol4 = metaX + 360;

    const drawMetaRow = (l1: string, v1: string, l2: string, v2: string, isStatusPaid = false) => {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#4a5568').text(l1, metaCol1, currentY);
      doc.font('Helvetica').fontSize(9.5).fillColor('#1a202c').text(v1, metaCol2, currentY, { width: 170 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#4a5568').text(l2, metaCol3, currentY);
      
      if (isStatusPaid) {
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#16a34a').text(v2, metaCol4, currentY);
      } else {
        doc.font('Helvetica').fontSize(9.5).fillColor('#1a202c').text(v2, metaCol4, currentY, { width: 150 });
      }
      currentY += 16;
    };

    drawMetaRow('Pay Period:', vars.pay_period || vars.month_name, 'Pay Date:', vars.pay_date);
    drawMetaRow('Employee Name:', vars.employee_name, 'Employee ID:', vars.employee_id);
    drawMetaRow('Shift:', `${vars.shift_name} (${vars.shift_time})`, 'Status:', vars.payment_status, vars.payment_status.toLowerCase() === 'paid');
    currentY += 10;

    // 3. Two-Column Earnings & Attendance Table
    const tableX = cardX + 20;
    const tableWidth = cardWidth - 40;
    const halfWidth = tableWidth / 2;

    // Header row
    const rowHeight = 22;
    doc.save();
    doc.rect(tableX, currentY, halfWidth, rowHeight).fill('#e9f4fb');
    doc.rect(tableX + halfWidth, currentY, halfWidth, rowHeight).fill('#e9f4fb');
    doc.restore();

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1563ac').text('Earnings', tableX + 10, currentY + 6);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#d67412').text('Attendance & Hours', tableX + halfWidth + 10, currentY + 6);
    currentY += rowHeight;

    // Table rows
    const rows = [
      {
        eLabel: 'Monthly Salary',
        eVal: `Rs. ${vars.monthly_salary}`,
        isBold: true,
        aLabel: 'Total Days in Month',
        aVal: vars.total_days,
      },
      {
        eLabel: 'Salary Per Day',
        eVal: `Rs. ${vars.per_day_salary}`,
        aLabel: 'Salary Per Hour',
        aVal: `Rs. ${vars.per_hour_salary}`,
      },
      {
        eLabel: 'Basic Salary',
        eVal: `Rs. ${vars.basic_salary}`,
        aLabel: 'Total Working Days',
        aVal: vars.working_days,
      },
      {
        eLabel: 'Sunday & Holiday Pay',
        eVal: `Rs. ${vars.sunday_holiday_pay}`,
        aLabel: 'Mon-Sat Present Days',
        aVal: vars.present_days,
      },
      {
        eLabel: 'Overtime Payout',
        eVal: `Rs. ${vars.overtime_pay}`,
        aLabel: 'Overtime Hours',
        aVal: vars.overtime_hours,
      },
      {
        eLabel: 'Commission/Pending',
        eVal: `Rs. ${vars.commission}`,
        aLabel: 'Total Hours Worked',
        aVal: vars.total_hours_worked,
      },
      {
        eLabel: 'Advance Deducted',
        eVal: `- Rs. ${vars.advance_deducted}`,
        isDeduct: true,
        aLabel: 'Expected Hours',
        aVal: vars.expected_hours,
      },
    ];

    rows.forEach((r, idx) => {
      const isEven = idx % 2 === 0;
      if (isEven) {
        doc.save();
        doc.rect(tableX, currentY, tableWidth, rowHeight).fill('#f8fafc');
        doc.restore();
      }

      // Left Earnings
      doc.font('Helvetica').fontSize(9).fillColor(r.isDeduct ? '#c93030' : '#4a5568').text(r.eLabel, tableX + 10, currentY + 6);
      doc.font(r.isBold || r.isDeduct ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9)
        .fillColor(r.isDeduct ? '#c93030' : '#1a202c')
        .text(r.eVal, tableX + 130, currentY + 6, { width: halfWidth - 140, align: 'right' });

      // Right Attendance
      doc.font('Helvetica').fontSize(9).fillColor('#4a5568').text(r.aLabel, tableX + halfWidth + 10, currentY + 6);
      doc.font('Helvetica')
        .fontSize(9)
        .fillColor('#1a202c')
        .text(r.aVal, tableX + halfWidth + 130, currentY + 6, { width: halfWidth - 140, align: 'right' });

      currentY += rowHeight;
    });

    // Net Salary Row (Green highlight)
    doc.save();
    doc.rect(tableX, currentY, tableWidth, 26).fill('#d8f0e8');
    doc.restore();

    doc.font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor('#217f44')
      .text('Net Salary', tableX + 10, currentY + 8);

    doc.font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#217f44')
      .text(`Rs. ${vars.net_salary} /-`, tableX + 120, currentY + 8);

    doc.font('Helvetica')
      .fontSize(8.5)
      .fillColor('#217f44')
      .text('All amounts in INR', tableX + halfWidth, currentY + 9, { width: halfWidth - 10, align: 'right' });

    currentY += 34;

    // 4. Bottom Footer Info
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#4a5568').text('Payment Status:', metaX, currentY);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#16a34a').text(vars.payment_status, metaX + 85, currentY);

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#4a5568').text('Paid On:', metaX + 220, currentY);
    doc.font('Helvetica').fontSize(9.5).fillColor('#1a202c').text(vars.paid_on, metaX + 270, currentY);
    currentY += 16;

    if (vars.remarks) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#4a5568').text('Remarks:', metaX, currentY);
      doc.font('Helvetica').fontSize(9.5).fillColor('#1a202c').text(vars.remarks, metaX + 85, currentY, { width: metaWidth - 85 });
    }

    doc.end();
  });
}
