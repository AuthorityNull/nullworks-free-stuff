/**
 * Pure HTML-to-JSX conversion and React source generation for Studio.
 * No state, no I/O - just string transforms.
 */

function escapeJsTemplateLiteral(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function camelizeStudioAttr(name) {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  const lower = raw.toLowerCase();
  const explicit = {
    class: 'className',
    for: 'htmlFor',
    tabindex: 'tabIndex',
    readonly: 'readOnly',
    maxlength: 'maxLength',
    minlength: 'minLength',
    contenteditable: 'contentEditable',
    spellcheck: 'spellCheck',
    srcset: 'srcSet',
    autocomplete: 'autoComplete',
    autofocus: 'autoFocus',
    autoplay: 'autoPlay',
    playsinline: 'playsInline',
    crossorigin: 'crossOrigin',
    referrerpolicy: 'referrerPolicy',
    inputmode: 'inputMode',
    enterkeyhint: 'enterKeyHint',
    novalidate: 'noValidate',
    rowspan: 'rowSpan',
    colspan: 'colSpan',
    cellpadding: 'cellPadding',
    cellspacing: 'cellSpacing',
    viewbox: 'viewBox',
    preserveaspectratio: 'preserveAspectRatio',
    'clip-path': 'clipPath',
    'clip-rule': 'clipRule',
    'fill-rule': 'fillRule',
    'fill-opacity': 'fillOpacity',
    'stroke-width': 'strokeWidth',
    'stroke-linecap': 'strokeLinecap',
    'stroke-linejoin': 'strokeLinejoin',
    'stroke-miterlimit': 'strokeMiterlimit',
    'stroke-dasharray': 'strokeDasharray',
    'stroke-dashoffset': 'strokeDashoffset',
    'stroke-opacity': 'strokeOpacity',
    'stop-color': 'stopColor',
    'stop-opacity': 'stopOpacity',
    xlink: 'xlinkHref',
    'xlink:href': 'xlinkHref',
    xmlnsxlink: 'xmlnsXlink',
    'xmlns:xlink': 'xmlnsXlink',
    httpequiv: 'httpEquiv',
    'http-equiv': 'httpEquiv',
  };
  if (explicit[lower]) return explicit[lower];
  if (lower.startsWith('aria-') || lower.startsWith('data-')) return lower;
  return raw.replace(/[:_-]+([a-zA-Z0-9])/g, (_, chr) => chr.toUpperCase());
}

function studioStyleToJsxObject(styleText) {
  const entries = String(styleText || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf(':');
      if (idx === -1) return null;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!key || !value) return null;
      const jsKey = camelizeStudioAttr(key);
      const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(jsKey) ? jsKey : JSON.stringify(jsKey);
      return `${safeKey}: ${JSON.stringify(value)}`;
    })
    .filter(Boolean);
  return entries.length ? `{{ ${entries.join(', ')} }}` : '{{}}';
}

function extractStudioHtmlBody(html) {
  const text = String(html || '');
  const match = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (match ? match[1] : text)
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<\/?head[^>]*>[\s\S]*?(?=<body|$)/gi, '')
    .trim();
}

function extractStudioHtmlHeadAssets(html) {
  const head = String(html || '').match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  if (!head) return '';
  const matches = [
    ...(head.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []),
    ...(head.match(/<link\b[^>]*>/gi) || []),
    ...(head.match(/<meta\b[^>]*>/gi) || []),
  ];
  return matches.join('\n');
}

function extractStudioTagAttributes(html, tagName) {
  const safeTag = String(tagName || '').trim();
  if (!safeTag) return '';
  const match = String(html || '').match(new RegExp(`<${safeTag}\\b([^>]*)>`, 'i'));
  return (match?.[1] || '').trim();
}

function sanitizeStudioHtmlSnapshotFragment(fragment) {
  return String(fragment || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/\s(on[a-z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .trim();
}

function extractStudioHtmlScripts(html) {
  const text = String(html || '');
  const scripts = [];
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(text))) {
    const attrs = String(match[1] || '').trim();
    const content = String(match[2] || '');
    scripts.push({ attrs, content });
  }
  return scripts;
}

function convertStudioHtmlFragmentToJsx(fragment) {
  let jsx = String(fragment || '');
  if (!jsx.trim()) return '<></>';

  jsx = jsx
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/\s(on[a-z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sxmlns(:[a-z-]+)?\s*=\s*("[^"]*"|'[^']*')/gi, '');

  jsx = jsx
    .replace(/\s+style\s*=\s*"([\s\S]*?)"/gi, (_, value) => ` style=${studioStyleToJsxObject(value)}`)
    .replace(/\s+style\s*=\s*'([\s\S]*?)'/gi, (_, value) => ` style=${studioStyleToJsxObject(value)}`);

  const styleBlocks = [];
  jsx = jsx.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs, css) => {
    const placeholder = `__STYLE_BLOCK_${styleBlocks.length}__`;
    styleBlocks.push(`<style${attrs || ''}>{\`${escapeJsTemplateLiteral(css)}\`}</style>`);
    return placeholder;
  });

  jsx = jsx.replace(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*?)?)>/g, (fullMatch, tagName, attrsBlock) => {
    if (!attrsBlock || !attrsBlock.trim()) return fullMatch;
    const mappedAttrs = attrsBlock.replace(/\s([A-Za-z_:][-A-Za-z0-9_:.]*)(\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g, (attrMatch, rawName, rawValue) => {
      const name = String(rawName || '');
      const lower = name.toLowerCase();
      if (lower === 'style') return attrMatch;
      if (lower.startsWith('on')) return '';
      const mapped = camelizeStudioAttr(name);
      if (!rawValue) return ` ${mapped}`;
      return ` ${mapped}${rawValue}`;
    });
    return `<${tagName}${mappedAttrs}>`;
  });

  jsx = jsx.replace(/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)([^>]*?)(?<!\/)>/gi, '<$1$2 />');

  for (let i = 0; i < styleBlocks.length; i++) {
    jsx = jsx.replace(`__STYLE_BLOCK_${i}__`, styleBlocks[i]);
  }

  return `<>\n${jsx.trim()}\n</>`;
}

function isGeneratedStudioReactRuntimeHtml(html) {
  const text = String(html || '');
  if (!text) return false;
  return (
    text.includes("https://esm.sh/react@18") ||
    text.includes("https://esm.sh/react-dom@18/client") ||
    text.includes("https://esm.sh/@babel/standalone") ||
    text.includes('[react-bootstrap-error]') ||
    text.includes('decodeBase64Utf8(')
  );
}

function isLegacyStudioReactMirrorSource(sourceContent) {
  const text = String(sourceContent || '');
  return text.includes('Legacy compatibility mirror')
    || text.includes('compatibility mirror, not a true HTML-to-React conversion')
    || text.includes('HTML mirror')
    || (text.includes('<iframe') && text.includes('src={src}'));
}

function isAutoGeneratedStudioReactSource(sourceContent) {
  const text = String(sourceContent || '');
  return text.includes('Native React bootstrap for')
    || text.includes('React snapshot bootstrap for')
    || text.includes('Generated from the saved HTML render')
    || text.includes('Preserves the saved HTML render inside a React source file')
    || isLegacyStudioReactMirrorSource(text);
}

function isLegacyStudioReactMirrorSourceV2(content) {
  const text = String(content || '');
  return text.includes('<iframe') && text.includes('HTML mirror') && !text.includes('BODY_HTML');
}

function extractStudioMirrorVersionId(content) {
  const match = String(content || '').match(/from HTML snapshot\s+(ver_[a-zA-Z0-9_]+)/);
  return match ? match[1] : null;
}

module.exports = {
  escapeJsTemplateLiteral,
  camelizeStudioAttr,
  studioStyleToJsxObject,
  extractStudioHtmlBody,
  extractStudioHtmlHeadAssets,
  extractStudioTagAttributes,
  sanitizeStudioHtmlSnapshotFragment,
  extractStudioHtmlScripts,
  convertStudioHtmlFragmentToJsx,
  isGeneratedStudioReactRuntimeHtml,
  isLegacyStudioReactMirrorSource,
  isAutoGeneratedStudioReactSource,
  isLegacyStudioReactMirrorSourceV2,
  extractStudioMirrorVersionId,
};
