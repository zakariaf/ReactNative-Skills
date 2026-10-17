// A small static reader for the design mockup (zero dependencies): enough HTML parsing to find the
// frames (data-frame), the elements (data-testid), how they nest, and every URL the page would load.
// The mockup is static HTML and CSS by convention (texts in the markup, one block per language where
// they differ), so what this reads is what Chrome renders; a script-built mockup is checked at render
// time by shoot-design.mjs instead.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function parseAttributes(source) {
  const attrs = new Map();
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (let m = re.exec(source); m; m = re.exec(source)) attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

/**
 * Parse HTML into { root, nodes, styles, scripts }. Each node: { tag, attrs (Map), children, parent,
 * line, text (direct text) }. Comments and the doctype are skipped; <style> and <script> bodies are
 * collected (styles: [{ text, line }]); unclosed elements close at their parent's end.
 */
export function parseHtml(html) {
  const root = { tag: '#root', attrs: new Map(), children: [], parent: null, line: 1, text: '' };
  const nodes = [];
  const styles = [];
  const scripts = [];
  const stack = [root];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      stack.at(-1).text += html.slice(i);
      break;
    }
    if (lt > i) stack.at(-1).text += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt);
      const tag = html.slice(lt + 2, end === -1 ? html.length : end).trim().toLowerCase();
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const m = /^<([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(lt));
    if (!m) {
      stack.at(-1).text += '<';
      i = lt + 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    const selfClosing = /\/\s*$/.test(m[2]);
    const node = { tag, attrs: parseAttributes(m[2].replace(/\/\s*$/, '')), children: [], parent: stack.at(-1), line: lineAt(html, lt), text: '' };
    stack.at(-1).children.push(node);
    nodes.push(node);
    i = lt + m[0].length;
    if (RAW.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      const body = html.slice(i, close === -1 ? html.length : close);
      if (tag === 'style') styles.push({ text: body, line: lineAt(html, i) });
      if (tag === 'script') scripts.push({ text: body, line: lineAt(html, i), attrs: node.attrs });
      node.text = body;
      const end = close === -1 ? html.length : html.indexOf('>', close);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (!selfClosing && !VOID.has(tag)) stack.push(node);
  }
  return { root, nodes, styles, scripts };
}

/** Every descendant of a node (depth first). */
export function descendants(node) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** Is `node` inside `ancestor` (strictly)? */
export function isInside(node, ancestor) {
  for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

/**
 * Every URL the page would load, with its line: src, href (stylesheets, icons, preloads), srcset,
 * poster, inline style url(), <style> url() and @import, and script src.
 */
export function urlsOf(parsed) {
  const out = [];
  const fromCss = (css, line) => {
    for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) out.push({ url: m[2].trim(), line: line + (css.slice(0, m.index).match(/\n/g)?.length ?? 0), kind: 'css' });
    for (const m of css.matchAll(/@import\s+(['"])([^'"]+)\1/g)) out.push({ url: m[2].trim(), line: line + (css.slice(0, m.index).match(/\n/g)?.length ?? 0), kind: 'css' });
  };
  for (const node of parsed.nodes) {
    for (const key of ['src', 'href', 'poster', 'data']) {
      const value = node.attrs.get(key);
      if (value === undefined || value === '') continue;
      if (node.tag === 'a' && key === 'href') continue;
      out.push({ url: value.trim(), line: node.line, kind: node.tag });
    }
    const srcset = node.attrs.get('srcset');
    if (srcset) for (const part of srcset.split(',')) out.push({ url: part.trim().split(/\s+/)[0], line: node.line, kind: node.tag });
    const style = node.attrs.get('style');
    if (style) fromCss(style, node.line);
  }
  for (const s of parsed.styles) fromCss(s.text, s.line);
  return out;
}

/** A URL that leaves the machine (http, https, protocol-relative). */
export function isRemote(url) {
  return /^(https?:)?\/\//i.test(url);
}
