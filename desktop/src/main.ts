/**
 * T-Rex for the Mac: one window on the bridge at 127.0.0.1:7317. A T-Rex that already serves there
 * (the herdr plugin, `bun run start`) is used as it is. Otherwise the app starts herdr when it is
 * not running and the bridge bundled inside it, and stops that bridge when it quits; herdr keeps
 * running, as it owns every pane.
 */
import { app, BrowserWindow, dialog, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import { DEFAULT_PORT } from "../../shared/protocol.ts";
import { bridgeAnswers, ensureHerdr, loginEnvironment, ownHerdr, startBridge, which } from "./bridge.ts";

// T_REX_PORT points a development run at another bridge: the sandbox's 7417 (docs/desktop.md)
const port = Number(process.env["T_REX_PORT"]) || DEFAULT_PORT;
const origin = `http://127.0.0.1:${port}`;
let bridge: ChildProcess | null = null;
let started = false;

function openOutside(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

function openWindow(): void {
  const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 480, minHeight: 360, show: false, title: "T-Rex", webPreferences: { spellcheck: false } });
  window.once("ready-to-show", () => window.show());
  // links open in the browser; the window stays on the bridge
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === origin) return;
    event.preventDefault();
    openOutside(url);
  });
  void window.loadURL(origin);
}

async function start(): Promise<void> {
  if (!(await bridgeAnswers(origin))) {
    const env = await loginEnvironment();
    // packaged: Contents/Resources/bridge; a development run: what `bun run bridge` staged
    const bundle = app.isPackaged ? join(process.resourcesPath, "bridge") : join(app.getAppPath(), "bundle");
    const logs = app.getPath("logs");
    const herdr = which("herdr", env["PATH"]) ?? ownHerdr(bundle, app.getPath("userData"));
    await ensureHerdr(herdr, env, join(logs, "herdr.log"));
    bridge = await startBridge({ bundle, env, herdr, port, log: join(logs, "bridge.log") });
  }
  started = true;
  openWindow();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  // a Mac app outlives its last window: the Dock icon opens a new one
  app.on("window-all-closed", () => {});
  app.on("activate", () => {
    if (started && BrowserWindow.getAllWindows().length === 0) openWindow();
  });
  app.on("will-quit", () => {
    bridge?.kill("SIGTERM");
  });
  app.whenReady().then(start).catch((error: unknown) => {
    dialog.showErrorBox("T-Rex could not start", error instanceof Error ? error.message : String(error));
    app.quit();
  });
}
