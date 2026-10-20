/** The links a terminal draws: web addresses, opened in a new tab, and nothing else. */

/**
 * A URI this app opens in a new tab: an http(s) address and nothing else. Both link paths in
 * PaneTerminal answer to it, so a line crafted to look like a link cannot hand the browser a
 * scheme of its own choosing (`javascript:`, `data:`, an OS handler).
 */
export function isWebLink(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

/**
 * Opens an http(s) address in a new tab: a link's own click, with no opener
 * and no referrer. window.open with a features string (even "noopener") opens a popup window instead.
 */
export function openWebLink(uri: string): void {
  const link = document.createElement("a");
  link.href = uri;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
}

/** The local path a file URI names (Markdown reads file links with it), or null. */
export function fileUriPath(uri: string): string | null {
  // a control character belongs to no path, and URL drops a trailing one before it can be seen
  if (!/^file:\/\/\//i.test(uri) || /[\u0000-\u001f\u007f]/.test(uri)) return null;
  try {
    const url = new URL(uri);
    if (url.host || url.search || url.hash) return null;
    const path = decodeURIComponent(url.pathname);
    // two separators in front name a network share on a Windows PC, however the second was written
    if (/[\u0000-\u001f\u007f]/.test(path) || /^[\\/]{2}/.test(path)) return null;
    // `/C:/Users/me/a.md` is how a URI writes a Windows drive path
    return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path;
  } catch {
    return null; // malformed URI input is not a file link
  }
}

/**
 * The OSC 8 handler that keeps a hyperlink this app cannot open from being drawn as one (#739).
 * xterm underlines every linked cell with a dashed line, and herdr's attach stream keeps a row's
 * link open over the padding after its text, so OmO's side panel (`omo-panel:` links, which only
 * OmO's own mouse handling follows) showed a dotted rule under every file row to the panel's edge.
 * Here such a link opens nothing (the link handler takes http(s) addresses only), so its
 * opening is swallowed. Not while a link xterm holds is still open: xterm ends that one only on
 * the next OSC 8 it is handed, and it would run on over the new link's text.
 * `handler` answers true to swallow the sequence, false to hand it to xterm; `reset` goes with
 * `term.reset()`, which ends xterm's open link too.
 */
export function hyperlinkFilter(): { handler: (payload: string) => boolean; reset: () => void } {
  let open = false;
  return {
    handler: (payload) => {
      const separator = payload.indexOf(";");
      if (separator === -1) return false; // malformed: xterm ignores it, and so does `open`
      const uri = payload.slice(separator + 1);
      if (uri !== "" && !open && !isWebLink(uri)) return true;
      open = uri !== "";
      return false;
    },
    reset: () => { open = false; },
  };
}
