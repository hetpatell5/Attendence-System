import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ReportEnvelope } from '../report-envelope.type';

@Injectable()
export class PdfExporterService {
  export(envelope: ReportEnvelope, title: string, subtitle?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(title, { align: 'left' });
      if (subtitle) {
        doc.fontSize(10).fillColor('gray').text(subtitle);
        doc.fillColor('black');
      }
      doc.moveDown();

      const columnCount = envelope.columns.length;
      const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const columnWidth = usableWidth / columnCount;
      const startX = doc.page.margins.left;
      let y = doc.y;

      const drawRow = (values: string[], isHeader: boolean): void => {
        doc.fontSize(9).font(isHeader ? 'Helvetica-Bold' : 'Helvetica');
        values.forEach((value, index) => {
          doc.text(value, startX + index * columnWidth, y, {
            width: columnWidth,
            ellipsis: true,
          });
        });
        y += 18;
        if (y > doc.page.height - doc.page.margins.bottom - 40) {
          doc.addPage();
          y = doc.page.margins.top;
        }
      };

      drawRow(
        envelope.columns.map((c) => c.label),
        true,
      );
      for (const row of envelope.rows) {
        drawRow(
          envelope.columns.map((c) => String(row[c.key] ?? '')),
          false,
        );
      }

      if (envelope.summary) {
        doc.moveDown();
        doc.fontSize(10).font('Helvetica-Bold').text('Summary');
        doc.font('Helvetica');
        for (const [key, value] of Object.entries(envelope.summary)) {
          doc.fontSize(9).text(`${key}: ${String(value)}`);
        }
      }

      doc.end();
    });
  }
}
