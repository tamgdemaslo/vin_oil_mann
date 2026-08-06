import { randomUUID } from "crypto";
import { access, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { WebSocket } from "undici";

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

type CdpClient = {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
  close(): void;
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
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/System/Volumes/Data/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "google-chrome-stable",
  "google-chrome",
  "chromium-browser",
  "chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean) as string[];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: таймаут ${Math.round(timeoutMs / 1000)} сек.`)), timeoutMs);
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
      if (await canLaunchExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function waitForDevtools(chrome: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Chrome DevTools endpoint не появился. ${output.slice(-800)}`));
    }, 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(match[1]);
    };
    chrome.stderr.on("data", onData);
    chrome.stdout.on("data", onData);
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
      reject(new Error(`Chrome завершился до генерации PDF: code=${code ?? "null"} signal=${signal ?? "null"}. ${output.slice(-800)}`));
    });
  });
}

function connectCdp(wsUrl: string): Promise<CdpClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    const cleanup = () => {
      for (const waiter of pending.values()) waiter.reject(new Error("CDP connection closed"));
      pending.clear();
    };
    socket.addEventListener("open", () => {
      resolve({
        send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
          const id = nextId++;
          return new Promise<T>((done, fail) => {
            pending.set(id, { resolve: (value) => done(value as T), reject: fail });
            socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
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
      if (data.error) waiter.reject(new Error(data.error.message ?? "CDP error"));
      else waiter.resolve(data.result ?? {});
    });
    socket.addEventListener("error", () => {
      cleanup();
      reject(new Error("Не удалось подключиться к Chrome DevTools"));
    });
    socket.addEventListener("close", cleanup);
  });
}

async function readCdpStream(cdp: CdpClient, stream: string, sessionId: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const chunk = await withTimeout(cdp.send<CdpStreamReadResult>("IO.read", { handle: stream }, sessionId), 10_000, "Чтение PDF stream");
      if (chunk.data) chunks.push(Buffer.from(chunk.data, chunk.base64Encoded === false ? "utf8" : "base64"));
      if (chunk.eof) break;
    }
  } finally {
    await withTimeout(cdp.send("IO.close", { handle: stream }, sessionId), 2_000, "Закрытие PDF stream").catch(() => {});
  }
  return Buffer.concat(chunks);
}

async function waitForSelector(cdp: CdpClient, sessionId: string, selector: string): Promise<void> {
  const deadline = Date.now() + 45_000;
  let lastText = "";
  while (Date.now() < deadline) {
    const result = await withTimeout(
      cdp.send<{ result?: { value?: { ready: boolean; text: string } } }>(
        "Runtime.evaluate",
        {
          expression: `(() => ({ ready: Boolean(document.querySelector(${JSON.stringify(selector)})), text: document.body?.innerText?.replace(/\\s+/g, ' ').slice(0, 300) || '' }))()`,
          returnByValue: true,
        },
        sessionId
      ),
      15_000,
      "Ожидание готовности страницы"
    );
    if (result.result?.value?.ready) return;
    lastText = result.result?.value?.text ?? lastText;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Страница не подготовила документ для PDF. ${lastText}`);
}

async function waitForFonts(cdp: CdpClient, sessionId: string): Promise<void> {
  await withTimeout(
    cdp.send(
      "Runtime.evaluate",
      {
        expression: `(async () => { if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))]); return true; })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId
    ),
    15_000,
    "Ожидание шрифтов"
  );
}

async function renderPdfUrl(url: string, readySelector: string): Promise<Buffer> {
  const chromePath = await findChromeExecutable();
  if (!chromePath) throw new Error("Chrome/Chromium не найден на сервере. Укажите CHROME_PATH для генерации PDF.");

  const userDataDir = join(tmpdir(), `tgm-pdf-${randomUUID()}`);
  await mkdir(userDataDir, { recursive: true });
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-extensions",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    "--force-color-profile=srgb",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ]);

  let cdp: CdpClient | null = null;
  try {
    const wsUrl = await waitForDevtools(chrome);
    cdp = await withTimeout(connectCdp(wsUrl), 15_000, "Подключение к Chrome DevTools");
    const created = await withTimeout(cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" }), 15_000, "Создание вкладки");
    const attached = await withTimeout(cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: created.targetId, flatten: true }), 15_000, "Подключение к вкладке");
    const sessionId = attached.sessionId;
    await withTimeout(cdp.send("Page.enable", {}, sessionId), 15_000, "Page.enable");
    await withTimeout(cdp.send("Runtime.enable", {}, sessionId), 15_000, "Runtime.enable");
    await withTimeout(cdp.send("Emulation.setEmulatedMedia", { media: "print" }, sessionId), 15_000, "Печатный media");
    await withTimeout(cdp.send("Page.navigate", { url }, sessionId), 15_000, "Переход на страницу");
    await waitForSelector(cdp, sessionId, readySelector);
    await waitForFonts(cdp, sessionId);

    const pdf = await withTimeout(
      cdp.send<CdpPdfResult>(
        "Page.printToPDF",
        {
          printBackground: true,
          preferCSSPageSize: true,
          displayHeaderFooter: false,
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
      45_000,
      "Печать PDF"
    );
    if (pdf.data) return Buffer.from(pdf.data, "base64");
    if (pdf.stream) return readCdpStream(cdp, pdf.stream, sessionId);
    throw new Error("Chrome не вернул PDF-данные");
  } finally {
    cdp?.close();
    chrome.kill("SIGTERM");
    setTimeout(() => {
      void rm(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }).catch(() => {});
    }, 500);
  }
}

export async function renderPagePdf(url: string, readySelector: string): Promise<Buffer> {
  return renderPdfUrl(url, readySelector);
}

/** Renders a self-contained print document without routing through the app shell. */
export async function renderHtmlPdf(html: string, readySelector: string): Promise<Buffer> {
  const url = `data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}`;
  return renderPdfUrl(url, readySelector);
}

export function requestOriginFromHeaders(headers: Headers, fallbackOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.APP_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");
  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return fallbackOrigin;
}
