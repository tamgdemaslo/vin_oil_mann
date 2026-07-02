import { randomUUID } from "crypto";
import { access, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { WebSocket } from "undici";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: Record<string, unknown>;
};

type CdpClient = {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
  close(): void;
};

type RenderReportPdfOptions = {
  pageRanges?: string;
  printerSafe?: boolean;
};

type CdpPdfResult = {
  data?: string;
  stream?: string;
};

type CdpStreamReadResult = {
  data?: string;
  eof?: boolean;
  base64Encoded?: boolean;
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.NEXT_CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium-Gost.app/Contents/MacOS/Chromium-Gost",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Arc.app/Contents/MacOS/Arc",
  "/Applications/Yandex.app/Contents/MacOS/Yandex",
  "/System/Volumes/Data/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/System/Volumes/Data/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium",
  "microsoft-edge",
  "brave-browser",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean) as string[];

const CDP_COMMAND_TIMEOUT_MS = 15_000;
const CHROME_DEVTOOLS_TIMEOUT_MS = 30_000;
const CDP_PRINT_TIMEOUT_MS = 45_000;
const CDP_STREAM_READ_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label}: таймаут ${Math.round(timeoutMs / 1000)} сек.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function canLaunchExecutable(candidate: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(candidate, ["--version"], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(false);
    }, 2_000);

    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });

    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function findChromeExecutable(): Promise<string | null> {
  for (const candidate of [...new Set(CHROME_CANDIDATES)]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      if (await canLaunchExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function waitForDevtools(chrome: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let chromeOutput = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Chrome DevTools endpoint не появился. ${chromeOutput.slice(-800)}`));
    }, CHROME_DEVTOOLS_TIMEOUT_MS);

    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      chromeOutput += text;
      const match = chromeOutput.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(match[1]);
    };

    chrome.stderr.on("data", handleOutput);
    chrome.stdout.on("data", handleOutput);

    chrome.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    chrome.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Chrome завершился до генерации PDF: code=${code ?? "null"} signal=${signal ?? "null"}. ${chromeOutput.slice(-800)}`));
    });
  });
}

function connectCdp(wsUrl: string): Promise<CdpClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

    const cleanup = () => {
      for (const waiter of pending.values()) {
        waiter.reject(new Error("CDP connection closed"));
      }
      pending.clear();
    };

    socket.addEventListener("open", () => {
      resolve({
        send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
          const id = nextId++;
          const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
          return new Promise<T>((done, fail) => {
            pending.set(id, { resolve: (value) => done(value as T), reject: fail });
            socket.send(JSON.stringify(payload));
          });
        },
        close() {
          socket.close();
        },
      });
    });

    socket.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data)) as CdpResponse;
      if (!data.id) return;
      const waiter = pending.get(data.id);
      if (!waiter) return;
      pending.delete(data.id);
      if (data.error) {
        waiter.reject(new Error(data.error.message ?? "CDP error"));
        return;
      }
      waiter.resolve(data.result ?? {});
    });

    socket.addEventListener("error", () => {
      cleanup();
      reject(new Error("Не удалось подключиться к Chrome DevTools"));
    });

    socket.addEventListener("close", cleanup);
  });
}

async function waitForReportReady(cdp: CdpClient, sessionId: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastState: {
    readyState?: string;
    href?: string;
    title?: string;
    hasReport?: boolean;
    heroCount?: number;
    verdictCount?: number;
    stateText?: string;
    bodyText?: string;
  } = {};

  while (Date.now() < deadline) {
    const result = await withTimeout(
      cdp.send<{ result?: { value?: typeof lastState } }>(
        "Runtime.evaluate",
        {
          expression: `
          (() => {
            const heroCount = document.querySelectorAll('.paper-a4.rep .rep-hero').length;
            const verdictCount = document.querySelectorAll('.paper-a4.rep .rep-verdict').length;
            const stateText = document.querySelector('.diag-report-state')?.textContent?.trim() || '';
            const bodyText = document.body?.innerText?.replace(/\\s+/g, ' ').trim().slice(0, 360) || '';
            return {
              readyState: document.readyState,
              href: location.href,
              title: document.title,
              hasReport: heroCount > 0 && verdictCount > 0,
              heroCount,
              verdictCount,
              stateText,
              bodyText,
            };
          })()
        `,
          returnByValue: true,
        },
        sessionId
      ),
      CDP_COMMAND_TIMEOUT_MS,
      "Ожидание готовности отчёта"
    );
    lastState = result.result?.value ?? lastState;
    if (lastState.hasReport) return;

    if (lastState.stateText && !lastState.stateText.includes("Загрузка")) {
      throw new Error(`Страница отчёта открылась, но не отдала документ: ${lastState.stateText}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.error("[diagnostic-pdf] report page render timeout", lastState);
  throw new Error(
    `Отчёт не успел отрендериться для PDF. Состояние страницы: ${lastState.stateText || lastState.bodyText || lastState.readyState || "пусто"}`
  );
}

async function waitForFontsReady(cdp: CdpClient, sessionId: string): Promise<void> {
  await withTimeout(
    cdp.send(
      "Runtime.evaluate",
      {
        expression: `
        (async () => {
          if (!document.fonts?.ready) return true;
          await Promise.race([
            document.fonts.ready,
            new Promise((resolve) => setTimeout(resolve, 5000))
          ]);
          return document.fonts.status === 'loaded';
        })()
      `,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId
    ),
    CDP_COMMAND_TIMEOUT_MS,
    "Ожидание шрифтов"
  );
}

async function applyPrinterSafeOptimizations(cdp: CdpClient, sessionId: string): Promise<void> {
  const result = await withTimeout(
    cdp.send<{ result?: { value?: { optimizedPhotos?: number; skippedPhotos?: number } } }>(
      "Runtime.evaluate",
      {
        expression: `
        (async () => {
          document.documentElement.classList.add('tgm-printer-safe');

          const style = document.createElement('style');
          style.setAttribute('data-tgm-printer-safe', 'true');
          style.textContent = [
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep * {',
            '  box-shadow: none !important;',
            '  text-shadow: none !important;',
            '  filter: none !important;',
            '  backdrop-filter: none !important;',
            '  -webkit-backdrop-filter: none !important;',
            '  mix-blend-mode: normal !important;',
            '}',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .grain::after,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-hero-car::after,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-verdict::before {',
            '  content: none !important;',
            '  display: none !important;',
            '}',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-hero-car,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-photo-img {',
            '  background-color: #0a0a0a !important;',
            '}',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep * {',
            '  -webkit-print-color-adjust: exact !important;',
            '  print-color-adjust: exact !important;',
            '}'
          ].join('\\n');
          document.head.appendChild(style);

          const parseBackgroundUrl = (value) => {
            const match = String(value || '').match(/url\\((["']?)(.*?)\\1\\)/);
            return match?.[2] || '';
          };

          const loadImage = (src) => new Promise((resolve, reject) => {
            const img = new Image();
            let settled = false;
            const timer = setTimeout(() => fail(), 3500);
            const done = () => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve(img);
            };
            const fail = () => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              reject(new Error('image failed'));
            };
            img.decoding = 'async';
            img.onload = done;
            img.onerror = fail;
            img.src = src;
            if (img.complete && img.naturalWidth > 0) done();
          });

          const tiles = Array.from(document.querySelectorAll('.diag-print-screen.is-print .rep-photo-img'));
          let optimizedPhotos = 0;
          let skippedPhotos = 0;

          for (const tile of tiles) {
            try {
              const rawUrl = parseBackgroundUrl(getComputedStyle(tile).backgroundImage);
              if (!rawUrl || rawUrl.startsWith('data:')) {
                skippedPhotos += 1;
                continue;
              }

              const absoluteUrl = new URL(rawUrl, location.href).href;
              const image = await loadImage(absoluteUrl);
              const naturalWidth = image.naturalWidth || image.width;
              const naturalHeight = image.naturalHeight || image.height;
              if (!naturalWidth || !naturalHeight) {
                skippedPhotos += 1;
                continue;
              }

              const maxSide = 620;
              const maxPixels = 320000;
              const sideScale = Math.min(1, maxSide / naturalWidth, maxSide / naturalHeight);
              const pixelScale = Math.min(1, Math.sqrt(maxPixels / (naturalWidth * naturalHeight)));
              const scale = Math.min(sideScale, pixelScale);
              const width = Math.max(1, Math.round(naturalWidth * scale));
              const height = Math.max(1, Math.round(naturalHeight * scale));

              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const context = canvas.getContext('2d', { alpha: false });
              if (!context) {
                skippedPhotos += 1;
                continue;
              }

              context.fillStyle = '#0a0a0a';
              context.fillRect(0, 0, width, height);
              context.drawImage(image, 0, 0, width, height);
              const optimizedUrl = canvas.toDataURL('image/jpeg', 0.6);
              tile.style.backgroundImage = 'url("' + optimizedUrl + '")';
              tile.setAttribute('data-tgm-pdf-optimized', Math.round(optimizedUrl.length / 1024) + 'kb');
              optimizedPhotos += 1;
            } catch {
              skippedPhotos += 1;
            }
          }

          return { optimizedPhotos, skippedPhotos };
        })()
      `,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId
    ),
    30_000,
    "Оптимизация фото для PDF"
  );

  console.info("[diagnostic-pdf] printer-safe optimizations", result.result?.value ?? {});
}

async function readCdpStream(cdp: CdpClient, stream: string, sessionId: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const chunk = await withTimeout(
        cdp.send<CdpStreamReadResult>("IO.read", { handle: stream }, sessionId),
        CDP_STREAM_READ_TIMEOUT_MS,
        "Чтение PDF stream"
      );
      if (chunk.data) {
        chunks.push(Buffer.from(chunk.data, chunk.base64Encoded === false ? "utf8" : "base64"));
      }
      if (chunk.eof) break;
    }
  } finally {
    await withTimeout(cdp.send("IO.close", { handle: stream }, sessionId), 2_000, "Закрытие PDF stream").catch(() => {});
  }
  return Buffer.concat(chunks);
}

async function renderReportPdf(url: string, options: RenderReportPdfOptions = {}): Promise<Buffer> {
  const { pageRanges, printerSafe = true } = options;
  const chromePath = await findChromeExecutable();
  if (!chromePath) {
    console.error("[diagnostic-pdf] Chrome/Chromium executable not found", {
      candidates: [...new Set(CHROME_CANDIDATES)],
    });
    throw new Error("Chrome/Chromium не найден на сервере. Укажите CHROME_PATH для генерации PDF.");
  }

  const userDataDir = join(tmpdir(), `tgm-pdf-${randomUUID()}`);
  await mkdir(userDataDir, { recursive: true });
  console.info("[diagnostic-pdf] launching chrome", { chromePath, printerSafe, pageRanges: pageRanges ?? null });

  const chrome = spawn(chromePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-extensions",
    "--disable-sync",
    "--disable-software-rasterizer",
    "--disable-crash-reporter",
    "--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-first-run",
    "--force-color-profile=srgb",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ]);

  let cdp: CdpClient | null = null;
  try {
    const wsUrl = await waitForDevtools(chrome);
    cdp = await withTimeout(connectCdp(wsUrl), CDP_COMMAND_TIMEOUT_MS, "Подключение к Chrome DevTools");
    const created = await withTimeout(
      cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" }),
      CDP_COMMAND_TIMEOUT_MS,
      "Создание вкладки Chrome"
    );
    const attached = await withTimeout(
      cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: created.targetId, flatten: true }),
      CDP_COMMAND_TIMEOUT_MS,
      "Подключение к вкладке Chrome"
    );
    const sessionId = attached.sessionId;

    await withTimeout(cdp.send("Page.enable", {}, sessionId), CDP_COMMAND_TIMEOUT_MS, "Page.enable");
    await withTimeout(cdp.send("Runtime.enable", {}, sessionId), CDP_COMMAND_TIMEOUT_MS, "Runtime.enable");
    await withTimeout(cdp.send("Emulation.setEmulatedMedia", { media: "screen" }, sessionId), CDP_COMMAND_TIMEOUT_MS, "Emulation.setEmulatedMedia");
    await withTimeout(
      cdp.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: 1280,
          height: 1800,
          deviceScaleFactor: 1,
          mobile: false,
        },
        sessionId
      ),
      CDP_COMMAND_TIMEOUT_MS,
      "Emulation.setDeviceMetricsOverride"
    );
    await withTimeout(cdp.send("Page.navigate", { url }, sessionId), CDP_COMMAND_TIMEOUT_MS, "Переход на страницу отчёта");
    await waitForReportReady(cdp, sessionId);
    await withTimeout(
      cdp.send(
        "Runtime.evaluate",
        {
          expression: `
          (() => {
            const style = document.createElement('style');
            style.setAttribute('data-tgm-pdf-render', 'true');
            style.textContent = \`
              @page { size: A4; margin: 9mm 0 0; }
              @page:first { margin: 0; }
              html,
              body {
                width: 210mm !important;
                margin: 0 !important;
                padding: 0 !important;
                background: #fff !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .diag-print-toolbar,
              .no-print,
              nextjs-portal,
              script[data-nextjs-dev-overlay],
              [data-nextjs-toast],
              [data-nextjs-dev-overlay],
              [data-nextjs-dev-tools-button],
              [data-nextjs-dev-tools-panel] {
                display: none !important;
              }
              .diag-print-screen.is-print {
                width: 210mm !important;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                background: #fff !important;
              }
              .diag-print-screen.is-print .paper-a4.rep {
                width: 210mm !important;
                min-width: 210mm !important;
                max-width: 210mm !important;
                min-height: 297mm !important;
                margin: 0 !important;
                box-shadow: none !important;
                transform: none !important;
                zoom: 1 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .diag-print-screen.is-print .paper-a4.rep,
              .diag-print-screen.is-print .paper-a4.rep * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-sec,
              .diag-print-screen.is-print .paper-a4.rep .rep-recs,
              .diag-print-screen.is-print .paper-a4.rep .rep-photos,
              .diag-print-screen.is-print .paper-a4.rep .rep-check,
              .diag-print-screen.is-print .paper-a4.rep .rep-foot {
                break-before: auto !important;
                break-after: auto !important;
                break-inside: auto !important;
                page-break-before: auto !important;
                page-break-after: auto !important;
                page-break-inside: auto !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-sec {
                overflow: visible !important;
                orphans: 2 !important;
                widows: 2 !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-sec-head {
                break-after: avoid !important;
                page-break-after: avoid !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-check {
                display: grid !important;
                grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                gap: 12mm !important;
                columns: auto !important;
                column-gap: normal !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-check-col,
              .diag-print-screen.is-print .paper-a4.rep .rep-check-row,
              .diag-print-screen.is-print .paper-a4.rep .rep-check-label {
                min-width: 0 !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-check-val {
                flex: 0 1 auto !important;
                max-width: 38% !important;
                overflow-wrap: anywhere !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-rec,
              .diag-print-screen.is-print .paper-a4.rep .rep-photo,
              .diag-print-screen.is-print .paper-a4.rep .rep-block,
              .diag-print-screen.is-print .paper-a4.rep .rep-foot-cta,
              .diag-print-screen.is-print .paper-a4.rep .rep-sign-cell {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
              }
            \`;
            document.head.appendChild(style);
          })();
        `,
        },
        sessionId
      ),
      CDP_COMMAND_TIMEOUT_MS,
      "Подготовка CSS для PDF"
    );
    if (printerSafe) {
      await applyPrinterSafeOptimizations(cdp, sessionId);
    }
    await waitForFontsReady(cdp, sessionId);

    const pdf = await withTimeout(
      cdp.send<CdpPdfResult>(
        "Page.printToPDF",
        {
          printBackground: true,
          preferCSSPageSize: true,
          displayHeaderFooter: false,
          ...(pageRanges ? { pageRanges } : {}),
          paperWidth: 8.2677165354,
          paperHeight: 11.692913386,
          marginTop: 0,
          marginRight: 0,
          marginBottom: 0,
          marginLeft: 0,
          scale: 1,
        },
        sessionId
      ),
      CDP_PRINT_TIMEOUT_MS,
      "Печать отчёта в PDF"
    );

    if (pdf.data) {
      return Buffer.from(pdf.data, "base64");
    }
    if (pdf.stream) {
      return readCdpStream(cdp, pdf.stream, sessionId);
    }
    throw new Error("Chrome не вернул PDF-данные");
  } finally {
    cdp?.close();
    chrome.kill("SIGTERM");
    setTimeout(() => {
      void rm(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }).catch(() => {});
    }, 500);
  }
}

function isRetryablePdfError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /CDP connection closed|Target closed|WebSocket|DevTools|Chrome завершился|browser has disconnected/i.test(message);
}

async function renderReportPdfWithRetry(url: string, options: RenderReportPdfOptions = {}): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (attempt > 1) {
        console.warn("[diagnostic-pdf] retrying PDF render", { attempt, url, printerSafe: options.printerSafe });
      }
      return await renderReportPdf(url, options);
    } catch (error) {
      lastError = error;
      console.error("[diagnostic-pdf] render attempt failed", { attempt, error });
      if (!isRetryablePdfError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function requestOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.APP_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  return request.nextUrl.origin;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reportUrl = new URL(`/report/${encodeURIComponent(token)}/print?pdf=1`, requestOrigin(request));
  const pageRangesParam = request.nextUrl.searchParams.get("pages")?.trim();
  const pageRanges = pageRangesParam && /^[0-9,\-\s]+$/.test(pageRangesParam) ? pageRangesParam : undefined;
  const printerSafe = request.nextUrl.searchParams.get("rich") !== "1";

  try {
    const pdf = await renderReportPdfWithRetry(reportUrl.toString(), { pageRanges, printerSafe });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="tgm-diagnostic-${token}${printerSafe ? "-printer" : ""}.pdf"`,
        "Cache-Control": "no-store",
        "X-TGM-PDF-Mode": printerSafe ? "printer-safe" : "rich",
      },
    });
  } catch (error) {
    console.error("[diagnostic-pdf] failed", { token, error });
    return NextResponse.json(
      {
        error: "Не удалось сформировать PDF отчёта",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      }
    );
  }
}
