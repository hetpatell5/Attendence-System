/**
 * 1:1 port of AttenOld/admin/perf_range.php's PDF export (FPDF) — the "Employee
 * Performance Report" downloaded from the Performance page's Last 30 Days / Last 3
 * Months / Custom Date buttons. FPDF draws plain black-bordered cells with a few
 * tinted header fills; every color/width/heading below is copied from that file
 * (including its duplicated "Attendance Details" / "Attendance Details (Presents)"
 * headings — that's a quirk of the original, kept verbatim for fidelity).
 */

export interface PresentRow {
  id: number;
  date: string; // dd-mm-yyyy
  day: string; // 3-letter, e.g. "Mon"
  entryTime: string; // e.g. "09:01 AM"
  exitTime: string;
  hours: string; // "HH:MM:SS"
  status: string; // "On Time" | "Late (Xm)" [+", OT"]
  isLate: boolean;
}

export interface AbsentRow {
  id: number;
  date: string;
  day: string; // full day name, e.g. "Monday"
  reason: string;
}

export interface HolidaySundayRow {
  id: number;
  date: string;
  day: string;
  description: string;
}

export interface PerformanceReportData {
  logoSrc: string;
  employeeName: string;
  shiftText: string;
  rangeLabel: string; // e.g. "Last 3 Months"
  fromLabel: string; // dd-mm-yyyy
  toLabel: string;
  totalDays: number;
  sundays: number;
  holidays: number;
  working: number;
  presents: number;
  absents: number;
  presentRows: PresentRow[];
  absentRows: AbsentRow[];
  holidaySundayRows: HolidaySundayRow[];
  generatedOnLabel: string; // "dd Mon yyyy HH:MM"
}

function cell(width: number, text: string, opts: { bold?: boolean; fill?: string; color?: string; align?: string } = {}): string {
  const weight = opts.bold ? 'font-weight:700;' : '';
  const bg = opts.fill ? `background:${opts.fill};` : '';
  const color = opts.color ? `color:${opts.color};` : '';
  const align = opts.align ?? 'center';
  return `<td style="width:${width}mm;border:0.3mm solid #000;padding:1.2mm 1mm;text-align:${align};font-size:9pt;${weight}${bg}${color}">${text}</td>`;
}

function noRowsCell(label: string): string {
  return `<tr>${cell(188, label, {})}</tr>`;
}

export function buildPerformanceReportHtml(d: PerformanceReportData): string {
  const presentHeader = `<tr>${cell(12, 'ID', { bold: true, fill: '#c8dcff' })}${cell(25, 'Date', {
    bold: true,
    fill: '#c8dcff',
  })}${cell(20, 'Day', { bold: true, fill: '#c8dcff' })}${cell(33, 'Entry Time', { bold: true, fill: '#c8dcff' })}${cell(
    33,
    'Exit Time',
    { bold: true, fill: '#c8dcff' },
  )}${cell(30, 'Hours', { bold: true, fill: '#c8dcff' })}${cell(35, 'Status', { bold: true, fill: '#c8dcff' })}</tr>`;

  const presentBody =
    d.presentRows.length > 0
      ? d.presentRows
          .map(
            (r) =>
              `<tr>${cell(12, String(r.id), { color: r.isLate ? '#c80000' : undefined })}${cell(25, r.date, {
                color: r.isLate ? '#c80000' : undefined,
              })}${cell(20, r.day, { color: r.isLate ? '#c80000' : undefined })}${cell(33, r.entryTime, {
                color: r.isLate ? '#c80000' : undefined,
              })}${cell(33, r.exitTime, { color: r.isLate ? '#c80000' : undefined })}${cell(30, r.hours, {
                color: r.isLate ? '#c80000' : undefined,
              })}${cell(35, r.status, { color: r.isLate ? '#c80000' : undefined })}</tr>`,
          )
          .join('')
      : noRowsCell('No present days found');

  const absentHeader = `<tr>${cell(15, 'ID', { bold: true, fill: '#ffe6e6' })}${cell(40, 'Date', {
    bold: true,
    fill: '#ffe6e6',
  })}${cell(40, 'Day', { bold: true, fill: '#ffe6e6' })}${cell(93, 'Reason', { bold: true, fill: '#ffe6e6', align: 'left' })}</tr>`;
  const absentBody =
    d.absentRows.length > 0
      ? d.absentRows
          .map(
            (r) =>
              `<tr>${cell(15, String(r.id))}${cell(40, r.date)}${cell(40, r.day)}${cell(93, r.reason, { align: 'left' })}</tr>`,
          )
          .join('')
      : noRowsCell('No absences found');

  const holHeader = `<tr>${cell(15, 'ID', { bold: true, fill: '#e6f5ff' })}${cell(45, 'Date', {
    bold: true,
    fill: '#e6f5ff',
  })}${cell(45, 'Day', { bold: true, fill: '#e6f5ff' })}${cell(83, 'Description', {
    bold: true,
    fill: '#e6f5ff',
    align: 'left',
  })}</tr>`;
  const holBody =
    d.holidaySundayRows.length > 0
      ? d.holidaySundayRows
          .map(
            (r) =>
              `<tr>${cell(15, String(r.id))}${cell(45, r.date)}${cell(45, r.day)}${cell(83, r.description, {
                align: 'left',
              })}</tr>`,
          )
          .join('')
      : noRowsCell('No holidays/Sundays found');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; color:#000; margin:0; padding:10mm 11mm; font-size:10pt; }
    table { border-collapse: collapse; width: 188mm; }
    .header-table { width:100%; margin-bottom:6mm; }
    .title { font-size:18pt; font-weight:700; color:#14283c; text-align:right; }
    .subtitle { font-size:12pt; text-align:right; margin-top:1mm; }
    .section-heading { font-size:12pt; font-weight:700; margin:4mm 0 2mm 0; }
    .emp-box { border:0.3mm solid #dce6f0; background:#f5f8fc; padding:2mm; font-size:10pt; margin-bottom:1mm; }
    .footer { text-align:center; font-size:8pt; font-style:italic; margin-top:8mm; }
    img.logo { width:60mm; }
  </style></head><body>
    <table class="header-table"><tr>
      <td style="width:35%;vertical-align:top;">${d.logoSrc ? `<img src="${d.logoSrc}" class="logo">` : ''}</td>
      <td style="width:65%;vertical-align:top;">
        <div class="title">Employee Performance Report</div>
        <div class="subtitle">${d.rangeLabel} (${d.fromLabel} - ${d.toLabel})</div>
      </td>
    </tr></table>

    <div class="section-heading">Employee Details</div>
    <div class="emp-box">Name: ${d.employeeName}</div>
    <div class="emp-box">Shift: ${d.shiftText}</div>

    <div class="section-heading">Attendance Summary</div>
    <table>
      <tr>${cell(50, 'Period', { bold: true, fill: '#c8dcff' })}${cell(22, 'Total', { bold: true, fill: '#c8dcff' })}${cell(
        22,
        'Sundays',
        { bold: true, fill: '#c8dcff' },
      )}${cell(22, 'Holidays', { bold: true, fill: '#c8dcff' })}${cell(22, 'Working', { bold: true, fill: '#c8dcff' })}${cell(
        22,
        'Presents',
        { bold: true, fill: '#c8dcff' },
      )}${cell(22, 'Absents', { bold: true, fill: '#c8dcff' })}</tr>
      <tr>${cell(50, `${d.fromLabel} to ${d.toLabel}`)}${cell(22, String(d.totalDays))}${cell(22, String(d.sundays))}${cell(
        22,
        String(d.holidays),
      )}${cell(22, String(d.working))}${cell(22, String(d.presents))}${cell(22, String(d.absents))}</tr>
    </table>

    <div class="section-heading">Attendance Details</div>
    <div class="section-heading" style="margin-top:0;">Attendance Details (Presents)</div>
    <table>${presentHeader}${presentBody}</table>

    <div class="section-heading">Absent Details (Day-by-Day)</div>
    <table>${absentHeader}${absentBody}</table>

    <div class="section-heading">Sundays &amp; Holiday Details</div>
    <table>${holHeader}${holBody}</table>

    <div class="footer">Generated on ${d.generatedOnLabel}</div>
  </body></html>`;
}
