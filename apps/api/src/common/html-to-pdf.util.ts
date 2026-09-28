import { Logger } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';

const logger = new Logger('HtmlToPdf');

/**
 * Both the salary slip and the attendance/performance report used to be rendered two
 * different ways: the on-screen preview from the real HTML template (so it always looked
 * right), and the downloaded PDF from a hand-drawn PDFKit re-implementation of the same
 * layout (so it never quite matched — different fonts, no shadows, slightly different
 * spacing). Printing the SAME html through a real browser engine removes that gap
 * entirely: whatever renders in the preview is byte-for-byte what becomes the PDF.
 *
 * A single headless Chromium instance is kept warm and reused across requests — launching
 * one per PDF (roughly 1-2s and a chunk of memory) would make every download noticeably
 * slower under load.
 */
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        // --no-sandbox is required to run Chromium as root, which is how most VPS/pm2
        // deployments run Node — without it Chromium refuses to start at all there.
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      .catch((err) => {
        // Don't cache a rejected launch — the next PDF request should retry rather than
        // fail forever until the process restarts.
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

// Best-effort cleanup so a dev-mode hot reload doesn't accumulate orphaned Chromium
// processes. In production pm2 kills the whole process tree on restart regardless.
process.on('exit', () => {
  void browserPromise?.then((b) => b.close()).catch(() => {});
});

export interface HtmlToPdfOptions {
  landscape?: boolean;
  /** e.g. { top: '8mm', bottom: '4mm', left: '8mm', right: '8mm' } */
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  /** Passed straight to page.pdf(); defaults to 'A4'. */
  format?: 'A4' | 'Letter';
}

export async function renderHtmlToPdf(html: string, options: HtmlToPdfOptions = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // All images are inline data URIs (no network fetches), so 'load' is enough —
    // 'networkidle0' isn't a valid setContent waitUntil value in this Puppeteer version.
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: options.format ?? 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      margin: options.margin ?? { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return Buffer.from(pdf);
  } catch (err) {
    logger.error(`PDF render failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}
