import { describe, expect, it } from "bun:test";
import { Terminal } from "@xterm/xterm";
import { fileUriPath, hyperlinkFilter, isWebLink } from "./terminalLinks.ts";

const written = (term: Terminal, text: string) => new Promise<void>((resolve) => term.write(text, resolve));

describe("isWebLink", () => {
  it("opens http and https addresses, in any case", () => {
    for (const uri of ["http://example.com", "https://example.com/a?b=c#d", "HTTPS://EXAMPLE.COM"]) {
      expect(isWebLink(uri)).toBe(true);
    }
  });

  it("refuses every other scheme a crafted terminal line could carry", () => {
    for (const uri of ["javascript:alert(1)", "data:text/html,<script>x</script>", "vbscript:x", "file:///etc/passwd", "ws://example.com", "//example.com", "example.com", " https://example.com"]) {
      expect(isWebLink(uri)).toBe(false);
    }
  });
});

describe("hyperlinkFilter", () => {
  /** which cells of row `y` xterm underlines (a hyperlink is drawn underlined), as a string of 0/1 */
  const underlined = (term: Terminal, y: number, cols: number) => Array.from({ length: cols },
    (_, x) => term.buffer.active.getLine(y)?.getCell(x)?.isUnderline() ? "1" : "0").join("");
  const filtered = () => {
    const term = new Terminal({ cols: 30, rows: 4, allowProposedApi: true });
    const filter = hyperlinkFilter();
    term.parser.registerOscHandler(8, filter.handler);
    return Object.assign(term, { filter });
  };

  it("draws no line under a link this app cannot open, as herdr streams OmO's side panel", async () => {
    const term = filtered();
    // herdr's stream: the link stays open over the row's padding and closes on the next row
    await written(term, "\x1b]8;;omo-panel:file/.gitignore\x1b\\ M .gitignore\x1b[0;39;49m     \x1b[2;1H\x1b]8;;\x1b\\\x1b]8;;omo-panel:file/AGENTS.md\x1b\\ M AGENTS.md");
    expect(underlined(term, 0, 30)).toBe("0".repeat(30));
    expect(underlined(term, 1, 30)).toBe("0".repeat(30));
    expect(term.buffer.active.getLine(0)?.translateToString(true).trimEnd()).toBe(" M .gitignore");
  });

  it("keeps the links it opens, and an SGR underline, and drops a file link", async () => {
    const term = filtered();
    await written(term, "\x1b]8;;https://example.com\x1b\\web\x1b]8;;\x1b\\ \x1b]8;;file:///tmp/a.md\x1b\\file\x1b]8;;\x1b\\ \x1b[4mul\x1b[24m");
    expect(underlined(term, 0, 12)).toBe("111000000110");
  });

  it("lets a link that replaces an open one through, so the open one ends where it should", async () => {
    const term = filtered();
    await written(term, "\x1b]8;;https://example.com\x1b\\ab\x1b]8;;omo-panel:x\x1b\\cd\x1b]8;;\x1b\\ef\x1b]8;;omo-panel:y\x1b\\gh");
    // `cd` is a link xterm draws, as before; `gh` opens with nothing open and is dropped
    expect(underlined(term, 0, 8)).toBe("11110000");
  });

  it("starts over with the terminal when a pane change resets it under an open link", async () => {
    const term = filtered();
    await written(term, "\x1b]8;;https://example.com\x1b\\open");
    term.reset();
    term.filter.reset();
    await written(term, "\x1b]8;;omo-panel:file/a\x1b\\ M a");
    expect(underlined(term, 0, 4)).toBe("0000");
  });
});

describe("fileUriPath", () => {
  it("rejects malformed or nonlocal file URIs", () => {
    for (const uri of ["file://host/tmp/a.png", "file:///tmp/%zz", "file:///tmp/%00", "https://example.com/a.png"])
      expect(fileUriPath(uri)).toBeNull();
    // a network share on a Windows PC, however its second separator is written, and a control character
    for (const uri of ["file:////attacker.example/share/doc.txt", "file:///%2Fattacker.example/share/doc.txt", "file:///%5C%5Cattacker.example/share", "file:///tmp/a.md\u0000", "file:///tmp/a\u001b.md"])
      expect(fileUriPath(uri)).toBeNull();
    // a control character written encoded is refused too: the server trimmed `%0A` and opened /etc/hosts
    for (const uri of ["file:///etc/hosts%0A", "file:///tmp/a%1B.md", "file:///tmp/a%7F.md"]) expect(fileUriPath(uri)).toBeNull();
    // an apostrophe belongs to the name
    expect(fileUriPath("file:///tmp/Bob's-notes.md")).toBe("/tmp/Bob's-notes.md");
    // a Windows drive path loses the slash a URI puts before it
    expect(fileUriPath("file:///C:/Users/Alice/readme.md")).toBe("C:/Users/Alice/readme.md");
  });
});
