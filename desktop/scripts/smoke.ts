/**
 * Opens the packaged app as a user would and checks what it did: herdr and the bridge answer on
 * 127.0.0.1:7317 and the bridge can attach terminals (the bundle's Node and node-pty run), the
 * window shows T-Rex from there, and quitting stops the bridge while herdr keeps running.
 * Written for CI's disposable Mac: on a Mac of your own it starts your herdr when it is not running.
 * T_REX_PORT, which the app reads too, moves it off a port another bridge holds.
 *
 *   bun scripts/smoke.ts dist/mac-arm64/T-Rex.app
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { herdrSocket, socketState } from "../src/bridge.ts";

const app = resolve(process.argv[2] ?? "");
const executable = join(app, "Contents", "MacOS", "T-Rex");
if (!existsSync(executable)) throw new Error(`No app at ${app}; usage: bun scripts/smoke.ts <path to T-Rex.app>`);
const origin = `http://127.0.0.1:${Number(process.env["T_REX_PORT"]) || 7317}`;
const DEBUG_PORT = 9339;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function json(url: string): Promise<any> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return await response.json();
  } catch {
    return null;
  }
}

async function until<T>(what: string, check: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
    const found = await check();
    if (found !== null) return found;
    await sleep(250);
  }
  throw new Error(`Timed out waiting until ${what}`);
}

if (await json(`${origin}/api/health?scope=bridge`)) throw new Error(`Something already answers on ${origin}: the smoke needs the port free`);
const child = spawn(executable, [`--remote-debugging-port=${DEBUG_PORT}`], { stdio: "inherit" });
try {
  const health = await until("herdr and the bridge answer", async () => {
    const body = await json(`${origin}/api/health`);
    return body?.ok && body.herdr?.version ? body : null;
  }, 90_000);
  console.log(`bridge answers: herdr ${health.herdr.version}, terminal attach ${health.herdr.terminal_attach}`);
  if (health.herdr.terminal_attach !== true) throw new Error("The bridge cannot attach terminals: the bundle's Node or node-pty did not run");
  const page = await until("the window shows T-Rex", async () => {
    const targets = await json(`http://127.0.0.1:${DEBUG_PORT}/json/list`) as { type: string; url: string; title: string }[] | null;
    return targets?.find((target) => target.type === "page" && target.url.startsWith(origin) && target.title.endsWith("T-Rex")) ?? null;
  }, 60_000);
  console.log(`window: "${page.title}" at ${page.url}`);
} finally {
  child.kill("SIGTERM");
}
await until("the bridge stops with the app", async () => (await json(`${origin}/api/health?scope=bridge`)) ? null : true, 20_000);
console.log("the bridge stopped with the app");
if (await socketState(herdrSocket(process.env)) !== "answers") throw new Error("herdr stopped with the app: it must keep the panes running");
// herdr outlives the app by design; this disposable run stops the one it started
const herdr = join(homedir(), "Library", "Application Support", "T-Rex", "bin", "herdr");
if (existsSync(herdr)) spawnSync(herdr, ["server", "stop"], { stdio: "inherit" });
