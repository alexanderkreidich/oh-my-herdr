# State Synchronization Protocol

The bridge and the browser keep a pane's screen in step the way Mosh does (Winstein and
Balakrishnan, "Mosh: An Interactive Remote Shell for Mobile Clients", USENIX ATC 2012): the bridge
sends screens, not bytes. A browser on a slow or lossy link skips the screens it fell behind on
instead of replaying them. The model is Mosh's; the code is new (Mosh is GPL-3.0).

## The pieces

| Where | What |
|---|---|
| `shared/ssp.ts` | The screen model both sides share: rows of cells (`WireRow`), styles, cursor, modes, and the difference between two screens (`FrameDiff`). |
| `server/ssp/screen.ts` | One headless terminal per attached pane (restty's libghostty-vt in WASM) fed by herdr's attach stream: the authoritative screen, numbered. |
| `server/ssp/modes.ts` | What the screen does not hold: the modes the browser's input encoding follows (mouse, DECCKM, bracketed paste, keypad, focus, modifyOtherKeys) and clipboard writes (OSC 52). |
| `server/ssp/sync.ts` | One client's sender: differences, pacing by round trip, acknowledgements, retransmission, resume; and the echo clock. |
| `shared/ssp-display.ts` | The VT output that takes a terminal from what it shows to a screen (Mosh's display). The browser draws with it; the bridge draws a screen whole with it for an older page. |
| `src/lib/ssp/view.ts` | The browser's side: the screens it was sent, drawn into the renderer. |

## On the wire

A client attaches with `sync: "ssp"` (the bridge lists the `ssp` feature). Each `ssp` frame is a
`FrameDiff`: the difference from screen `base` (0: a blank screen) to screen `num` of a stream, the
rows that changed (after a `scroll`, when the screen scrolled), the styles those rows use, the
cursor, the modes, a clipboard write if one is new, and for local echo `echo` (the newest `seq`
of this client's `input` and `keys` the program has had 50 ms to echo) and `rtt`. The client applies it to the
screen it names, keeps the screens from `throwaway` on, draws the newest, and answers
`ssp-ack {stream, num}`.

- **Latest state wins.** The sender diffs from the newest screen the client is assumed to have:
  the newest one sent, while its acknowledgement is not overdue, else the newest acknowledged. A
  client that falls behind is sent the current screen next; the screens in between never go. At
  most a few unacknowledged screens are in flight, and none while the socket's queue is over
  256 KiB. Nothing pauses the pty: the screen takes everything herdr draws, whatever the clients do.
- **Pace.** A frame waits 3 ms after a change for the output that follows, then goes at most every
  half smoothed round trip (8–250 ms). The round trip is measured from acknowledgements (RFC 6298's
  estimator); the retransmission timeout doubles while acknowledgements stay away.
- **Loss and reordering.** A screen whose acknowledgement is overdue goes again, from the
  acknowledged screen. A client drops a difference against a screen it no longer has; the next
  retransmission is from one it has. (A WebSocket loses and reorders nothing, but the protocol does
  not rely on that.)
- **Joining.** A client joining a pane gets its current screen whole, drawn once herdr has drawn
  something. Nothing is replayed, and herdr is never asked to repaint for a joiner.
- **Reconnect.** A client that comes back names the stream and the newest screen it acknowledged
  (`resume`). While the pane's attachment lives (another client keeps it), the next frame is the
  difference from that screen; otherwise a new stream starts from a blank screen. Either way the
  browser diffs the new screen against what it already shows, so nothing flickers.
- **Queries.** The attach's terminal queries (device attributes, cursor position) are answered by
  the bridge's screen, never by a browser, unless an older page on the raw stream is attached: its
  own terminal answers then, as before.
- **Older pages.** An attach without `sync` gets the screen drawn whole and then the raw byte stream
  as `pty-data`. A raw client whose transport stays backed up is closed with 4008.

## Colours

Browsers have different themes, so palette colours must cross the wire as palette indices. The
headless terminal resolves every colour to RGB, so its palette and defaults are sentinels that map
back: palette index *i* draws as rgb(1, 2, *i*), the default foreground rgb(1, 3, 0), the default
background rgb(1, 3, 1). A program asking for exactly one of those truecolours gets the palette
colour instead.

## Widths

herdr gives a whole emoji sequence two cells; the screen runs in grapheme mode (2027) to agree. The
display positions every cell after a non-ASCII or wide one explicitly, so a renderer whose width
tables differ draws each cell where the bridge has it.

## Verification

```sh
bun test shared/ssp-display.test.ts server/ssp src/lib/ssp   # model, display, sender, convergence
bun test server/output.contract.test.ts                      # real herdr: sync, joiners, a silent observer, echo, resume, raw pages
```

`src/lib/ssp/convergence.test.ts` runs the whole path, bridge screen to sender to a link that delays,
reorders and drops frames and acknowledgements (up to 40%), across a reconnect, into the browser's
view and its display, drawn into a second headless terminal: once the program stops drawing, that
terminal shows exactly the bridge's screen, styles, cursor and modes.

## The PTY sidecar

`herdr terminal attach` runs on node-pty in a Node sidecar (`server/pty/pty-host.mjs`): loading
node-pty in Bun panics it (oven-sh/bun#18546). The sidecar stops reading the pty while its pipe to
the bridge is full, so output waits in the kernel, not in memory. The bridge itself never pauses
the pty any more: browsers that fall behind skip screens instead of holding output back. Bun's own
`Bun.Terminal` has no output pause (oven-sh/bun#41410); revisit the sidecar once it does.
