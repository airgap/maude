import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked for GFM
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Full markdown render with sanitization.
 * Used for completed messages.
 */
export async function renderMarkdown(source: string): Promise<string> {
  const raw = await marked.parse(source);
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['svg', 'path', 'line', 'rect', 'circle'],
    ADD_ATTR: ['viewBox', 'fill', 'stroke', 'stroke-width', 'd', 'x', 'y', 'width', 'height', 'rx', 'data-language', 'data-file-path'],
  });
}

/**
 * Fast synchronous partial render for streaming.
 * Handles basic markdown without full AST parsing.
 */
export function renderMarkdownPartial(source: string): string {
  if (!source) return '';

  let html = escapeHtml(source);

  // Fenced code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    return `<div class="code-block-wrapper" data-language="${lang || 'text'}"><pre><code>${code}</code></pre></div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p>');

  // Single newlines
  html = html.replace(/\n/g, '<br>');

  return `<p>${html}</p>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
