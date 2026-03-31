import { buildArtifactPermalink } from './artifact-preview-navigation.js';

const SAFE_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const;
const ALLOWED_HTML_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'ul',
]);
const DANGEROUS_HTML_BLOCK_PATTERN =
  /<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|option|link|meta|base|svg|math)[^>]*>/gi;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const TAG_PATTERN = /<\/?([a-z0-9-]+)([^>]*)>/gi;
const HREF_ATTRIBUTE_PATTERN = /\shref\s*=\s*(['"])(.*?)\1/i;

export const MAX_INLINE_ARTIFACT_PREVIEW_BYTES = 512 * 1024;

export type ArtifactPreviewKind = 'markdown' | 'html' | 'json' | 'text' | 'binary';

export interface ArtifactPreviewDescriptor {
  kind: ArtifactPreviewKind;
  canPreview: boolean;
  language: string;
}

export function describeArtifactPreview(
  contentType: string,
  logicalPath: string,
): ArtifactPreviewDescriptor {
  const normalizedType = normalizeContentType(contentType);
  const normalizedPath = logicalPath.trim().toLowerCase();

  if (
    normalizedType === 'text/markdown' ||
    normalizedType === 'text/x-markdown' ||
    normalizedPath.endsWith('.md') ||
    normalizedPath.endsWith('.markdown')
  ) {
    return { kind: 'markdown', canPreview: true, language: 'markdown' };
  }

  if (
    normalizedType === 'text/html' ||
    normalizedType === 'application/xhtml+xml' ||
    normalizedPath.endsWith('.html') ||
    normalizedPath.endsWith('.htm')
  ) {
    return { kind: 'html', canPreview: true, language: 'html' };
  }

  if (
    normalizedType === 'application/json' ||
    normalizedType === 'application/ld+json' ||
    normalizedPath.endsWith('.json')
  ) {
    return { kind: 'json', canPreview: true, language: 'json' };
  }

  if (
    normalizedType.startsWith('text/') ||
    normalizedType === 'application/xml' ||
    normalizedType === 'text/xml' ||
    normalizedType === 'application/yaml' ||
    normalizedType === 'application/x-yaml' ||
    normalizedType === 'text/yaml' ||
    normalizedType === 'application/javascript' ||
    normalizedType === 'text/javascript' ||
    normalizedPath.endsWith('.txt') ||
    normalizedPath.endsWith('.log') ||
    normalizedPath.endsWith('.yaml') ||
    normalizedPath.endsWith('.yml') ||
    normalizedPath.endsWith('.xml') ||
    normalizedPath.endsWith('.csv') ||
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.tsx') ||
    normalizedPath.endsWith('.js') ||
    normalizedPath.endsWith('.jsx') ||
    normalizedPath.endsWith('.css') ||
    normalizedPath.endsWith('.sh')
  ) {
    return { kind: 'text', canPreview: true, language: normalizedType || 'text/plain' };
  }

  return { kind: 'binary', canPreview: false, language: normalizedType || 'application/octet-stream' };
}

export function renderArtifactPreviewMarkup(
  source: string,
  descriptor: ArtifactPreviewDescriptor,
): string {
  if (descriptor.kind === 'markdown') {
    return sanitizeHtml(renderMarkdown(source));
  }
  if (descriptor.kind === 'html') {
    return sanitizeHtml(source);
  }
  return '';
}

export function formatArtifactPreviewText(
  source: string,
  descriptor: ArtifactPreviewDescriptor,
): string {
  if (descriptor.kind !== 'json') {
    return source;
  }
  try {
    return JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    return source;
  }
}

export function sanitizeHtml(input: string): string {
  const withoutComments = input.replace(HTML_COMMENT_PATTERN, '');
  const withoutDangerousTags = withoutComments.replace(DANGEROUS_HTML_BLOCK_PATTERN, '');
  return withoutDangerousTags.replace(TAG_PATTERN, (fullMatch, tagName, rawAttributes) => {
    const normalizedTag = String(tagName).toLowerCase();
    const isClosingTag = fullMatch.startsWith('</');
    if (!ALLOWED_HTML_TAGS.has(normalizedTag)) {
      return '';
    }
    if (isClosingTag) {
      return `</${normalizedTag}>`;
    }
    if (normalizedTag !== 'a') {
      return `<${normalizedTag}>`;
    }
    const hrefMatch = String(rawAttributes).match(HREF_ATTRIBUTE_PATTERN);
    const href = hrefMatch?.[2] ?? '';
    if (!isSafeHref(href)) {
      return '<a>';
    }
    return `<a href="${escapeHtmlAttribute(href)}" rel="noopener noreferrer" target="_blank">`;
  });
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  const paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inFence = false;
  let fenceLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph.length = 0;
  };

  const flushList = () => {
    if (!listType) {
      return;
    }
    html.push(`</${listType}>`);
    listType = null;
  };

  const flushFence = () => {
    html.push(`<pre><code>${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
    fenceLines = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      flushParagraph();
      flushList();
      if (inFence) {
        flushFence();
      }
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (/^(-|\*)\s+/.test(trimmed)) {
      flushParagraph();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
        html.push('<ul>');
      }
      html.push(`<li>${renderInlineMarkdown(trimmed.replace(/^(-|\*)\s+/, ''))}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
        html.push('<ol>');
      }
      html.push(`<li>${renderInlineMarkdown(trimmed.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderInlineMarkdown(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push('<hr>');
      continue;
    }

    paragraph.push(trimmed);
  }

  if (inFence) {
    flushFence();
  }
  flushParagraph();
  flushList();

  return html.join('\n');
}

function renderInlineMarkdown(input: string): string {
  const inlineTokens: string[] = [];
  const markdownWithTokens = input
    .replace(/`([^`]+)`/g, (_match, code) =>
      createInlineToken(`<code>${escapeHtml(String(code))}</code>`, inlineTokens),
    )
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) =>
      createInlineToken(
        `<a href="${escapeHtmlAttribute(String(href).trim())}">${escapeHtml(String(label))}</a>`,
        inlineTokens,
      ),
    );
  const escaped = escapeHtml(markdownWithTokens)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return restoreInlineTokens(escaped, inlineTokens);
}

function createInlineToken(value: string, tokens: string[]): string {
  const token = `INLINE_TOKEN_${tokens.length}__`;
  tokens.push(value);
  return token;
}

function restoreInlineTokens(source: string, tokens: string[]): string {
  return tokens.reduce(
    (rendered, value, index) => rendered.replaceAll(`INLINE_TOKEN_${index}__`, value),
    source,
  );
}

function normalizeContentType(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function isSafeHref(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return SAFE_LINK_PROTOCOLS.includes(parsed.protocol as (typeof SAFE_LINK_PROTOCOLS)[number]);
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}

export { buildArtifactPermalink };
