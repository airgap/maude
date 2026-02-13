import { hoverTooltip, type Tooltip } from '@codemirror/view';
import { symbolStore } from '$lib/stores/symbols.svelte';
import type { Symbol } from '$lib/workers/treesitter-worker';

/**
 * CM6 extension: Hover over an identifier to see its type/kind.
 */
export function hoverInfoExtension(fileId: string) {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    const line = view.state.doc.lineAt(pos);
    const lineText = line.text;
    const col = pos - line.from;

    // Find the word under cursor
    let start = col;
    let end = col;
    while (start > 0 && /\w/.test(lineText[start - 1])) start--;
    while (end < lineText.length && /\w/.test(lineText[end])) end++;
    if (start === end) return null;

    const word = lineText.slice(start, end);
    if (!word) return null;

    // Look up the symbol
    const symbols = symbolStore.getSymbols(fileId);
    const found = findSymbolByName(symbols, word);
    if (!found) return null;

    return {
      pos: line.from + start,
      end: line.from + end,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-hover-info';
        dom.style.cssText =
          'padding: 4px 8px; font-size: 12px; font-family: var(--font-family); max-width: 400px;';

        const kindSpan = document.createElement('span');
        kindSpan.style.cssText = 'color: var(--syn-keyword); margin-right: 6px; font-weight: 600;';
        kindSpan.textContent = found.kind;
        dom.appendChild(kindSpan);

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'color: var(--syn-function);';
        nameSpan.textContent = found.name;
        dom.appendChild(nameSpan);

        const lineSpan = document.createElement('span');
        lineSpan.style.cssText = 'color: var(--text-tertiary); margin-left: 8px; font-size: 11px;';
        lineSpan.textContent = `line ${found.startRow + 1}`;
        dom.appendChild(lineSpan);

        return { dom };
      },
    };
  });
}

function findSymbolByName(symbols: Symbol[], name: string): Symbol | null {
  for (const sym of symbols) {
    if (sym.name === name) return sym;
    if (sym.children) {
      const found = findSymbolByName(sym.children, name);
      if (found) return found;
    }
  }
  return null;
}
