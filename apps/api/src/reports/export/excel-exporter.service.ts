import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { ReportEnvelope } from '../report-envelope.type';

@Injectable()
export class ExcelExporterService {
  async export(envelope: ReportEnvelope, title: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(title.slice(0, 31));

    sheet.columns = envelope.columns.map((col) => ({
      header: col.label,
      key: col.key,
      width: Math.max(col.label.length + 2, 14),
    }));

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const row of envelope.rows) {
      sheet.addRow(row);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
