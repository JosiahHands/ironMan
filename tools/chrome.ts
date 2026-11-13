// chrome: start a hidden (headless) Google Chrome and control it from Node.
// Used by tools/fetch-media.ts (searching) and tests/check-pages.ts (testing the site).
//
// It talks to Chrome with the Chrome DevTools Protocol, which is built into Chrome,
// so no extra packages are needed.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// profileDir keeps Chrome's cookies etc. between runs
export async function openBrowser(profileDir: string, width = 1366, height = 900) {
  fs.mkdirSync(profileDir, { recursive: true });
  const portFile = path.join(profileDir, "DevToolsActivePort");
  fs.rmSync(portFile, { force: true });

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--remote-debugging-port=0", // 0 = Chrome picks a free port and writes it to portFile
      "--autoplay-policy=no-user-gesture-required",
      `--window-size=${width},${height}`,
      `--user-data-dir=${profileDir}`,
      `--user-agent=${USER_AGENT}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  // Wait for Chrome to say which port it is listening on
  let port = "";
  for (let i = 0; i < 40 && !port; i++) {
    await wait(250);
    if (fs.existsSync(portFile)) port = fs.readFileSync(portFile, "utf8").split("\n")[0] ?? "";
  }
  if (!port) throw new Error("Chrome did not start");

  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[];
  const page = targets.find((t) => t.type === "page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => (socket.onopen = resolve));

  // Send a DevTools command and wait for its answer; also pass on events (console logs etc.)
  let nextId = 0;
  const waiting: Record<number, (msg: any) => void> = {};
  const eventHandlers: Record<string, ((params: any) => void)[]> = {};
  socket.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && waiting[msg.id]) waiting[msg.id]!(msg);
    if (msg.method) eventHandlers[msg.method]?.forEach((handler) => handler(msg.params));
  };
  const send = (method: string, params = {}) =>
    new Promise<any>((resolve) => {
      const id = ++nextId;
      waiting[id] = resolve;
      socket.send(JSON.stringify({ id, method, params }));
    });

  // Run JavaScript inside the page and return the result
  const evaluate = async (expression: string) => {
    const msg = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (msg.result?.exceptionDetails) throw new Error(msg.result.exceptionDetails.text);
    return msg.result?.result?.value;
  };

  // Keep checking a condition in the page until it is true
  const waitFor = async (expression: string, seconds = 30) => {
    for (let i = 0; i < seconds * 2; i++) {
      if (await evaluate(expression).catch(() => false)) return;
      await wait(500);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };

  return {
    send,
    evaluate,
    waitFor,
    goTo: (url: string) => send("Page.navigate", { url }),
    on: (method: string, handler: (params: any) => void) => {
      (eventHandlers[method] ??= []).push(handler);
    },
    // Change the page size (width/height in CSS pixels), e.g. to test a phone screen
    setViewport: (width: number, height: number, mobile = false) =>
      send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }),
    // Save what the page looks like right now as a .png
    screenshot: async (filePath: string) => {
      const msg = await send("Page.captureScreenshot", { format: "png" });
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, Buffer.from(msg.result.data, "base64"));
    },
    // A real mouse click at a point on the screen
    click: async (x: number, y: number) => {
      const base = { x, y, button: "left", clickCount: 1 };
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
      await send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
    },
    moveMouse: (x: number, y: number) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }),
    pressKey: async (key: string, code: string, keyCode: number) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    },
    close: () => {
      socket.close();
      chrome.kill();
    },
  };
}

export type Browser = Awaited<ReturnType<typeof openBrowser>>;
