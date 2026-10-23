/**
 * What the app does before it opens a window, in plain Node so that `bun test` runs it without
 * Electron: read the user's login-shell environment (an app opened from the Dock gets a bare
 * PATH), find herdr and start its server when none answers, and start the bridge bundled in the
 * app when no T-Rex answers on the port.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { accessSync, chmodSync, closeSync, constants, copyFileSync, createWriteStream, existsSync, mkdirSync, openSync, renameSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export type Env = Record<string, string | undefined>;

const ENV_MARK = "__T_REX_ENV__";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The environment a login shell printed after ENV_MARK (`env -0`); null when it printed none. */
export function parseEnv(output: string): Env | null {
  const at = output.indexOf(ENV_MARK);
  if (at < 0) return null;
  const env: Env = {};
  for (const entry of output.slice(at + ENV_MARK.length).split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env["PATH"] ? env : null;
}

/** This process's environment with the folders tools are usually installed in, for a shell that printed nothing. */
export function fallbackEnvironment(base: Env): Env {
  const home = base["HOME"] || homedir();
  const path = [base["PATH"] || "/usr/bin:/bin:/usr/sbin:/sbin", "/opt/homebrew/bin", "/usr/local/bin", join(home, ".local", "bin"), join(home, ".cargo", "bin")];
  return { ...base, PATH: path.join(delimiter) };
}

/** A UTF-8 locale when none is set, as a terminal gives its shells: herdr's panes inherit it. */
export function withLocale(env: Env): Env {
  return env["LANG"] || env["LC_ALL"] || env["LC_CTYPE"] ? env : { ...env, LANG: "en_US.UTF-8" };
}

/**
 * The environment a terminal would give: the login shell's, which herdr's panes and the bridge
 * expect. An rc file that waits for input or execs another program prints nothing in time: then
 * this process's environment, with the usual tool folders.
 */
export function loginEnvironment(base: Env = process.env, timeoutMs = 10_000): Promise<Env> {
  const shell = base["SHELL"] || "/bin/zsh";
  return new Promise((resolve) => {
    execFile(shell, ["-ilc", `printf '${ENV_MARK}'; command env -0`], { env: base, timeout: timeoutMs, maxBuffer: 8 << 20, encoding: "utf8" }, (_error, stdout) => {
      resolve(withLocale(parseEnv(stdout ?? "") ?? fallbackEnvironment(base)));
    });
  });
}

/** The first executable `name` on `path`, or null. */
export function which(name: string, path: string | undefined): string | null {
  for (const dir of (path ?? "").split(delimiter)) {
    if (!dir) continue;
    const file = join(dir, name);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch { /* not here */ }
  }
  return null;
}

/**
 * The herdr the app runs when the PC has none: the bundle's, copied once into the app's data
 * folder. `herdr update` (Settings) replaces the binary it runs, which must never be a file of the
 * app itself, and a daemon started from the copy is untouched when the app is replaced.
 */
export function ownHerdr(bundle: string, dataDir: string): string {
  const target = join(dataDir, "bin", "herdr");
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(bundle, "bin", "herdr"), `${target}.tmp`);
    chmodSync(`${target}.tmp`, 0o755);
    renameSync(`${target}.tmp`, target);
  }
  return target;
}

/** Where herdr listens: HERDR_SOCKET, else under XDG_CONFIG_HOME or ~/.config (as server/remote-entry.ts). */
export function herdrSocket(env: Env): string {
  return env["HERDR_SOCKET"] || join(env["XDG_CONFIG_HOME"] || join(env["HOME"] || homedir(), ".config"), "herdr", "herdr.sock");
}

/** Whether something listens on a unix socket: `absent` (no file) and `refused` (left by a dead daemon) are free to take. */
export function socketState(path: string, timeoutMs = 2000): Promise<"answers" | "absent" | "refused" | "unknown"> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const done = (state: "answers" | "absent" | "refused" | "unknown") => {
      clearTimeout(timer);
      socket.destroy();
      resolve(state);
    };
    const timer = setTimeout(() => done("unknown"), timeoutMs);
    socket.once("connect", () => done("answers"));
    socket.once("error", (error: NodeJS.ErrnoException) => done(error.code === "ENOENT" ? "absent" : error.code === "ECONNREFUSED" ? "refused" : "unknown"));
  });
}

/**
 * herdr's server, started when nothing listens on its socket. A socket that is there but does not
 * answer is the user's to look at, not a reason to start a second daemon over it
 * (server/remote-entry.ts). The daemon is detached: it owns every pane, so it outlives the app.
 */
export async function ensureHerdr(herdr: string, env: Env, log: string, timeoutMs = 30_000): Promise<void> {
  const socket = herdrSocket(env);
  const state = await socketState(socket);
  if (state === "answers") return;
  if (state === "unknown") throw new Error(`herdr's socket ${socket} is there but does not answer. Restart herdr, then open T-Rex again.`);
  mkdirSync(dirname(log), { recursive: true });
  const out = openSync(log, "a");
  const child = spawn(herdr, ["server"], { env, cwd: env["HOME"] || homedir(), detached: true, stdio: ["ignore", out, out] });
  closeSync(out);
  const ended: { why?: string } = {};
  child.once("error", (error) => { ended.why = error.message; });
  child.once("exit", (code) => { ended.why = `exited with ${code}`; });
  child.unref();
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
    if (await socketState(socket) === "answers") return;
    if (ended.why) throw new Error(`herdr (${herdr}) ${ended.why} before it answered; see ${log}`);
    await sleep(100);
  }
  throw new Error(`herdr (${herdr}) did not answer within ${timeoutMs / 1000}s; see ${log}`);
}

/** Whether a T-Rex bridge holds the port: its health answers without asking herdr (scripts/plugin.ts). */
export async function bridgeAnswers(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/api/health?scope=bridge`, { signal: AbortSignal.timeout(1500) });
    const body = await response.json() as { bridge_protocol?: unknown };
    return typeof body.bridge_protocol === "number";
  } catch {
    return false;
  }
}

/**
 * The bundled bridge (server/index.ts on the bundle's Bun) on loopback, with the bundle's bin/
 * first on its PATH so the PTY sidecar finds the bundle's Node. Resolves once its health answers;
 * rejects with the end of what it printed when it exits first (the port held by another app, say).
 */
export async function startBridge(options: { bundle: string; env: Env; herdr: string; port: number; log: string; timeoutMs?: number }): Promise<ChildProcess> {
  const { bundle, env, herdr, port, log } = options;
  mkdirSync(dirname(log), { recursive: true });
  const child = spawn(join(bundle, "bin", "bun"), [join(bundle, "server", "index.ts")], {
    cwd: bundle,
    env: {
      ...env, PATH: `${join(bundle, "bin")}${delimiter}${env["PATH"] ?? ""}`, HOST: "127.0.0.1", PORT: String(port),
      HERDR_SOCKET: herdrSocket(env), HERDR_WEB_HERDR_BIN: herdr, HERDR_WEB_DESKTOP: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const file = createWriteStream(log, { flags: "a" });
  let tail = "";
  const keep = (data: Buffer) => {
    file.write(data);
    tail = (tail + data.toString()).slice(-2000);
  };
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  const ended: { why?: string } = {};
  child.once("error", (error) => { ended.why = error.message; });
  child.once("exit", (code) => { ended.why = `exited with ${code}`; file.end(); });
  const origin = `http://127.0.0.1:${port}`;
  for (const deadline = Date.now() + (options.timeoutMs ?? 30_000); Date.now() < deadline;) {
    if (await bridgeAnswers(origin)) return child;
    if (ended.why) throw new Error(`The bridge ${ended.why} before it answered on ${origin}.\n\n${tail.trim()}`);
    await sleep(200);
  }
  child.kill("SIGTERM");
  throw new Error(`The bridge did not answer on ${origin} in time.\n\n${tail.trim()}`);
}
