# Roadmap

restty-herdr: an improved, minimal fork of herdr web UI with a Ghostty-like terminal emulator
([restty](https://github.com/wiedymi/restty)) and a Mosh-style State Synchronization Protocol.

Each phase is a few slices; each slice is one branch and one PR (AGENTS.md, Development flow).
A slice is done when its "Done when" holds, with evidence in the PR.

## Phase 0 — Development flow

- [x] AGENTS.md for the fork: product, flow, UX and motion rules, traps.
- [x] Emil Kowalski's design and animation skills in `.agents/skills/` (`.claude/skills` links).
- [x] `bun run sandbox`: an isolated herdr and bridge for UI work, with `--shot` screenshots.
- [x] This roadmap.

## Phase 1 — Minimal chrome

The visible UI shrinks to a workspace list, one top bar of pill tabs and the terminal.

- [x] **Top bar with pill tabs.** The header and the tab strip become one bar: sidebar toggle,
      then the tabs as pills (the pane's icon — agent mark or terminal glyph — and its title or the
      tab's own name), the open tab on a filled pill, `+` at the end. A status dot sits on the icon.
      The connection chip shows only while the bridge is not live.
- [x] **Header removals.** No Chat/Terminal switch, no Files button, no More (…) menu, no search
      button.
- [x] **Sidebar: workspaces only.** No Agents section; no folder or favicon face on workspace
      rows (a worktree group's mark turns to a chevron that folds it).
- [x] **Command palette on Ctrl+F.** The search button goes; Find in terminal stays on
      Mod+Shift+F and in the palette.
- [x] **No chat lens.** Every pane opens in the terminal; the lens switch shortcut, the Chat
      settings page and the palette's lens and Files actions go.
- [x] **Motion pass.** Tokens from the skills (`--ease-out`, `--ease-in-out`), press feedback on
      tabs and buttons, new tabs enter, menus and dialogs open from their origin, the sidebar
      slides; reduced-motion variants. Nothing keyboard-initiated animates.
- [x] **Focus mode** (`Mod+Shift+.`, the palette): from 769px with the sidebar shown, each
      workspace's tabs are rows under it (the pill's mark and name, the state in the status
      column; a tab with no agent reads dimmer) and the bar over the pane goes. A hidden sidebar
      hands the tabs back to the bar. A split view's halves keep their own strips.
- [x] **PC switcher.** The sidebar shows one PC at a time. Its top row is a switcher (the PC's
      mark and name, a chevron with a point when another PC waits on you) whose menu lists the
      PCs, Manage for an SSH PC and Add PC, and a `+` for a new workspace at the row's far edge.
      The PC headers, their folds and the "Host" label over the list go.
- [ ] PC switcher follow-ups: a key to switch PCs (Ctrl+1–9 is the browser's on Windows and Linux);
      the Host's name without macOS's `.local`.
- [ ] Focus mode follow-ups: the bridge says which shells run a command (`pane.process_info`), so
      a shell at work does not read as idle; tab rows reorder by drag.
- [ ] Follow-ups: the split view's halves still draw their own strip rows under an empty bar;
      the sidebar's top zone in the bar snaps while the sidebar slides; Install app in the
      sidebar footer is a candidate for removal (Phase 3).

Done when: desktop (1440×900) and phone (390×844) screenshots in both themes show only the
workspace list, the tab bar and the terminal; `bun run check fast` is green;
`scripts/minimal-ui-regression.ts` passes; `review-animations` passes on the diff.

## Phase 2 — Delete chat and files

Phase 1 makes them unreachable; this phase deletes them, client, server, contract, scripts and
docs, so the tree is as small as the product.

- [x] Client: `ChatView`, `Composer` and the chat-only parts of `PaneTerminal`, chat timeline,
      minimap, pending messages, the chat libraries, `AgentSidebar`, the `PaneView` lens type.
- [x] Client: `FilesDialog`, `FileViewer`, `RepoDiffViewer`, `WebPanel`, file panels and their
      settings.
- [x] Server: transcript readers and conversation push (`conversation*`, `codex*`, `claude-*`,
      `gjc*`, `devin*`, `grok*`, `agy*`, OpenCode, Hermes, OmO and the rest), skills and command
      menus that only the composer used, `files.ts`, `file-view.ts`; their routes in `shared/`.
      What pane status still reads (OmO labels, Claude's background count, GJC's binding) stays.
- [x] Scripts and docs that test or describe them (chat and file browser QA, chat docs).
- [x] Server routes only the removed UI used (`/api/fs/favicon`, herdr's agent-row tokens, the
      folder listing's file and pane-relative modes).
- [ ] A lean browser lane for what is left, grown from `scripts/minimal-ui-regression.ts`, run on
      the system Chrome (`CHROME_PATH`): upstream's `scripts/ci-browser.sh` is already broken
      (22 of its scripts are gone, most others assume the chat, the More menu, the lens switch or
      the agent list). Keep a script only if it passes against this UI; delete the rest, and the
      demo-only scripts with them. `docs/development.md` loses the deleted scripts in the same PR.
- [ ] GJC's transcript lookup keeps a `purpose: "chat"` branch only status no longer takes;
      collapsing it touches the SDK timeouts and failure cache, so it is its own slice.

Done when: no `chat` lens or transcript route remains; `bun run check full` is green; the PR
lists the bundle size and line count before and after.

## Phase 3 — Fork identity and cleanup

- [ ] Own identity: plugin id, `package.json` repository, push subject, updater source.
- [x] Remote PCs run this fork's bridge: the bundle URL names this repository and its versions
      start at 1000, so a PC on upstream's bridge (no SSP, no local echo) is offered Update bridge.
- [ ] Publish `remote-v1000` from this repository; until then a remote PC needs a bundle built
      beside the server (`bun run build:remote <platform>`, docs/remote-pcs.md).
- [x] Remove upstream usage telemetry: sender, daily visits, settings snapshots, API, UI, receiver
      and reporting/deployment tooling.
- [ ] README and INSTALL for the fork; DESIGN.md trimmed to what is left; `docs/guide.md`
      rewritten without the chat (its Supported agents and Features sections describe it).
- [ ] CI for the fork: one GitHub Actions workflow running `bun run check fast` on PRs; upstream's
      Pages, growth, release and self-hosted-runner workflows go.
- [ ] Decide, one by one, what else leaves (each a small PR or a "keep" note here): the website
      (`site/`), native shells (`app/`), the film, usage meters and CLIProxy, voice input, Portal,
      in-app alerts (Droplet), the sidebar's Install app button.

## Phase 4 — restty terminal

Replace xterm.js with restty: libghostty-vt in WASM for VT parsing and state, WebGPU rendering
with a WebGL2 fallback, TypeScript text shaping.

- [x] Native runtime selected, pinned to the `alexanderkreidich/restty` fork. No compatibility
      renderer or xterm fallback remains. Startup/input and playground comparisons are in
      [restty integration](restty.md).
- [x] `PaneTerminal` on restty: the attach stream in; keys, IME, paste and mouse out; selection
      and copy, links, search, resize and fit, the mirrored (read-only) pane.
- [x] Ghostty look: themes from Ghostty's palette set, font rendering and ligatures, cursor
      styles. xterm, its patches and `scripts/build-xterm.ts` go.
- [ ] Follow-up measurements: large-output frame time, memory and bundle-size comparison;
      repeat physical IME/device QA against restty (recorded-event browser replays pass).
- [x] Kitty graphics end to end with the companion herdr `feat/kitty-graphics-attach` branch:
      authoritative attach scene, bounded/acknowledged SSP pixel chunks and native reconciliation.
      Real-pane WebGPU/WebGL2 checks cover large RGBA, PNG/file medium, stalled pixel ACKs with
      live text, joins/reconnect, resize/crop, deletion and pi's placement-only redraw. Stock herdr
      still needs that patch ([alexanderkreidich/herdr#1](https://github.com/alexanderkreidich/herdr/pull/1)).
      See [transport and reproduction](restty.md#kitty-graphics-transport).

Done when: the terminal input, IME, paste, copy and selection regressions pass on restty, and the
PR shows the measurements against xterm.js. `bun run test:restty` is the owned terminal browser
lane; renderer-only Kitty evidence must not be represented as herdr/SSP end-to-end support.

## Phase 5 — State Synchronization Protocol

Mosh's model for the bridge–browser link: synchronize screen state, not a byte stream. Done ahead
of Phase 4: the browser draws the synced screen into its renderer with VT output
(`shared/ssp-display.ts`), so it does not depend on which renderer that is, and it gives the
browser the screen as data, which the restty slice can read instead of a renderer's buffer.
See [ssp.md](ssp.md).

- [x] **Bridge screen state.** One headless terminal (`restty/headless`) per attached pane, fed by
      herdr's attach stream: the authoritative state, numbered.
- [x] **Sync.** The bridge sends the difference from the state the client last acknowledged to
      the current one; the client applies it and acknowledges. Latest state wins: a slow or
      backgrounded client skips intermediate frames instead of replaying them, and a reconnect
      resumes from its last acknowledged state. Frame rate follows the measured round-trip time.
- [x] **Predictive local echo.** As Mosh: predict printable characters, backspace and cursor
      moves on the current line; group predictions in epochs and show them only once an epoch is
      confirmed by the server's state; underline unconfirmed predictions when the link is slow;
      roll back on mismatch; never predict while the terminal does not echo (passwords).
- [x] **Measure.** A harness with simulated latency and loss; typing at 200ms round trip feels
      local, and the screen converges to the bridge's state after loss.
- [ ] Follow-ups: a tab out of use still draws herdr's read-only view (`watch-data`) from its raw
      stream, and a mirrored pane's screen is synced but polled as before; a Settings choice for
      local echo (adaptive, always, never) if adaptive turns out wrong for someone.

Done when: correctness tests (convergence under loss, reordering and reconnect) and the latency
harness pass, and the old flow-control path is gone.
