/**
 * One terminal's side of the State Synchronization Protocol (shared/ssp.ts): the screens the bridge
 * sent for the pane, and the drawing of the newest into the terminal renderer (shared/ssp-display.ts).
 *
 * The renderer only ever draws what this view writes: the bridge's screen, cut or padded to the
 * renderer's own grid while the two differ (a resize on its way).
 */
import {
  PLAIN_STYLE, applyDiff, blankRow, decodeRow, encodeRow, frameText, makeRow,
  type Cell, type Frame, type FrameDiff, type Row, type Style,
} from "../../../shared/ssp.ts";
import { TerminalDisplay } from "../../../shared/ssp-display.ts";

/** frames this view keeps beyond the ones the sender may still name as a base */
const MAX_FRAMES = 32;

export interface SspViewOptions {
  /** writes VT output into the renderer */
  write(data: string): void;
  /** tells the bridge this view has screen `num` of `stream` */
  ack(stream: string, num: number): void;
  /** the program asked for the clipboard to be set (OSC 52): its payload as written */
  clipboard?(payload: string): void;
  /** OSC 8 links this app cannot open are drawn as text */
  linkAllowed?(uri: string): boolean;
  /** the newest screen changed (after it was drawn) */
  screen?(frame: Frame): void;
}

export class SspView {
  private stream: string | null = null;
  private readonly frames = new Map<number, Frame>();
  private readonly styles = new Map<number, Style>([[0, PLAIN_STYLE]]);
  private newest: Frame | null = null;
  private clipSeq: number | null = null;
  private readonly display: TerminalDisplay;
  private cols = 0;
  private rows = 0;
  private disposed = false;

  constructor(private readonly options: SspViewOptions) {
    this.display = new TerminalDisplay(options.linkAllowed ? { linkAllowed: options.linkAllowed } : {});
  }

  /** the newest screen the bridge sent */
  get screen(): Frame | null {
    return this.newest;
  }

  /** the screen's text, one line per row */
  text(): string {
    return this.newest ? frameText(this.newest).join("\n") : "";
  }

  /** The renderer's grid: frames are cut or padded to it. A change redraws everything. */
  setSize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.display.invalidate();
    this.draw();
  }

  /** Something else was written to the renderer (a read-only view's stream, a reset): the next draw is whole. */
  invalidate(): void {
    this.display.invalidate();
  }

  /** A new attach of the pane: what came before is another stream. */
  reset(): void {
    this.stream = null;
    this.frames.clear();
    this.newest = null;
    this.clipSeq = null;
  }

  /** A difference from the bridge: applied to the screen it names, acknowledged, drawn. */
  receive(diff: FrameDiff): void {
    if (this.disposed) return;
    if (diff.stream !== this.stream) {
      // a new stream starts from a blank screen; a difference against a screen of a stream this view never had is unusable
      if (diff.base !== 0) return;
      this.stream = diff.stream;
      this.frames.clear();
      this.newest = null;
      this.clipSeq = null;
    }
    const base = diff.base === 0 ? null : this.frames.get(diff.base);
    if (diff.base !== 0 && !base) {
      // a base this view no longer has (it cannot happen on one connection): say what it has instead
      if (this.newest) this.options.ack(diff.stream, this.newest.num);
      return;
    }
    const frame = applyDiff(base ?? null, diff, this.styles);
    this.frames.set(frame.num, frame);
    for (const num of this.frames.keys()) if (num < diff.throwaway && num !== frame.num) this.frames.delete(num);
    if (this.frames.size > MAX_FRAMES) for (const num of [...this.frames.keys()].sort((a, b) => a - b).slice(0, this.frames.size - MAX_FRAMES)) this.frames.delete(num);
    if (this.newest && frame.num <= this.newest.num) {
      // an older screen arrived late: kept as a base, never drawn over a newer one
      this.options.ack(diff.stream, this.newest.num);
      return;
    }
    const first = this.newest === null;
    this.newest = frame;
    this.options.ack(diff.stream, frame.num);
    // a clipboard write is an event: the one a joining client finds on the screen is old news
    if (first) this.clipSeq = frame.clip?.seq ?? null;
    else if (frame.clip && frame.clip.seq !== this.clipSeq) {
      this.clipSeq = frame.clip.seq;
      this.options.clipboard?.(frame.clip.payload);
    }
    this.draw();
    this.options.screen?.(frame);
  }

  /** Draws the newest screen, if anything changed since the last drawing. */
  draw(): void {
    if (this.disposed || !this.newest || this.cols <= 0 || this.rows <= 0) return;
    const output = this.display.draw(fitFrame(this.newest, this.cols, this.rows), (id) => this.styles.get(id) ?? PLAIN_STYLE);
    if (output) this.options.write(output);
  }

  dispose(): void {
    this.disposed = true;
  }
}

/** The frame cut or padded to `cols` x `rows`: a wide cell cut in half at the edge goes blank. */
export function fitFrame(frame: Frame, cols: number, rows: number): Frame {
  if (frame.cols === cols && frame.rows === rows) return frame;
  const blank = blankRow(cols);
  const lines: Row[] = [];
  for (let row = 0; row < rows; row++) {
    const line = frame.lines[row];
    if (!line) {
      lines.push(blank);
      continue;
    }
    const cells: Cell[] = decodeRow(line.wire, frame.cols).slice(0, cols);
    const last = cells[cols - 1];
    if (last?.width === 2) cells[cols - 1] = { text: " ", width: 1, style: last.style };
    while (cells.length < cols) cells.push({ text: " ", width: 1, style: 0 });
    lines.push(makeRow(encodeRow(cells)));
  }
  const cursor = { ...frame.cursor, row: Math.min(frame.cursor.row, rows - 1), col: Math.min(frame.cursor.col, cols - 1) };
  return { ...frame, cols, rows, lines, cursor };
}
