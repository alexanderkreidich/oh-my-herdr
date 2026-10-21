# Restty terminal integration

The browser uses the native runtime from `alexanderkreidich/restty`, pinned to `a39be73`.
`bun install` builds that git dependency through `scripts/build-restty.ts`; no xterm.js
packages, source patches or build step remain. This does not change ownership of the PTY:
herdr remains authoritative, including history, selection ranges and keyboard protocol.

## Rendering and Appearance

- Settings -> Appearance -> Terminal controls font, size, ligatures, Ghostty theme and renderer
  (`auto`, `webgpu`, `webgl2`). JetBrains Mono is the default, with bundled regular, bold,
  italic and bold-italic TTF faces and Symbols Nerd Font. Unicode/emoji/CJK fallbacks load lazily.
- Runtime/font initialization is warmed at page startup and shared across panes. TTF avoids
  the WOFF2 JavaScript decoder on the terminal's critical path (about 56 ms in the initial probe).
- SSP frames paint the same native runtime as raw/watch and read-only mirrored output.
  Program modes enter restty through its PTY connection, not just a renderer write; restty's
  device replies do not bypass the bridge's authoritative query handling.
- The app owns resize/fit, wheel/history navigation, drag/word selection, copy, safe HTTP(S)/OSC 8
  links, search overlays, touch/pinch and input routing. Herdr supplies authoritative selection
  text; a synchronous visible-screen fallback preserves the clipboard gesture.
- Native and replacement IME adapters preserve corrected DOM commits, punctuation order and
  cancellation on pane reset. See [terminal input](terminal-input.md) for limits of replay QA.

Sandbox screenshots: [desktop dark](screenshots/restty/desktop-dark.png),
[phone dark](screenshots/restty/phone-dark.png), [desktop light](screenshots/restty/desktop-light.png).

## New-tab critical path

Agentless `POST /api/tab/create` replies include herdr's actual tab/pane objects. Older bridges
can omit them and keep the previous refresh path. The browser can therefore mount a new
terminal without waiting for `/api/session` and its agent-process discovery.

`CreatedTabs` temporarily merges creation replies into stale HTTP/SSE rosters, until a roster
acknowledges them. Without that guard a stale cache removed the new pane, detached it, then
reattached after another session read. Pane exit cancels the pending entry; an unacknowledged
entry expires after 10 seconds. Unit tests cover stale rosters, acknowledgement, concurrent
creation, exit, expiry and old bridges. The browser check also holds `/api/machines` while
asserting that the newly created restty surface mounts.

## Verification

```sh
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
bun run typecheck
bun run test:restty
bun run check fast
bun run check integration
```

`test:restty` builds once and runs 12 scripts inside one owned, isolated herdr session. It covers
copy with denied clipboard permission; history wheel/edge selection; legacy and Kitty keyboard
protocols; composition and Safari/iPad/iPhone event replays; drafts across offline pane switches;
file/path drop and paste; split panes; WebGL2/Appearance persistence; new tabs; viewport, pinch,
search, minimal UI and SSP latency. It does not restore the removed chat/header tests or certify
physical IMEs. Full replacement of upstream's obsolete browser lane remains a Phase 2 task.

Canvas tests read `.restty-terminal.screen()` through `scripts/terminal-screen.ts`, rather than
querying renderer DOM rows. `selection: null` means no selection; `selection: ""` can be a valid
selection of blank cells. Assertions about actual input use outgoing frames and an owned PTY.

On 2026-10-21, the whole `test:restty` lane passed. Typecheck, generated-file freshness and build
passed. The fast lane reported 2712 passing, 2 failing and 22 skipped tests: the macOS headless
installer assumption (also fails on main) and a plugin-config subprocess deadline (passes alone
on both branches). Integration reported 357 passing, 2 failing and 3 skipped: attach-query reply
timeout and child-stdin-close timeout; both failures reproduce on main `26e6440`.
These broad lanes are not green and are not reported as such.

## Startup measurements

A five-run sample on the same Mac/Chrome, 1440x900 viewport at DPR 2, built clients, isolated
sandboxes, measured time to first nonempty screen. Cold uses a fresh browser profile; warm
reloads it; new tab measures the add-button action through its first screen. These are local
samples, not a cross-device benchmark or a claim about memory/throughput.

| Median, ms | xterm main `26e6440` | restty integration |
| --- | ---: | ---: |
| Cold load | 427 | 391 |
| Warm reload | 325 | 312 |
| New terminal | 428 | 216 |

An earlier five-run sample was 323/264/361 ms on main and 360/276/191 ms on restty: startup varies
with machine load; the repeatable improvement is removing the new-tab detach/session-read cycle,
not a universal cold-start speedup. At simulated 200 ms RTT, established local-echo epochs render
subsequent keys at about 15 ms median; the first key still requires confirmation from the bridge.

Reproduce against **owned sandbox bridges only**; the script creates and closes a tab:

```sh
bun run build
bun run sandbox
# In another terminal, with CHROME_PATH exported:
RUNS=5 URL=http://127.0.0.1:7417 bun scripts/terminal-performance.ts
```

Point `URL` at a separately built main sandbox for the baseline. The renderer mark is not used by
main, so its first-screen observation polls the old renderer's nonempty rows on animation frames.

## Playground parity and Kitty blocker

The five playground payloads (`kitty`, `demo`, `test`, `ansi-art`, `colors`) were injected as
identical VT bytes into the actual local playground's mocked WebSocket backend and this app's
`ResttyTerminal` wrapper. Both had a 1200x760 viewport, DPR 2, Aizen Dark, size 18 in height mode
and WebGPU. Playground chrome was hidden without changing terminal geometry. Captures retained
the reference and wrapper images under different names, and were compared with FFmpeg's `ssim`.

| Payload | SSIM, wrapper with app fonts vs playground |
| --- | ---: |
| Kitty image | 0.998702 |
| Demo | 1.000000 |
| Capabilities/Unicode | 0.997607 |
| ANSI art | 1.000000 |
| Colours | 0.999626 |

Captured evidence: [playground Kitty reference](screenshots/restty/kitty-playground.png),
[wrapper Kitty rendering](screenshots/restty/kitty-wrapper.png),
[wrapper Unicode/styles](screenshots/restty/capabilities-wrapper.png).

The wrapper renders the Kitty RGB gradient correctly when it receives the graphics APC.
**This is renderer parity, not end-to-end graphics support in a herdr pane.**

Installed herdr 0.9.3's `terminal attach` rebuilds a cell frame and does not emit the `ESC_G`
Kitty image payload. Capturing the owned pane's attach output while it prints the demo found no
such APC. Inspection of upstream herdr `143bf5fd` also shows the TerminalAttach/TerminalObserve
branch building a cell/hyperlink frame, while graphics assets/placements belong to ClientShell
surfaces. No user installation or live session was updated to investigate this.

SSP currently carries cells/styles/modes, not image assets or placements. Merely enabling graphics
in the browser, forwarding raw bytes around SSP or replaying APC on reconnect cannot supply a
correct graphics scene. Completion needs a supported per-pane herdr graphics snapshot/update
transport, followed by bounded asset/placement state in SSP and renderer reconciliation for
joins, resize, deletion, reconnect and acknowledgements. Do not label the requested full graphics
integration complete until a real owned pane passes that path.
