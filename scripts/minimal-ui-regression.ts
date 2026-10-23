/**
 * The minimal chrome (docs/ROADMAP.md, Phase 1) in a real browser, on a herdr of its own: the bar
 * holds the sidebar toggle and the tabs as pills and nothing else; the sidebar lists workspaces
 * only, under its top row's PC switcher and +; Ctrl+F opens the palette from the terminal; no pane opens a chat, even one that asked to;
 * the pane is drawn by restty (WebGPU, or WebGL2 where the browser has no WebGPU). Focus mode
 * (Mod+Shift+.) moves the tabs under their workspace, and a hidden sidebar hands them back to the bar.
 * The top row's + makes a workspace at once, a shell in the PC's home, with no dialog.
 * Each pane is a rounded card whose title bar carries Split right, Split down, Zoom and Close; a
 * card dragged by its title onto another of its tab trades places with it in herdr.
 *
 *   bun run build && bun run check run bun scripts/minimal-ui-regression.ts
 */
import "./test-herdr.ts"; // a herdr session of its own: nothing shows in the user's
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
let madeId: string | null = null;

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

  // its top row: the PC switcher, and the + for a new workspace at the row's far edge; no PC header over the list
  const side = page.locator(".app-header .header-side");
  const switcher = side.locator(".pc-switch");
  const plus = side.locator(".pc-new");
  await switcher.waitFor();
  assert.equal(await page.locator(".sidebar .pc-switch, .machine-header").count(), 0, "no PC header or second switcher in the list");
  const [sideBox, plusBox] = [await side.boundingBox(), await plus.boundingBox()];
  assert.ok(sideBox && plusBox && sideBox.x + sideBox.width - (plusBox.x + plusBox.width) <= 16, `the + ends the top row: ${JSON.stringify({ sideBox, plusBox })}`);
  await switcher.click();
  const pcs = page.getByRole("menu", { name: "PCs", exact: true });
  await pcs.waitFor();
  assert.equal(await pcs.locator('[aria-current="true"]').count(), 1, "the PC on screen is the menu's current item");
  await pcs.getByRole("menuitem", { name: "Add PC", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await pcs.waitFor({ state: "detached" });

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

  // focus mode (Mod+Shift+.): the tabs are rows under their workspace and the bar over the pane goes
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const rows = page.locator(`.workspace-group[data-workspace="${workspaceId}"] .workspace-tab-select`);
  await page.keyboard.press(`${mod}+Shift+Period`);
  await rows.nth(1).waitFor({ timeout: 5_000 });
  assert.equal(await tabs.count(), 0, "no pills in the bar in focus mode");
  assert.equal(await rows.count(), 2, "both tabs are rows under their workspace");
  assert.equal(await page.locator(".pane-column").evaluate((column) => Math.round(column.getBoundingClientRect().top)), 0, "the pane runs to the window's top");
  assert.equal(await page.locator(".app-header .sidebar-toggle").count(), 1, "the sidebar toggle stays, in the sidebar's top row");
  assert.equal(await page.locator(".app-header .header-side .pc-switch").count(), 1, "the PC switcher stays in that row too");
  await rows.nth(1).click();
  await page.locator(`.workspace-group[data-workspace="${workspaceId}"] .workspace-tab.is-selected .workspace-tab-select`).nth(0).waitFor();
  assert.equal(await rows.nth(1).getAttribute("aria-current"), "true", "a row opens its tab's pane");
  // a hidden sidebar hands the tabs back to the bar, and showing it takes them again
  await page.keyboard.press(`${mod}+Shift+B`);
  await tabs.nth(1).waitFor({ timeout: 5_000 });
  assert.equal(await page.locator(".app-header [role=tab][aria-selected=true] .tab-strip-label").textContent(), await rows.nth(1).locator(".workspace-tab-name").textContent(), "the bar opens on the same tab");
  await page.keyboard.press(`${mod}+Shift+B`);
  await tabs.first().waitFor({ state: "detached", timeout: 5_000 });
  // and the same chord leaves focus mode
  await page.keyboard.press(`${mod}+Shift+Period`);
  await tabs.nth(1).waitFor({ timeout: 5_000 });
  assert.equal(await page.locator(".workspace-tab").count(), 0, "no tab rows outside focus mode");

  // the pane is a card, its title bar says what runs in it and carries the pane's actions
  const card = page.locator(".pane-frame[data-layout-pane]:not(.is-hidden)").first();
  assert.notEqual(await card.evaluate((frame) => getComputedStyle(frame).borderTopLeftRadius), "0px", "the pane is a rounded card");
  const actions = card.locator(".pane-frame-actions button");
  assert.deepEqual(await actions.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    ["Split right", "Split down", "Zoom pane", "Close pane"], "the title bar carries the pane's actions");
  assert.equal(await actions.nth(2).isDisabled(), true, "a lone pane has nothing to zoom");
  // Split right from the title bar; then the left card, dragged by its title onto the right one, trades places with it in herdr
  await card.getByRole("button", { name: "Split right" }).click();
  const cards = page.locator(".pane-frame[data-layout-pane]:not(.is-hidden)");
  await cards.nth(1).waitFor({ timeout: 10_000 });
  const [left, right] = await cards.evaluateAll((frames) => frames.map((frame) => (frame as HTMLElement).dataset["layoutPane"]!));
  const columns = async (): Promise<Map<string, number>> => {
    const session = await page.evaluate(async () => (await (await fetch("/api/session")).json()).snapshot) as { layouts: { panes: { pane_id: string; rect: { x: number } }[] }[] };
    return new Map(session.layouts.flatMap((layout) => layout.panes.map((pane) => [pane.pane_id, pane.rect.x] as const)));
  };
  const split = await columns();
  assert.ok(split.get(left!)! < split.get(right!)!, "the new pane is on the right");
  const title = (await cards.nth(0).locator(".pane-frame-head").boundingBox())!;
  const drop = (await cards.nth(1).boundingBox())!;
  await page.mouse.move(title.x + 40, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 8 });
  await page.mouse.up();
  let swapped = await columns();
  for (const deadline = Date.now() + 5_000; Date.now() < deadline && swapped.get(left!) === split.get(left!);) {
    await page.waitForTimeout(100);
    swapped = await columns();
  }
  assert.equal(swapped.get(left!), split.get(right!), "the dragged pane took the other's place");
  assert.equal(swapped.get(right!), split.get(left!), "and the other took its place");

  // the top row's + makes a workspace at once and opens it: a shell in home, no dialog asking for an agent or a folder
  const known = await page.locator(".workspace-group[data-workspace]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-workspace")));
  await plus.click();
  const made = page.locator(".workspace-group.is-selected[data-workspace]");
  await page.waitForFunction((ids) => {
    const id = document.querySelector(".workspace-group.is-selected[data-workspace]")?.getAttribute("data-workspace");
    return id != null && !ids.includes(id);
  }, known, { timeout: 20_000 });
  madeId = await made.getAttribute("data-workspace");
  assert.equal(await page.locator("[role=dialog]").count(), 0, "no dialog opens");
  const snapshot = await page.evaluate(async () => (await (await fetch("/api/session")).json()).snapshot) as { panes: { workspace_id: string; cwd?: string | null; agent?: string | null }[] };
  const madePanes = snapshot.panes.filter((pane) => pane.workspace_id === madeId);
  assert.equal(madePanes.length, 1, "one pane in the new workspace");
  assert.equal(madePanes[0]!.cwd, homedir(), "its shell starts in home");
  assert.equal(madePanes[0]!.agent ?? null, null, "no agent starts in it");

  console.log("minimal-ui-regression: ok");
} finally {
  await browser.close();
  server.stop();
  await workspaceClose(workspaceId).catch(() => {});
  if (madeId !== null) await workspaceClose(madeId).catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
