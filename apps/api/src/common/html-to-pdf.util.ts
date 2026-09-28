import { Logger } from '@nestjs/common';
import puppeteer, { Browser, type LaunchOptions } from 'puppeteer-core';

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
 *
 * On Linux (production) this uses @sparticuz/chromium's statically-linked Chromium build
 * instead of Puppeteer's own bundled one — the bundled one is dynamically linked against
 * system libraries (libatk-1.0.so.0, libnss3, ...) that most VPS/CloudPanel boxes don't
 * have installed, and won't unless someone has root/sudo to apt-get them. The static build
 * needs nothing beyond what's already there. On Windows/macOS (local dev) it falls back to
 * the full `puppeteer` package's own downloaded Chrome, since @sparticuz/chromium is
 * Linux-only.
 */
async function resolveLaunchOptions(): Promise<LaunchOptions> {
  if (process.platform === 'linux') {
    const chromium = (await import('@sparticuz/chromium')).default;
    return {
      executablePath: await chromium.executablePath(),
      args: chromium.args,
      headless: true,
    };
  }
  // Local dev fallback (Windows/macOS): reuse the full `puppeteer` package's own
  // downloaded Chrome, via its executablePath, launched through puppeteer-core.
  const fullPuppeteer = (await import('puppeteer')).default;
  return {
    executablePath: await fullPuppeteer.executablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
  };
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = resolveLaunchOptions()
      .then((options) => puppeteer.launch(options))
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
