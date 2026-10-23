import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { ensureHerdr, herdrSocket, loginEnvironment, ownHerdr, parseEnv, socketState, startBridge, which, withLocale } from "./bridge.ts";

// under /tmp: a unix socket's path must stay under 104 bytes, and macOS's TMPDIR is long
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync("/tmp/t-rex-desktop-");
  dirs.push(dir);
  return dir;
};
const script = (path: string, body: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};
const children: number[] = [];
afterEach(() => {
  for (const pid of children.splice(0)) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the login shell's environment", () => {
  it("reads what follows the mark, past what rc files print", () => {
    const env = parseEnv("Welcome back!\n__T_REX_ENV__PATH=/opt/homebrew/bin:/usr/bin\0EQ=a=b\0LINES=one\ntwo\0");
    expect(env).toEqual({ PATH: "/opt/homebrew/bin:/usr/bin", EQ: "a=b", LINES: "one\ntwo" });
  });

  it("is nothing without the mark or a PATH", () => {
    expect(parseEnv("PATH=/usr/bin\0")).toBeNull();
    expect(parseEnv("__T_REX_ENV__HOME=/Users/me\0")).toBeNull();
  });

  it("comes from the user's shell, with a UTF-8 locale when it sets none", async () => {
    const shell = script(join(temp(), "shell"), `echo "motd"; printf '__T_REX_ENV__PATH=/from/rc\\0HOME=/Users/me\\0'`);
    expect(await loginEnvironment({ SHELL: shell, PATH: "/usr/bin" })).toEqual({ PATH: "/from/rc", HOME: "/Users/me", LANG: "en_US.UTF-8" });
  });

  it("falls back to this process's with the usual tool folders when the shell prints nothing in time", async () => {
    const shell = script(join(temp(), "shell"), "sleep 5");
    const env = await loginEnvironment({ SHELL: shell, PATH: "/usr/bin", HOME: "/Users/me", LC_ALL: "C.UTF-8" }, 200);
    expect(env["PATH"]!.split(":")).toEqual(["/usr/bin", "/opt/homebrew/bin", "/usr/local/bin", "/Users/me/.local/bin", "/Users/me/.cargo/bin"]);
    expect(env["LANG"]).toBeUndefined();
  });

  it("keeps a locale the user set", () => {
    expect(withLocale({ LANG: "ru_RU.UTF-8" })).toEqual({ LANG: "ru_RU.UTF-8" });
    expect(withLocale({ LC_CTYPE: "UTF-8" })).toEqual({ LC_CTYPE: "UTF-8" });
  });
});

describe("herdr", () => {
  it("is the first executable on PATH", () => {
    const dir = temp();
    mkdirSync(join(dir, "plain"));
    writeFileSync(join(dir, "plain", "herdr"), "not executable");
    const found = script(join(dir, "bin", "herdr"), "exit 0");
    script(join(dir, "later", "herdr"), "exit 0");
    expect(which("herdr", ["", join(dir, "missing"), join(dir, "plain"), join(dir, "bin"), join(dir, "later")].join(":"))).toBe(found);
    expect(which("herdr", join(dir, "plain"))).toBeNull();
  });

  it("is the bundle's, copied out of the app once and kept after that", () => {
    const bundle = temp(), data = temp();
    script(join(bundle, "bin", "herdr"), "echo bundled");
    const own = ownHerdr(bundle, data);
    expect(own).toBe(join(data, "bin", "herdr"));
    expect(readFileSync(own, "utf8")).toContain("echo bundled");
    // `herdr update` replaced the copy: a later start must not put the bundled one back
    writeFileSync(own, "#!/bin/sh\necho updated\n");
    ownHerdr(bundle, data);
    expect(readFileSync(own, "utf8")).toContain("echo updated");
  });

  it("listens where HERDR_SOCKET says, else under XDG_CONFIG_HOME or ~/.config", () => {
    expect(herdrSocket({ HERDR_SOCKET: "/s.sock", XDG_CONFIG_HOME: "/x", HOME: "/h" })).toBe("/s.sock");
    expect(herdrSocket({ XDG_CONFIG_HOME: "/x", HOME: "/h" })).toBe("/x/herdr/herdr.sock");
    expect(herdrSocket({ HOME: "/h" })).toBe("/h/.config/herdr/herdr.sock");
  });

  it("tells a live socket from a missing one and from one a killed daemon left", async () => {
    const dir = temp();
    const live = join(dir, "live.sock");
    const server = createServer().listen(live);
    await new Promise((resolve) => server.once("listening", resolve));
    expect(await socketState(live)).toBe("answers");
    server.close();
    expect(await socketState(join(dir, "none.sock"))).toBe("absent");
    const stale = join(dir, "stale.sock");
    const holder = Bun.spawn([process.execPath, "-e", `require("node:net").createServer().listen(${JSON.stringify(stale)}); setInterval(() => {}, 1000)`]);
    for (const deadline = Date.now() + 5000; !existsSync(stale) && Date.now() < deadline;) await Bun.sleep(20);
    holder.kill("SIGKILL");
    await holder.exited;
    expect(await socketState(stale)).toBe("refused");
  });

  it("starts its server when nothing listens, and leaves it running", async () => {
    const dir = temp();
    const env = { HOME: dir, PATH: process.env["PATH"] };
    // a stand-in daemon: listens on the socket herdr would, as a process of its own
    const herdr = script(join(dir, "herdr"), `[ "$1" = server ] || exit 2\nmkdir -p "$HOME/.config/herdr"\nexec "${process.execPath}" -e 'require("node:net").createServer().listen(process.env.HOME + "/.config/herdr/herdr.sock"); console.log(process.pid)'`);
    await ensureHerdr(herdr, env, join(dir, "logs", "herdr.log"));
    expect(await socketState(herdrSocket(env))).toBe("answers");
    const pid = Number(readFileSync(join(dir, "logs", "herdr.log"), "utf8").trim());
    children.push(pid);
    expect(() => process.kill(pid, 0)).not.toThrow();
    // a second start finds it answering and starts nothing
    await ensureHerdr(join(dir, "missing-herdr"), env, join(dir, "logs", "herdr.log"));
  });

  it("says where to look when its server ends before it answers", async () => {
    const dir = temp();
    const herdr = script(join(dir, "herdr"), "echo 'herdr: protocol mismatch' >&2; exit 3");
    const log = join(dir, "herdr.log");
    await expect(ensureHerdr(herdr, { HOME: dir }, log)).rejects.toThrow(`exited with 3 before it answered; see ${log}`);
    expect(readFileSync(log, "utf8")).toContain("protocol mismatch");
  });
});

describe("the bundled bridge", () => {
  /** A bundle whose bin/bun serves the bridge's health from what the app gives it, or prints and exits. */
  const bundle = (serve: string) => {
    const dir = temp();
    script(join(dir, "bin", "bun"), `exec "${process.execPath}" -e '${serve}'`);
    return dir;
  };
  const port = () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const free = probe.port!;
    probe.stop(true);
    return free;
  };

  it("answers on loopback once its health does, with its own bin first on PATH", async () => {
    const dir = bundle(`Bun.serve({ hostname: process.env.HOST, port: Number(process.env.PORT), fetch: () => Response.json({ ok: true, bridge_protocol: 1, path: process.env.PATH, herdr: process.env.HERDR_WEB_HERDR_BIN, socket: process.env.HERDR_SOCKET }) })`);
    const free = port();
    const child = await startBridge({ bundle: dir, env: { HOME: "/h", PATH: "/usr/bin" }, herdr: "/opt/herdr", port: free, log: join(dir, "bridge.log") });
    children.push(child.pid!);
    const health = await (await fetch(`http://127.0.0.1:${free}/api/health?scope=bridge`)).json() as Record<string, unknown>;
    expect(health).toMatchObject({ path: `${join(dir, "bin")}:/usr/bin`, herdr: "/opt/herdr", socket: "/h/.config/herdr/herdr.sock" });
  });

  it("fails with what it printed when it exits first", async () => {
    const dir = bundle(`console.error("T-Rex cannot listen on 127.0.0.1:7317: the port is in use."); process.exit(1)`);
    await expect(startBridge({ bundle: dir, env: { PATH: "/usr/bin" }, herdr: "herdr", port: port(), log: join(dir, "bridge.log") }))
      .rejects.toThrow(/exited with 1 before it answered[\s\S]*the port is in use/);
  });
});
