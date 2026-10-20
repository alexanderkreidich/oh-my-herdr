import { afterEach, expect, it, mock } from "bun:test";
import { applyDiff, frameText, PLAIN_STYLE, type Style } from "../../shared/ssp.ts";
import { Screen } from "../ssp/screen.ts";
import { connectionData, type Client } from "./connections.ts";
import type { PaneAttachment } from "./terminal-process.ts";
import type { ServerMessage } from "../../shared/protocol.ts";

let attachment: PaneAttachment;
mock.module("./terminal-process.ts", () => ({
  ATTACH_HELD_MESSAGE: "Held",
  createSpawnAttachment: ({ attachments }: { attachments: Map<string, PaneAttachment> }) => ({
    spawnAttachment: async (pane: string) => { attachments.set(pane, attachment); return attachment; },
  }),
}));
const { createTerminalRegistry } = await import("./terminals.ts");

afterEach(() => mock.restore());

for (const sync of [true, false]) for (const readOnly of [false, true]) for (const ready of [false, true]) {
  it(`preserves input readiness ${ready} after the screen for an ${readOnly ? "observer" : "owner"} joining a shared attach${sync ? "" : " on the raw stream"}`, async () => {
    const frames: ServerMessage[] = [];
    const client = {
      data: connectionData({ deviceId: undefined, readOnly }), readyState: WebSocket.OPEN,
      getBufferedAmount: () => 0, send: (text: string) => { frames.push(JSON.parse(text)); return text.length; },
      close() {},
    } as unknown as Client;
    const screen = await Screen.create(80, 24);
    screen.write("retained screen");
    attachment = {
      kind: "pty", ready, cols: 80, rows: 24, clients: new Set(), grids: new Map(), stalled: new Map(), screen, resumable: new Map(),
      process: { exited: Promise.resolve(), resize() {}, kill() {}, write() {} } as unknown as Extract<PaneAttachment, { kind: "pty" }>["process"],
    };
    const registry = createTerminalRegistry({
      options: {}, clients: new Set([client]), stopped: () => false, terminalAttach: async () => true,
      holdFor: 0, heldRetry: 0, retryFor: 0, relookupFor: 0,
      end() {},
    });
    await registry.terminalFrames.attach(client, { type: "attach", pane_id: "p", cols: 80, rows: 24, keep_size: true, ...(sync ? { sync: "ssp" as const } : {}) });
    const output = frames.findIndex((frame) => frame.type === (sync ? "ssp" : "pty-data"));
    expect(output).toBeGreaterThanOrEqual(0);
    const first = frames[output]!;
    if (first.type === "ssp") {
      const styles = new Map<number, Style>([[0, PLAIN_STYLE]]);
      expect(frameText(applyDiff(null, first, styles))[0]).toBe("retained screen");
    } else if (first.type === "pty-data") {
      // an older page gets the screen drawn whole
      expect(first.data).toContain("retained screen");
    }
    // An input-ready receipt is the existing attach-complete barrier for queued input,
    // not an output-presentation notification. No early negative receipt may satisfy it.
    expect(frames.filter((frame) => frame.type === "input-ready")).toEqual(
      ready ? [{ type: "input-ready", pane_id: "p" }] : [],
    );
    if (ready) expect(frames.findIndex((frame) => frame.type === "input-ready")).toBeGreaterThan(output);
    registry.closeAttachment("p");
  });
}
