import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Maximize2 } from "lucide-react";

import { foldCode, mathNestsTooDeep, parseMarkdown, type InlineNode, type ListBlock, type MarkdownBlock } from "../lib/markdown.ts";
import { CHAT_HIGHLIGHT_LIMIT, languageForFence } from "../lib/highlight.ts";
import { HighlightedCode } from "./HighlightedCode.tsx";
import { useT } from "../lib/i18n.ts";
import { MermaidLightbox } from "./MermaidLightbox.tsx";
import { copyText } from "../lib/clipboard.ts";
import { lazyChunk } from "../lib/lazyChunk.ts";
import "./Markdown.css";

type Katex = typeof import("katex").default;
/** KaTeX is a fifth of the app's script: the first expression loads it (lib/katex.ts), and every later one has it at once. */
let katexModule: Katex | null = null;

/**
 * KaTeX, fetched once; a static render (the unit test) waits on it to draw math.
 * Offline before it was ever fetched, or in a tab older than the server's build, every expression
 * stays in its source form and the app offers a reload (lib/lazyChunk.ts).
 */
export const loadKatex: () => Promise<Katex> = lazyChunk(() => import("../lib/katex.ts").then((module) => (katexModule = module.default)));

function useKatex(): Katex | null {
  const [katex, setKatex] = useState(katexModule);
  useEffect(() => {
    if (katex) return;
    let live = true;
    loadKatex().then((loaded) => { if (live) setKatex(loaded); }, () => {});
    return () => { live = false; };
  }, [katex]);
  return katex;
}

function MathExpression({ value, displayMode = false }: { value: string; displayMode?: boolean }) {
  const katex = useKatex();
  const source = displayMode ? `\\[${value}\\]` : `\\(${value}\\)`;
  if (!katex || mathNestsTooDeep(value)) return <span>{source}</span>;
  try {
    // KaTeX escapes text and rejects untrusted commands by default, and an unknown command
    // throws - the catch below then draws the source form. `trust` stays at its default, which
    // is what keeps \href and \includegraphics refused. `strict` only governs input LaTeX would
    // not accept: "ignore" draws Korean, Japanese or Chinese text inside an expression, which
    // `strict: true` throws on.
    const html = katex.renderToString(value, { displayMode, strict: "ignore" });
    return <span className={displayMode ? "markdown-math-display" : "markdown-math"} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <span>{source}</span>;
  }
}

type MermaidRender = typeof import("../lib/mermaid.ts").renderMermaid;

/** Mermaid, fetched once with the first diagram (lib/mermaid.ts); one that cannot load leaves diagrams as code blocks until a reload. */
const loadMermaid: () => Promise<MermaidRender> = lazyChunk(() => import("../lib/mermaid.ts").then((module) => module.renderMermaid));

/** Whether the page is drawn dark (`data-theme` on <html>, which Settings keeps current). */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== "light");
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.dataset.theme !== "light"));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** A ```mermaid fence drawn as a diagram. Until it parses (a reply still streaming, a syntax error) it shows as the code block it is. */
function MermaidDiagram({ value }: { value: string }) {
  const t = useT();
  const [svg, setSvg] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const dark = useDarkTheme();
  useEffect(() => {
    let live = true;
    // the parse runs after a pause, so a streaming block is not re-parsed on every poll
    const timer = window.setTimeout(() => {
      loadMermaid().then((render) => render(value, dark)).then(
        (markup) => { if (live) setSvg(markup); },
        () => { if (live) setSvg(null); },
      );
    }, 300);
    return () => { live = false; window.clearTimeout(timer); };
  }, [value, dark]);
  if (svg === null) return <CodeBlock language="mermaid" value={value} />;
  return (
    <div className="markdown-mermaid-frame">
      <div className="markdown-mermaid" onClick={() => setZoomed(true)} dangerouslySetInnerHTML={{ __html: svg }} />
      <button type="button" className="icon-button markdown-mermaid-zoom" onClick={() => setZoomed(true)} aria-label={t("Enlarge diagram")} title={t("Enlarge diagram")}>
        <Maximize2 aria-hidden="true" />
      </button>
      {zoomed && <MermaidLightbox svg={svg} onClose={() => setZoomed(false)} />}
    </div>
  );
}

/** `interactive` is false inside a link or file label: nothing clickable nests in another. */
function Inline({ nodes, interactive = true }: { nodes: InlineNode[]; interactive?: boolean }) {
  return <>{nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    switch (node.type) {
      case "text": return <span key={key}>{node.value}</span>;
      case "code":
        // an address in backticks stays code to the eye, and opens
        if (interactive && /^https?:\/\/\S+$/i.test(node.value)) return <a key={key} className="markdown-code-link" href={node.value} target="_blank" rel="noopener noreferrer"><code>{node.value}</code></a>;
        return <code key={key}>{node.value}</code>;
      case "math": return <MathExpression key={key} value={node.value} />;
      // an image's alt text, as a link where it has one: the page loads no image from a PC's files
      case "image": return <span key={key}><Inline nodes={node.fallback} interactive={interactive} /></span>;
      case "strong": return <strong key={key}><Inline nodes={node.children} interactive={interactive} /></strong>;
      case "em": return <em key={key}><Inline nodes={node.children} interactive={interactive} /></em>;
      case "del": return <del key={key}><Inline nodes={node.children} interactive={interactive} /></del>;
      case "link": return <a key={key} href={node.href} target="_blank" rel="noopener noreferrer"><Inline nodes={node.children} interactive={false} /></a>;
      // a file label shows its path after it, as Codex's terminal does
      case "file": return <span key={key}><Inline nodes={node.children} interactive={false} /> (<code>{node.path}</code>)</span>;
    }
  })}</>;
}

/** A list, nested lists and tables in its items; a task item's box stands in for its bullet. */
function List({ block }: { block: ListBlock }) {
  const Tag = block.ordered ? "ol" : "ul";
  const t = useT();
  const id = useId();
  return (
    <Tag className="markdown-list" start={block.ordered ? block.start : undefined}>
      {block.items.map((item, index) => (
        <li key={index} className={item.checked === undefined ? undefined : "markdown-task"}>
          {/* a task's box shows its state; the agent's text owns it, so it cannot be ticked here. Drawn,
              not an <input>: a disabled checkbox is greyed by the browser and ignores the accent. It is
              named by the item's text, or, with none (`- [ ]`), as an empty task */}
          {item.checked !== undefined && <span className="markdown-task-box" role="checkbox" aria-checked={item.checked} aria-disabled="true"
            aria-labelledby={item.content.length === 0 ? undefined : `${id}-${index}`} aria-label={item.content.length === 0 ? t("Empty task") : undefined}>{item.checked && <Check aria-hidden="true" />}</span>}
          {item.checked === undefined ? <Inline nodes={item.content} /> : <span id={`${id}-${index}`}><Inline nodes={item.content} /></span>}
          {item.blocks !== undefined && <Blocks blocks={item.blocks} />}
        </li>
      ))}
    </Tag>
  );
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const t = useT();
  const grammar = languageForFence(language);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const block = useRef<HTMLDivElement>(null);
  // no inner scroll: a long block folds, with a visible "Show all" row
  const fold = useMemo(() => foldCode(value), [value]);
  const copy = async (): Promise<void> => {
    const ok = await copyText(value);
    setCopied(ok);
    setCopyFailed(!ok);
    if (ok) window.setTimeout(() => setCopied(false), 1500);
  };
  const folding = useRef(false);
  const toggle = (): void => {
    folding.current = expanded;
    setExpanded(!expanded);
  };
  // "Show less" sits at the bottom of a long block: after folding, bring the block's top back
  // into view rather than leave the reader far below it
  useLayoutEffect(() => {
    if (!folding.current) return;
    folding.current = false;
    const node = block.current;
    if (node && node.getBoundingClientRect().top < 0) node.scrollIntoView({ block: "start" });
  }, [expanded]);
  return (
    <div className="markdown-code" ref={block} data-language={language}>
      <div className="markdown-code-header">
        <span>{language || "text"}</span>
        <button type="button" className="icon-button markdown-code-copy" onClick={() => void copy()} aria-label={t(copied ? "Code copied" : "Copy code")}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </div>
      {copyFailed && <p className="markdown-code-error" role="alert">{t("Couldn't copy. Select the text and copy it manually.")}</p>}
      <HighlightedCode code={fold !== null && !expanded ? fold.head : value} language={grammar} limit={CHAT_HIGHLIGHT_LIMIT} />
      {fold !== null && (
        <button type="button" className="markdown-code-more" aria-expanded={expanded} onClick={toggle}>
          {expanded ? t("Show less") : t("Show all {n} lines", { n: fold.lines })}
        </button>
      )}
    </div>
  );
}

function Blocks({ blocks }: { blocks: MarkdownBlock[] }) {
  return <>{blocks.map((block, index): ReactNode => {
    const key = `${block.type}-${index}`;
    switch (block.type) {
      case "heading":
        // headings are h3 whatever the text wrote: the app's own h1/h2 (Brand, the dialog
        // titles) stay the outline above them. The level rides on a class.
        return <h3 key={key} className={`markdown-h${block.level}${block.align ? " markdown-center" : ""}`}><Inline nodes={block.content} /></h3>;
      case "paragraph":
        return <p key={key} className={block.align ? "markdown-center" : undefined}>{block.lines.map((line, lineIndex) => <span key={lineIndex}><Inline nodes={line} />{lineIndex < block.lines.length - 1 && <br />}</span>)}</p>;
      case "list": return <List key={key} block={block} />;
      case "blockquote": return <blockquote key={key}><Blocks blocks={block.blocks} /></blockquote>;
      case "code": return block.language === "mermaid"
        ? <MermaidDiagram key={key} value={block.value} />
        : <CodeBlock key={key} language={block.language} value={block.value} />;
      case "math": return <MathExpression key={key} value={block.value} displayMode />;
      case "hr": return <hr key={key} />;
      case "table": return (
        <div className="markdown-table-wrap" key={key}>
          <table><thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}><Inline nodes={cell} /></th>)}</tr></thead>
            <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><Inline nodes={cell} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
  })}</>;
}

/**
 * Markdown rendered (the release notes Settings and the update notice show). Its props are
 * primitive values, so `memo` skips a parent's re-render.
 */
export const Markdown = memo(function Markdown({ children, className, html = false }: { children: string; className?: string; html?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(children, 0, html), [children, html]);
  return <ParsedMarkdown blocks={blocks} className={className} />;
});

/** Markdown parsed already, rendered as `Markdown` renders its text (the unit tests draw a parse). */
export const ParsedMarkdown = memo(function ParsedMarkdown({ blocks, className }: { blocks: MarkdownBlock[]; className?: string }) {
  return <div className={className === undefined ? "markdown" : `markdown ${className}`}><Blocks blocks={blocks} /></div>;
});
