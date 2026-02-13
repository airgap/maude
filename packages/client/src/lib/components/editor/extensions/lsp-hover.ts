import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { lspStore } from '$lib/stores/lsp.svelte';

/**
 * CM6 extension: Hover over an identifier to get type information from the LSP.
 */
export function lspHoverExtension(language: string) {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    if (!lspStore.isConnected(language)) return null;

    const line = view.state.doc.lineAt(pos);

    try {
      const result = await lspStore.request(language, 'textDocument/hover', {
        textDocument: { uri: `file://${(view.state as any)._lspUri || ''}` },
        position: {
          line: line.number - 1,
          character: pos - line.from,
        },
      });

      if (!result || !result.contents) return null;

      // Extract text content
      let content = '';
      if (typeof result.contents === 'string') {
        content = result.contents;
      } else if (Array.isArray(result.contents)) {
        content = result.contents
          .map((c: any) => (typeof c === 'string' ? c : c.value || ''))
          .join('\n');
      } else if (result.contents.value) {
        content = result.contents.value;
      }

      if (!content.trim()) return null;

      // Determine range for the tooltip
      let from = pos;
      let to = pos;
      if (result.range) {
        const startLine = view.state.doc.line(result.range.start.line + 1);
        from = startLine.from + result.range.start.character;
        const endLine = view.state.doc.line(result.range.end.line + 1);
        to = endLine.from + result.range.end.character;
      } else {
        // Expand to the word under cursor
        const lineText = line.text;
        const col = pos - line.from;
        let start = col;
        let end = col;
        while (start > 0 && /\w/.test(lineText[start - 1])) start--;
        while (end < lineText.length && /\w/.test(lineText[end])) end++;
        from = line.from + start;
        to = line.from + end;
      }

      return {
        pos: from,
        end: to,
        above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'cm-lsp-hover';
          dom.style.cssText =
            'padding: 6px 10px; font-size: 12px; font-family: var(--font-family); max-width: 500px; white-space: pre-wrap; overflow: auto; max-height: 300px;';

          // Simple rendering — code blocks get monospace
          const isMarkdown = result.contents?.kind === 'markdown' || content.includes('```');
          if (isMarkdown) {
            // Extract code blocks and render them with monospace
            const parts = content.split(/```\w*\n?/);
            parts.forEach((part: string, i: number) => {
              const el = document.createElement(i % 2 === 1 ? 'code' : 'span');
              if (i % 2 === 1) {
                el.style.cssText =
                  'display: block; padding: 4px 6px; background: var(--bg-tertiary); border-radius: 3px; margin: 2px 0;';
              }
              el.textContent = part.trim();
              if (el.textContent) dom.appendChild(el);
            });
          } else {
            dom.textContent = content;
          }

          return { dom };
        },
      };
    } catch {
      return null;
    }
  });
}
