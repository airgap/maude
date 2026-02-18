<script lang="ts">
  import { onMount } from 'svelte';
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
    highlightSpecialChars,
  } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import {
    indentOnInput,
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentUnit,
  } from '@codemirror/language';
  import {
    closeBrackets,
    closeBracketsKeymap,
    autocompletion,
    snippetCompletion,
    type CompletionContext,
    type CompletionResult,
  } from '@codemirror/autocomplete';
  import {
    searchKeymap,
    highlightSelectionMatches,
    selectNextOccurrence,
  } from '@codemirror/search';
  import { lintKeymap } from '@codemirror/lint';
  import { eEditorTheme, eSyntaxHighlighting } from './e-cm-theme';
  import { loadLanguage } from './language-map';
  import { editorStore, type EditorTab } from '$lib/stores/editor.svelte';
  import { symbolStore } from '$lib/stores/symbols.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import { gotoDefinitionExtension } from './extensions/goto-definition';
  import { lspCompletionSource } from './extensions/lsp-completions';
  import { lspDiagnosticsExtension } from './extensions/lsp-diagnostics';
  import { lspHoverExtension } from './extensions/lsp-hover';
  import { fileUriField } from './extensions/file-uri-field';
  import { hoverHighlightExtension } from './extensions/hover-highlight';

  let { tab } = $props<{ tab: EditorTab }>();

  let container: HTMLDivElement;
  let view: EditorView | null = null;
  let currentTabId = '';
  // Track whether the update is coming from our own sync (to prevent loops)
  let updatingFromStore = false;

  const jsSnippets = [
    snippetCompletion('if (${condition}) {\n\t${}\n}', {
      label: 'if',
      detail: 'if block',
      type: 'keyword',
    }),
    snippetCompletion('for (let ${i} = 0; ${i} < ${length}; ${i}++) {\n\t${}\n}', {
      label: 'for',
      detail: 'for loop',
      type: 'keyword',
    }),
    snippetCompletion('function ${name}(${params}) {\n\t${}\n}', {
      label: 'function',
      detail: 'function declaration',
      type: 'keyword',
    }),
    snippetCompletion('const ${name} = (${params}) => {\n\t${}\n};', {
      label: 'arrow',
      detail: 'arrow function',
      type: 'keyword',
    }),
    snippetCompletion('try {\n\t${}\n} catch (${err}) {\n\t${}\n}', {
      label: 'try',
      detail: 'try-catch block',
      type: 'keyword',
    }),
    snippetCompletion('console.log(${});', {
      label: 'log',
      detail: 'console.log',
      type: 'function',
    }),
  ];

  const genericSnippets = [
    snippetCompletion('if (${condition}) {\n\t${}\n}', {
      label: 'if',
      detail: 'if block',
      type: 'keyword',
    }),
    snippetCompletion('for (${init}; ${cond}; ${step}) {\n\t${}\n}', {
      label: 'for',
      detail: 'for loop',
      type: 'keyword',
    }),
  ];

  function snippetSource(ctx: CompletionContext): CompletionResult | null {
    const word = ctx.matchBefore(/\w+/);
    if (!word && !ctx.explicit) return null;
    const lang = tab.language;
    const builtIn = lang === 'javascript' || lang === 'typescript' ? jsSnippets : genericSnippets;
    const custom = (settingsStore.customSnippets[lang] || []).map((s) =>
      snippetCompletion(s.body, { label: s.prefix, detail: s.description, type: 'snippet' }),
    );
    return { from: word?.from ?? ctx.pos, options: [...builtIn, ...custom] };
  }

  function fileUri(): string {
    const p = tab.filePath;
    if (!p) return '';
    // Normalise to file:///absolute/path (already absolute on Linux/Mac)
    return p.startsWith('file://') ? p : `file://${p}`;
  }

  function createExtensions(languageSupport?: any) {
    const ec = tab.editorConfig;
    const exts = [
      // Stores the file URI so lsp-hover and lsp-completions can reference it
      fileUriField.init(() => fileUri()),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      eEditorTheme,
      eSyntaxHighlighting,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...lintKeymap,
        indentWithTab,
        { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
        {
          key: 'Mod-s',
          run: () => {
            editorStore.saveFile(tab.id);
            return true;
          },
        },
      ]),
      autocompletion({
        override: [
          ...(lspStore.isConnected(tab.language) ? [lspCompletionSource(tab.language)] : []),
          snippetSource,
        ],
      }),
      EditorView.updateListener.of((update) => {
        if (updatingFromStore) return;
        if (update.docChanged) {
          const content = update.state.doc.toString();
          editorStore.updateContent(tab.id, content);
          // Trigger tree-sitter parse (debounced)
          symbolStore.requestParse(tab.id, content, tab.language);
          // Notify LSP of changes
          if (lspStore.isConnected(tab.language)) {
            lspStore.sendDidChange(tab.language, tab.filePath, content);
          }
        }
        if (update.selectionSet) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          editorStore.setCursorPosition(tab.id, line.number, pos - line.from + 1);
        }
      }),
      // Tree-sitter powered extensions
      gotoDefinitionExtension(tab.id, tab.language),
      // Unified hover: LSP first, tree-sitter fallback if LSP is absent or returns nothing
      lspHoverExtension(tab.language, tab.id),
      // Highlight all occurrences of the word under the cursor on hover
      hoverHighlightExtension(),
      // LSP diagnostics (only when connected)
      ...(lspStore.isConnected(tab.language) ? [lspDiagnosticsExtension(tab.language)] : []),
    ];

    if (languageSupport) {
      exts.push(languageSupport);
    }

    // Apply editorconfig settings
    if (ec) {
      exts.push(EditorState.tabSize.of(ec.tab_width ?? ec.indent_size ?? 4));
      exts.push(indentUnit.of(ec.indent_style === 'tab' ? '\t' : ' '.repeat(ec.indent_size ?? 4)));
    }

    return exts;
  }

  async function initEditor() {
    if (!container) return;
    if (view) {
      view.destroy();
      view = null;
    }

    const langSupport = await loadLanguage(tab.language);

    const state = EditorState.create({
      doc: tab.content,
      extensions: createExtensions(langSupport),
    });

    view = new EditorView({
      state,
      parent: container,
    });

    currentTabId = tab.id;

    // Trigger initial tree-sitter parse
    symbolStore.parseFull(tab.id, tab.content, tab.language);

    // Auto-connect LSP if a server is available
    if (!lspStore.isConnected(tab.language)) {
      lspStore.ensureConnection(tab.language, settingsStore.workspacePath);
    }

    // Notify LSP of file open
    if (lspStore.isConnected(tab.language)) {
      lspStore.sendDidOpen(tab.language, tab.filePath, tab.content, tab.language);
    }
  }

  // React to tab changes
  $effect(() => {
    if (tab.id !== currentTabId && container) {
      initEditor();
    }
  });

  // Reinitialize editor when LSP connects (to pick up LSP extensions)
  let wasLspConnected = false;
  $effect(() => {
    const connected = lspStore.isConnected(tab.language);
    if (connected && !wasLspConnected && view) {
      wasLspConnected = connected;
      // Reinitialize to pick up LSP extensions (completions, hover, diagnostics)
      initEditor();
    }
    wasLspConnected = connected;
  });

  // Sync content from store → editor when external changes happen (e.g. refreshFile)
  $effect(() => {
    const content = tab.content;
    if (view && currentTabId === tab.id) {
      const currentDoc = view.state.doc.toString();
      if (content !== currentDoc) {
        updatingFromStore = true;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
        });
        updatingFromStore = false;
      }
    }
  });

  // Handle pending goto-definition scroll after file opens
  $effect(() => {
    const goTo = editorStore.pendingGoTo;
    if (goTo && view && currentTabId === tab.id) {
      const target = editorStore.consumePendingGoTo();
      if (target) {
        const lineCount = view.state.doc.lines;
        if (target.line >= 1 && target.line <= lineCount) {
          const docLine = view.state.doc.line(target.line);
          const pos = docLine.from + Math.min(target.col - 1, docLine.length);
          view.dispatch({
            selection: { anchor: pos },
            scrollIntoView: true,
          });
          editorStore.setCursorPosition(tab.id, target.line, target.col);
        }
      }
    }
  });

  onMount(() => {
    // Load server info so StatusBar can show install prompts
    lspStore.loadServerInfo();
    initEditor();
    return () => {
      // Notify LSP of file close
      if (lspStore.isConnected(tab.language)) {
        lspStore.sendDidClose(tab.language, tab.filePath);
      }
      if (view) {
        view.destroy();
        view = null;
      }
    };
  });
</script>

<div class="code-editor" bind:this={container}></div>

<style>
  .code-editor {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .code-editor :global(.cm-editor) {
    height: 100%;
  }
  .code-editor :global(.cm-scroller) {
    overflow: auto;
  }
</style>
