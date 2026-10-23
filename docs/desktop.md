# Mac app

T-Rex as a Mac app (`desktop/`): an Electron window on the bridge, with the bridge and its
runtimes inside the app. A Mac needs neither Bun nor Node for it, nor even herdr.

## What it does when it opens

1. A T-Rex that already answers on `127.0.0.1:7317` (the herdr plugin, `bun run start`) gets the
   window as it is: the app starts and stops nothing.
2. Otherwise the app reads the login shell's environment (`$SHELL -ilc`, then `env -0`). An app
   opened from the Dock gets a bare `PATH`, and herdr's panes inherit the environment herdr is
   started with. A shell that prints nothing within 10 s leaves this process's environment, with
   the usual tool folders added. A UTF-8 `LANG` is set when no locale is.
3. herdr is the first one on that `PATH`. With none, it is the one the app carries, copied once to
   `~/Library/Application Support/T-Rex/bin/herdr`, so `herdr update` (Settings) never rewrites the
   app. When nothing answers on herdr's socket, `herdr server` starts detached and outlives the app,
   as it owns every pane. A socket that is there but does not answer is reported, not replaced.
4. The bridge is `Contents/Resources/bridge`: the remote PC bundle for that Mac
   (`scripts/build-remote-bundle.ts`, with Bun, Node, herdr and node-pty pinned by checksum, plus
   `server/`, `shared/`, `dist/` and the production `node_modules`). The app runs
   `bin/bun server/index.ts` on `127.0.0.1:7317` with that `bin/` first on `PATH`, so the PTY
   sidecar finds the bundle's Node, and stops it when it quits.

Links open in the browser. Closing the window keeps the app in the Dock, and the Dock icon opens a
new one. Settings → Updates says that a new version is a new download: the bridge runs without
the update supervisor (`HERDR_WEB_DESKTOP=1`).

Logs are in `~/Library/Logs/T-Rex/` (`bridge.log`, `herdr.log`). The bridge keeps its usual state
dir (`~/.config/t-rex`), shared with the plugin's bridge, which never runs on the port at the same
time.

## Build it

```bash
bun install && bun run build   # at the root: the client the bridge serves
cd desktop
bun install
bun run bridge                 # stages bundle/ for this Mac
bun run dist                   # dist/mac-arm64/T-Rex.app (dist/mac/ on Intel), .dmg and .zip
```

`bun run start` opens a window without packaging. On a port with no bridge it starts the one in
`bundle/`; `T_REX_PORT=7417 bun run start` uses the sandbox's bridge (`bun run sandbox` at the root).

Checks:

- `bun test src` (also run by `bun run check fast`) and `bun run typecheck`.
- `bun scripts/smoke.ts dist/mac-arm64/T-Rex.app` opens the packaged app as a user would. It checks
  that herdr and the bridge answer and can attach terminals, that the window shows T-Rex, and that
  quitting stops the bridge but not herdr. It is written for CI's disposable Mac: on your own it
  takes the keyboard focus while its window is open and starts your herdr when it is not running.
  `T_REX_PORT` moves it off a port another bridge holds.

## Releases

A release is a `vX.Y.Z` tag on `main`.

1. A pull request sets the version in `package.json` and `herdr-plugin.toml`, and turns
   `## [Unreleased]` in CHANGELOG.md into `## [X.Y.Z] - YYYY-MM-DD`, with a new empty
   `## [Unreleased]` above it.
2. Once it is merged: `git tag vX.Y.Z origin/main && git push origin vX.Y.Z`.
3. `.github/workflows/release.yml` checks that the tag names both versions and that the section
   exists. It then builds the app on `macos-15` (Apple silicon) and `macos-15-intel` (Intel), opens
   each packaged app once (`desktop/scripts/smoke.ts`), and publishes the GitHub release:
   `t-rex-X.Y.Z-arm64.dmg` and `.zip`, the same for `x64`, `SHA256SUMS.txt`, and the changelog
   section with install notes. GitHub adds the source archives.

Installed herdr plugins see the tag too, and Settings offers them the update
([app updates](app-updates.md)). Tag only what is ready.

A pull request that touches `desktop/`, the bundle builder or the workflow runs the same build and
smoke test without publishing. So does Actions → Release → Run workflow, on any branch, which
leaves the `.dmg` and `.zip` as the run's artifacts.

## Signing

The app is not signed with a Developer ID. It is signed ad hoc, without the hardened runtime
(`desktop/electron-builder.yml`), and macOS refuses a downloaded copy until its download mark is
cleared once:

```sh
xattr -dr com.apple.quarantine /Applications/T-Rex.app
```

Signing and notarizing take a Developer ID Application certificate, the secrets `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` passed to the
workflow's Package step, and in `electron-builder.yml` no `identity: "-"`, `hardenedRuntime: true`
and `notarize: true`.

## Not yet

- Apple silicon and Intel Macs only: no Linux or Windows build.
- The app does not update itself. On macOS, electron-updater needs a signed app.
- The window keeps macOS's title bar: the top bar does not sit in it yet.
- The bundle carries its own Node, and the client's npm packages, which the bridge does not
  need. Electron's own Node could run the PTY sidecar.
