import { randomUUID } from "crypto";
import { access, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import chromium from "@sparticuz/chromium";
import { NextRequest, NextResponse } from "next/server";
import { WebSocket } from "undici";
import { prisma } from "@/lib/db";

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

type ChromeExecutable = {
  path: string;
  source: "bundled" | "system";
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

type ImageReadinessResult = {
  imgCount: number;
  diagnosticPhotoCount: number;
  vehiclePhotoLoadStatus: "loaded" | "missing" | "empty" | "error" | "timeout";
  vehiclePhotoSrc: string | null;
  backgroundCount: number;
  totalImageCount: number;
  imgFailed: Array<{ src: string; reason: string; role?: string }>;
  backgroundFailed: Array<{ src: string; reason: string }>;
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

const CHROME_WRAPPER_CANDIDATES = [
  process.env.CHROME_WRAPPER,
  "/usr/bin/dbus-run-session",
  "dbus-run-session",
].filter(Boolean) as string[];

const CDP_COMMAND_TIMEOUT_MS = 15_000;
const CHROME_DEVTOOLS_TIMEOUT_MS = 30_000;
const CDP_PRINT_TIMEOUT_MS = 45_000;
const CDP_STREAM_READ_TIMEOUT_MS = 10_000;
const CHROME_OUTPUT_SNIPPET = 3_000;

async function prepareChromeRuntimeEnv(userDataDir: string): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("DBUS_")) delete env[key];
  }

  const runtimeDir = join(userDataDir, "runtime");
  const cacheDir = join(userDataDir, "cache");
  const configDir = join(userDataDir, "config");
  const crashDir = join(userDataDir, "crash-dumps");

  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await mkdir(cacheDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(crashDir, { recursive: true });

  return {
    ...env,
    HOME: userDataDir,
    TMPDIR: env.TMPDIR || tmpdir(),
    XDG_RUNTIME_DIR: runtimeDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: configDir,
    NO_AT_BRIDGE: "1",
    GTK_USE_PORTAL: "0",
  };
}

function chromeServerFlags(userDataDir: string, source: ChromeExecutable["source"] = "system"): string[] {
  const bundledArgs = source === "bundled"
    ? chromium.args.filter((arg) => !arg.startsWith("--disable-features=") && arg !== "--single-process")
    : [];
  const disabledFeatures = source === "bundled"
    ? "AudioServiceOutOfProcess,IsolateOrigins,site-per-process,Translate,BackForwardCache,MediaRouter,OptimizationHints"
    : "Translate,BackForwardCache,MediaRouter,OptimizationHints";

  return [
    ...bundledArgs,
    ...(source === "system" ? ["--headless=new"] : []),
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-extensions",
    "--disable-sync",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-accelerated-2d-canvas",
    `--disable-features=${disabledFeatures}`,
    "--hide-scrollbars",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-first-run",
    "--password-store=basic",
    "--force-color-profile=srgb",
    `--crash-dumps-dir=${join(userDataDir, "crash-dumps")}`,
    `--user-data-dir=${userDataDir}`,
  ];
}

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

async function findChromeExecutable(): Promise<ChromeExecutable | null> {
  if (process.platform === "linux") {
    try {
      const bundledPath = await chromium.executablePath();
      if (bundledPath) {
        return { path: bundledPath, source: "bundled" };
      }
    } catch (error) {
      console.warn("[diagnostic-pdf] bundled Chromium unavailable", { error });
    }
  }

  for (const candidate of [...new Set(CHROME_CANDIDATES)]) {
    try {
      await access(candidate);
      return { path: candidate, source: "system" };
    } catch {
      if (await canLaunchExecutable(candidate)) {
        return { path: candidate, source: "system" };
      }
    }
  }
  return null;
}

async function findChromeWrapperExecutable(): Promise<string | null> {
  for (const candidate of [...new Set(CHROME_WRAPPER_CANDIDATES)]) {
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

async function chromeSpawnConfig(chrome: ChromeExecutable, chromeArgs: string[]) {
  const wrapperPath = chrome.source === "system" ? await findChromeWrapperExecutable() : null;
  if (!wrapperPath) {
    return {
      command: chrome.path,
      args: chromeArgs,
      wrapperPath: null as string | null,
    };
  }

  return {
    command: wrapperPath,
    args: ["--", chrome.path, ...chromeArgs],
    wrapperPath,
  };
}

function waitForDevtools(chrome: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let chromeOutput = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Chrome DevTools endpoint не появился. ${chromeOutput.slice(-CHROME_OUTPUT_SNIPPET)}`));
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
      reject(new Error(`Chrome завершился до генерации PDF: code=${code ?? "null"} signal=${signal ?? "null"}. ${chromeOutput.slice(-CHROME_OUTPUT_SNIPPET)}`));
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

async function waitForImagesReady(cdp: CdpClient, sessionId: string): Promise<ImageReadinessResult> {
  const result = await withTimeout(
    cdp.send<{
      result?: {
        value?: ImageReadinessResult;
      };
    }>(
      "Runtime.evaluate",
      {
        expression: `
        (async () => {
          const root = document.querySelector('.diag-print-screen.is-print .paper-a4.rep') || document;
          const timeoutMs = 8000;
          const waitForUrl = (src) => new Promise((resolve) => {
            if (!src) {
              resolve({ src: '', ok: true, reason: 'empty' });
              return;
            }
            const image = new Image();
            let done = false;
            const finish = (ok, reason) => {
              if (done) return;
              done = true;
              resolve({ src, ok, reason });
            };
            const timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
            image.onload = () => {
              clearTimeout(timer);
              finish(Boolean(image.naturalWidth), image.naturalWidth ? 'loaded' : 'empty');
            };
            image.onerror = () => {
              clearTimeout(timer);
              finish(false, 'error');
            };
            image.src = src;
          });
          const imgNodes = Array.from(root.querySelectorAll('img'));
          const imgResults = await Promise.all(imgNodes.map((img) => {
            const src = img.currentSrc || img.src || '';
            const role = img.classList.contains('print-vehicle-photo')
              ? 'vehicle'
              : img.closest('.rep-photo-img')
                ? 'diagnostic'
                : 'inline';
            if (!src || (img.complete && img.naturalWidth > 0)) {
              return Promise.resolve({ src, ok: Boolean(src), reason: src ? 'loaded' : 'empty', role });
            }
            return new Promise((resolve) => {
              let done = false;
              const finish = (ok, reason) => {
                if (done) return;
                done = true;
                resolve({ src, ok, reason, role });
              };
              const timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
              img.addEventListener('load', () => {
                clearTimeout(timer);
                finish(Boolean(img.naturalWidth), img.naturalWidth ? 'loaded' : 'empty');
              }, { once: true });
              img.addEventListener('error', () => {
                clearTimeout(timer);
                finish(false, 'error');
              }, { once: true });
            });
          }));
          const backgroundUrls = [];
          const backgroundPattern = /url\\((['"]?)(.*?)\\1\\)/g;
          for (const node of Array.from(root.querySelectorAll('*'))) {
            const backgroundImage = getComputedStyle(node).backgroundImage || '';
            let match;
            while ((match = backgroundPattern.exec(backgroundImage))) {
              const src = match[2];
              if (src && !src.startsWith('data:')) backgroundUrls.push(src);
            }
          }
          const uniqueBackgroundUrls = Array.from(new Set(backgroundUrls));
          const backgroundResults = await Promise.all(uniqueBackgroundUrls.map(waitForUrl));
          const vehicleResult = imgResults.find((entry) => entry.role === 'vehicle') || null;
          return {
            imgCount: imgResults.length,
            diagnosticPhotoCount: imgResults.filter((entry) => entry.role === 'diagnostic').length,
            vehiclePhotoLoadStatus: vehicleResult ? vehicleResult.reason : 'missing',
            vehiclePhotoSrc: vehicleResult?.src ? vehicleResult.src.slice(0, 240) : null,
            totalImageCount: imgResults.length + backgroundResults.length,
            imgFailed: imgResults.filter((entry) => !entry.ok).map((entry) => ({ src: entry.src.slice(0, 240), reason: entry.reason, role: entry.role })),
            backgroundCount: backgroundResults.length,
            backgroundFailed: backgroundResults.filter((entry) => !entry.ok).map((entry) => ({ src: entry.src.slice(0, 240), reason: entry.reason })),
          };
        })()
      `,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId
    ),
    20_000,
    "Ожидание изображений"
  );

  const value = result.result?.value;
  if (value?.imgFailed.length || value?.backgroundFailed.length) {
    console.warn("[diagnostic-pdf] image readiness completed with fallbacks", value);
  } else {
    console.info("[diagnostic-pdf] images ready", value ?? {});
  }
  return value ?? {
    imgCount: 0,
    diagnosticPhotoCount: 0,
    vehiclePhotoLoadStatus: "missing",
    vehiclePhotoSrc: null,
    backgroundCount: 0,
    totalImageCount: 0,
    imgFailed: [],
    backgroundFailed: [],
  };
}

async function applyPrinterSafeOptimizations(cdp: CdpClient, sessionId: string): Promise<void> {
  const result = await withTimeout(
    cdp.send<{ result?: { value?: { photoTiles?: number; inlineImages?: number; vehicleHeroImages?: number } } }>(
      "Runtime.evaluate",
      {
        expression: `
        (() => {
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
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-hero,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-foot-cta {',
            '  color: #f5f2ed !important;',
            '  background: #0a0a0a !important;',
            '}',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-wordmark,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-title,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-fact .v,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-photo-cap .cap,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-photo-no,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-foot-q,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-foot-cta .tg {',
            '  color: #f5f2ed !important;',
            '}',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-hero-top,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-hero-meta,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-fact .k,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-fact .u,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-car-tag,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-photo-note,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-foot-sub,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-foot-cta .link {',
            '  color: #9a9a9a !important;',
            '}',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-title .muted2 {',
            '  color: #6e6e6e !important;',
            '}',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-eyebrow.rust,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-title .rust,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-photo-cap .lbl,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-foot-cta .ph {',
            '  color: #c2410c !important;',
            '}',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-fact,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-hero-car {',
            '  border-color: #2a2a2a !important;',
            '}',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep .rep-chequered {',
            '  background-color: #0a0a0a !important;',
            '  background-image: linear-gradient(45deg,#f5f2ed 25%,transparent 25%), linear-gradient(-45deg,#f5f2ed 25%,transparent 25%), linear-gradient(45deg,transparent 75%,#f5f2ed 75%), linear-gradient(-45deg,transparent 75%,#f5f2ed 75%) !important;',
            '  background-size: 9px 9px !important;',
            '  background-position: 0 0, 0 4.5px, 4.5px -4.5px, -4.5px 0 !important;',
            '}',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep,',
            'html.tgm-printer-safe .diag-print-screen.is-print .paper-a4.rep * {',
            '  -webkit-print-color-adjust: exact !important;',
            '  print-color-adjust: exact !important;',
            '}'
          ].join('\\n');
          document.head.appendChild(style);

          const imageNodes = Array.from(document.querySelectorAll(
            '.diag-print-screen.is-print .rep-photo-img img, .diag-print-screen.is-print .rep-rec-photos img'
          ));
          for (const imageNode of imageNodes) {
            imageNode.setAttribute('loading', 'eager');
            imageNode.setAttribute('decoding', 'sync');
          }

          return {
            photoTiles: document.querySelectorAll('.diag-print-screen.is-print .rep-photo-img').length,
            inlineImages: document.querySelectorAll('.diag-print-screen.is-print .rep-rec-photos img').length,
            vehicleHeroImages: document.querySelectorAll('.diag-print-screen.is-print .print-vehicle-photo').length,
          };
        })()
      `,
        returnByValue: true,
      },
      sessionId
    ),
    CDP_COMMAND_TIMEOUT_MS,
    "Подготовка печати PDF"
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
  const chrome = await findChromeExecutable();
  if (!chrome) {
    console.error("[diagnostic-pdf] Chrome/Chromium executable not found", {
      candidates: [...new Set(CHROME_CANDIDATES)],
    });
    throw new Error("Chrome/Chromium не найден на сервере. Укажите CHROME_PATH для генерации PDF.");
  }

  const userDataDir = join(tmpdir(), `tgm-pdf-${randomUUID()}`);
  await mkdir(userDataDir, { recursive: true });
  const chromeEnv = await prepareChromeRuntimeEnv(userDataDir);

  const chromeArgs = [
    ...chromeServerFlags(userDataDir, chrome.source),
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    "about:blank",
  ];
  const launch = await chromeSpawnConfig(chrome, chromeArgs);
  console.info("[diagnostic-pdf] launching chrome", { chromePath: chrome.path, chromeSource: chrome.source, wrapperPath: launch.wrapperPath, printerSafe, pageRanges: pageRanges ?? null });

  const chromeProcess = spawn(launch.command, launch.args, { env: chromeEnv });

  let cdp: CdpClient | null = null;
  try {
    const wsUrl = await waitForDevtools(chromeProcess);
    cdp = await withTimeout(connectCdp(wsUrl), CDP_COMMAND_TIMEOUT_MS, "Подключение к Chrome DevTools");
    const pageLoadStartedAt = Date.now();
    const created = await withTimeout(
      cdp.send<{ targetId: string }>("Target.createTarget", { url }),
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
    await withTimeout(cdp.send("Emulation.setEmulatedMedia", { media: "print" }, sessionId), CDP_COMMAND_TIMEOUT_MS, "Emulation.setEmulatedMedia");
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
    await waitForReportReady(cdp, sessionId);
    console.info("[diagnostic-pdf] page ready", { url, durationMs: Date.now() - pageLoadStartedAt });
    const cssStartedAt = Date.now();
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
              .diag-print-screen.is-print .paper-a4.rep .rep-hero,
              .diag-print-screen.is-print .paper-a4.rep .rep-foot-cta {
                color: #f5f2ed !important;
                background: #0a0a0a !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-wordmark,
              .diag-print-screen.is-print .paper-a4.rep .rep-title,
              .diag-print-screen.is-print .paper-a4.rep .rep-fact .v,
              .diag-print-screen.is-print .paper-a4.rep .rep-photo-cap .cap,
              .diag-print-screen.is-print .paper-a4.rep .rep-photo-no,
              .diag-print-screen.is-print .paper-a4.rep .rep-foot-q,
              .diag-print-screen.is-print .paper-a4.rep .rep-foot-cta .tg {
                color: #f5f2ed !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-hero-top,
              .diag-print-screen.is-print .paper-a4.rep .rep-hero-meta,
              .diag-print-screen.is-print .paper-a4.rep .rep-fact .k,
              .diag-print-screen.is-print .paper-a4.rep .rep-fact .u,
              .diag-print-screen.is-print .paper-a4.rep .rep-car-tag,
              .diag-print-screen.is-print .paper-a4.rep .rep-photo-note,
              .diag-print-screen.is-print .paper-a4.rep .rep-foot-sub,
              .diag-print-screen.is-print .paper-a4.rep .rep-foot-cta .link {
                color: #9a9a9a !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-title .muted2 {
                color: #6e6e6e !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-eyebrow.rust,
              .diag-print-screen.is-print .paper-a4.rep .rep-title .rust,
              .diag-print-screen.is-print .paper-a4.rep .rep-photo-cap .lbl,
              .diag-print-screen.is-print .paper-a4.rep .rep-foot-cta .ph {
                color: #c2410c !important;
              }
              .diag-print-screen.is-print .paper-a4.rep .rep-fact,
              .diag-print-screen.is-print .paper-a4.rep .rep-hero-car {
                border-color: #2a2a2a !important;
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
    console.info("[diagnostic-pdf] render CSS prepared", { durationMs: Date.now() - cssStartedAt });
    if (printerSafe) {
      const printerSafeStartedAt = Date.now();
      await applyPrinterSafeOptimizations(cdp, sessionId);
      console.info("[diagnostic-pdf] printer-safe CSS prepared", { durationMs: Date.now() - printerSafeStartedAt });
    }
    const fontsStartedAt = Date.now();
    await waitForFontsReady(cdp, sessionId);
    console.info("[diagnostic-pdf] fonts ready", { durationMs: Date.now() - fontsStartedAt });
    const imagesStartedAt = Date.now();
    const imageReadiness = await waitForImagesReady(cdp, sessionId);
    console.info("[diagnostic-pdf] image wait completed", {
      durationMs: Date.now() - imagesStartedAt,
      ...imageReadiness,
    });

    const printStartedAt = Date.now();
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
    console.info("[diagnostic-pdf] print command completed", { durationMs: Date.now() - printStartedAt });

    if (pdf.data) {
      return Buffer.from(pdf.data, "base64");
    }
    if (pdf.stream) {
      return readCdpStream(cdp, pdf.stream, sessionId);
    }
    throw new Error("Chrome не вернул PDF-данные");
  } finally {
    cdp?.close();
    chromeProcess.kill("SIGTERM");
    setTimeout(() => {
      void rm(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }).catch(() => {});
    }, 500);
  }
}

function isRetryablePdfError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /CDP connection closed|Target closed|WebSocket|DevTools|Chrome завершился|browser has disconnected|таймаут|timeout/i.test(message);
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
  const pdfJobId = randomUUID();
  const startedAt = Date.now();
  const reportUrl = new URL(`/report/${encodeURIComponent(token)}/print?pdf=1`, requestOrigin(request));
  const pageRangesParam = request.nextUrl.searchParams.get("pages")?.trim();
  const pageRanges = pageRangesParam && /^[0-9,\-\s]+$/.test(pageRangesParam) ? pageRangesParam : undefined;
  const printerSafe = request.nextUrl.searchParams.get("rich") !== "1";

  const pdfMode = printerSafe ? "printer-safe" : "rich";
  const [diagnosticMeta, diagnosticPhotoCount] = await Promise.all([
    prisma.diagnosticMapSession.findUnique({
      where: { publicToken: token },
      select: {
        id: true,
        vehiclePhoto: {
          select: {
            id: true,
            contentType: true,
            sizeBytes: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.diagnosticMapPhoto.count({
      where: { item: { session: { publicToken: token } } },
    }),
  ]).catch((error) => {
    console.warn("[diagnostic-pdf] meta lookup failed", { pdfJobId, reportToken: token, error });
    return [null, null] as const;
  });

  console.info("[diagnostic-pdf] job started", {
    pdfJobId,
    reportToken: token,
    diagnosticId: diagnosticMeta?.id ?? null,
    vehiclePhotoId: diagnosticMeta?.vehiclePhoto?.id ?? null,
    vehiclePhotoVariant: "printHero",
    vehiclePhotoOriginalSize: diagnosticMeta?.vehiclePhoto?.sizeBytes ?? null,
    vehiclePhotoContentType: diagnosticMeta?.vehiclePhoto?.contentType ?? null,
    diagnosticPhotoCount,
    pdfMode,
  });

  try {
    const pdf = await renderReportPdfWithRetry(reportUrl.toString(), { pageRanges, printerSafe });
    console.info("[diagnostic-pdf] job completed", {
      pdfJobId,
      reportToken: token,
      diagnosticId: diagnosticMeta?.id ?? null,
      renderDurationMs: Date.now() - startedAt,
      pdfSizeBytes: pdf.byteLength,
      status: "ok",
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="tgm-diagnostic-${token}${printerSafe ? "-printer" : ""}.pdf"`,
        "Cache-Control": "no-store",
        "X-TGM-PDF-Mode": pdfMode,
      },
    });
  } catch (error) {
    console.error("[diagnostic-pdf] failed", {
      pdfJobId,
      reportToken: token,
      diagnosticId: diagnosticMeta?.id ?? null,
      vehiclePhotoId: diagnosticMeta?.vehiclePhoto?.id ?? null,
      renderDurationMs: Date.now() - startedAt,
      status: "failed",
      error,
    });
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
