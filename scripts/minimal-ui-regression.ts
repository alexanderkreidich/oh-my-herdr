/**
 * The minimal chrome (docs/ROADMAP.md, Phase 1) in a real browser, on a herdr of its own: the bar
 * holds the sidebar toggle and the tabs as pills and nothing else; the sidebar lists workspaces
 * only; Ctrl+F opens the palette from the terminal; no pane opens a chat, even one that asked to;
 * the pane is drawn by restty (WebGPU, or WebGL2 where the browser has no WebGPU).
 *
 *   bun run build && bun run check run bun scripts/minimal-ui-regression.ts
 */
import "./test-herdr.ts"; // a herdr session of its own: nothing shows in the user's
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "../server/index.ts";
import { tabCreate, workspaceClose, workspaceCreate } from "../server/herdr/client.ts";
import { UsageService } from "../server/usage.ts";
import { chromePath } from "./chrome-path.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "restty-minimal-ui-")));
const cwd = join(root, "work");
mkdirSync(cwd);
const created = await workspaceCreate({ cwd, label: "minimal-ui" });
const workspaceId = created.workspace.workspace_id;
await tabCreate({ workspaceId, cwd });
const server = createServer({ port: 0, hostname: "127.0.0.1", token: "", stateDir: join(root, "state"), usage: new UsageService(undefined, []) });
const browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--accept-lang=en-US"] });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((paneId) => {
    localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
    // a lens remembered from before the fork: the pane still opens in its terminal
    localStorage.setItem(`herdr-web-ui:view:${paneId}`, "chat");
  }, created.root_pane.pane_id);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.locator(`.workspace-group[data-workspace="${workspaceId}"] .workspace-select`).click();
  const tabs = page.locator(".app-header .header-tabs [role=tab]");
  await tabs.nth(1).waitFor({ timeout: 20_000 });

  // the bar: the toggle and the tabs, nothing else
  for (const gone of [".header-more-button", ".view-switch", ".palette-button", ".header-files-button", ".context-title"]) {
    assert.equal(await page.locator(gone).count(), 0, `${gone} is gone from the bar`);
  }
  assert.equal(await tabs.count(), 2, "both tabs are pills in the bar");
  assert.equal(await page.locator(".app-header .header-tabs .tab-strip-icon").count(), 2, "each tab says what runs in it");
  assert.equal(await page.locator(".pane-column > .pane-split .tab-strip").count(), 0, "no second strip over the pane");
  const open = page.locator(".app-header [role=tab][aria-selected=true]");
  assert.notEqual(await open.evaluate((tab) => getComputedStyle(tab).backgroundColor), "rgba(0, 0, 0, 0)", "the open tab is a filled pill");

  // the sidebar: workspaces, no Agents list, no folder or favicon face
  assert.equal(await page.getByText("No agents running").count(), 0, "no Agents section");
  assert.equal(await page.locator(".agents-sidebar, .workspace-folder, .workspace-favicon").count(), 0, "no agents list or workspace face");

  // never a chat, even for a pane that remembered one
  assert.equal(await page.locator(".chat-view, .composer").count(), 0, "the pane shows its terminal");
  await page.locator(".restty-terminal canvas").first().waitFor({ state: "attached" });
  await page.locator(".terminal-ime").first().waitFor({ state: "attached" });
  // restty is up and has drawn the pane's first screen
  await page.waitForFunction(() => performance.getEntriesByName("restty:ready").length > 0 && performance.getEntriesByName("terminal:first-screen").length > 0, null, { timeout: 20_000 });
  const backend = await page.evaluate(() => (performance.getEntriesByName("restty:ready")[0] as PerformanceMark).detail?.backend);
  assert.ok(backend === "webgpu" || backend === "webgl2", `restty draws with WebGPU or WebGL2 (${String(backend)})`);

  // Ctrl+F from inside the terminal opens the palette, and the terminal does not get the key
  await page.locator(".terminal-ime").first().focus();
  await page.keyboard.press("Control+f");
  await page.locator(".palette-scrim").waitFor({ timeout: 5_000 });
  await page.keyboard.press("Escape");
  await page.locator(".palette-scrim").waitFor({ state: "detached", timeout: 5_000 });
  // the lens switch's old chord does nothing
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+J" : "Control+Shift+J");
  assert.equal(await page.locator(".chat-view, .composer").count(), 0, "Mod+Shift+J opens no chat");

  console.log("minimal-ui-regression: ok");
} finally {
  await browser.close();
  server.stop();
  await workspaceClose(workspaceId).catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
