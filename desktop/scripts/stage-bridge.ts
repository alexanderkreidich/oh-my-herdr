/**
 * Stages bundle/, the bridge the app carries: the remote PC bundle for this Mac
 * (scripts/build-remote-bundle.ts: Bun, Node, herdr and node-pty pinned by checksum, the server,
 * shared/, dist/ and node_modules), unpacked. Run `bun run build` at the root first; a release
 * installs the root's production dependencies only before this (.github/workflows/release.yml).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const desktop = resolve(import.meta.dirname, "..");
const root = resolve(desktop, "..");
const platform = `${process.platform}-${process.arch}`;
if (process.platform !== "darwin") throw new Error(`The app is built for macOS only, not ${platform}`);
const output = join(desktop, "bundle");
const work = join(desktop, "bundle-work");

function run(argv: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(argv[0]!, argv.slice(1), { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${argv.join(" ")} failed (${result.status ?? result.signal})`);
}

rmSync(output, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });
try {
  run([process.execPath, "scripts/build-remote-bundle.ts", platform], root, { ...process.env, HERDR_BUNDLE_OUTPUT: work });
  mkdirSync(output, { recursive: true });
  run(["tar", "xzf", join(work, `t-rex-${platform}.tgz`), "-C", output], desktop);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Staged the ${platform} bridge in ${output}`);
