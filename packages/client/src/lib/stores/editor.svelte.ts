import { api } from '$lib/api/client';
import { uiStore } from './ui.svelte';
import { uuid } from '$lib/utils/uuid';
import type { EditorConfigProps } from '@e/shared';

export interface EditorTab {
  id: string;
  filePath: string;
  fileName: string;
  language: string;
  content: string;
  originalContent: string;
  cursorLine: number;
  cursorCol: number;
  scrollTop: number;
  scrollLeft: number;
  editorConfig?: EditorConfigProps;
  /** Set to 'diff' for git diff tabs — renders diffContent instead of code editor */
  kind?: 'file' | 'diff';
  /** Raw unified diff string, only used when kind === 'diff' */
  diffContent?: string;
}

export type LayoutMode = 'chat-only' | 'editor-only' | 'split-horizontal';

function detectLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'cpp',
    h: 'cpp',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    css: 'css',
    scss: 'css',
    html: 'html',
    htm: 'html',
    svelte: 'svelte',
    vue: 'html',
    json: 'json',
    md: 'markdown',
    mdx: 'markdown',
    xml: 'xml',
    svg: 'xml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    txt: 'text',
  };
  return map[ext] || 'text';
}

export function applyEditorConfig(content: string, config: EditorConfigProps): string {
  let result = content;

  // Normalize line endings
  if (config.end_of_line === 'crlf') {
    result = result.replace(/\r\n|\r|\n/g, '\r\n');
  } else if (config.end_of_line === 'cr') {
    result = result.replace(/\r\n|\r|\n/g, '\r');
  } else if (config.end_of_line === 'lf') {
    result = result.replace(/\r\n|\r|\n/g, '\n');
  }

  // Trim trailing whitespace
  if (config.trim_trailing_whitespace) {
    const eol = config.end_of_line === 'crlf' ? '\r\n' : config.end_of_line === 'cr' ? '\r' : '\n';
    result = result
      .split(/\r\n|\r|\n/)
      .map((line) => line.replace(/[\t ]+$/, ''))
      .join(eol);
  }

  // Insert final newline
  if (config.insert_final_newline) {
    const eol = config.end_of_line === 'crlf' ? '\r\n' : config.end_of_line === 'cr' ? '\r' : '\n';
    if (result.length > 0 && !result.endsWith(eol)) {
      result += eol;
    }
  }

  return result;
}

function createEditorStore() {
  let tabs = $state<EditorTab[]>([]);
  let activeTabId = $state<string | null>(null);
  let layoutMode = $state<LayoutMode>('chat-only');
  let splitRatio = $state(0.5);
  let previewTabId = $state<string | null>(null);
  let pendingGoTo = $state<{ line: number; col: number } | null>(null);
  let followAlong = $state(true);
  /** Set when Follow Along detects a file edit — CodeEditor scrolls to this line after content sync. */
  let followAlongTarget = $state<{ filePath: string; line: number } | null>(null);

  const activeTab = $derived(tabs.find((t) => t.id === activeTabId) ?? null);
  const dirtyTabs = $derived(tabs.filter((t) => t.content !== t.originalContent));
  const hasOpenTabs = $derived(tabs.length > 0);

  function isDirty(tabId: string): boolean {
    const tab = tabs.find((t) => t.id === tabId);
    return tab ? tab.content !== tab.originalContent : false;
  }

  return {
    get tabs() {
      return tabs;
    },
    get activeTabId() {
      return activeTabId;
    },
    get activeTab() {
      return activeTab;
    },
    get layoutMode() {
      return layoutMode;
    },
    get splitRatio() {
      return splitRatio;
    },
    get previewTabId() {
      return previewTabId;
    },
    get dirtyTabs() {
      return dirtyTabs;
    },
    get hasOpenTabs() {
      return hasOpenTabs;
    },
    isDirty,

    get followAlong() {
      return followAlong;
    },
    setFollowAlong(enabled: boolean) {
      followAlong = enabled;
    },
    toggleFollowAlong() {
      followAlong = !followAlong;
    },

    get pendingGoTo() {
      return pendingGoTo;
    },
    consumePendingGoTo() {
      const val = pendingGoTo;
      pendingGoTo = null;
      return val;
    },

    /** Follow Along scroll target — set when an agent edits a file and Follow Along is on. */
    get followAlongTarget() {
      return followAlongTarget;
    },
    setFollowAlongTarget(target: { filePath: string; line: number } | null) {
      followAlongTarget = target;
    },
    consumeFollowAlongTarget() {
      const val = followAlongTarget;
      followAlongTarget = null;
      return val;
    },

    async openFile(filePath: string, preview = false, goTo?: { line: number; col: number }) {
      // Check if already open
      const existing = tabs.find((t) => t.filePath === filePath);
      if (existing) {
        activeTabId = existing.id;
        // If it was a preview tab and we're double-clicking, make it permanent
        if (previewTabId === existing.id && !preview) {
          previewTabId = null;
        }
        if (goTo) pendingGoTo = goTo;
        return;
      }

      // Fetch content
      let content = '';
      try {
        const res = await api.files.read(filePath);
        content = res.data.content;
      } catch (e) {
        uiStore.toast(`Failed to open file: ${e}`, 'error');
        return;
      }

      const fileName = filePath.split('/').pop() ?? filePath;
      const language = detectLanguage(fileName);
      const id = uuid();

      // Fetch editorconfig (non-blocking — don't fail the open if this errors)
      let editorConfig: EditorConfigProps | undefined;
      try {
        const ecRes = await api.files.editorConfig(filePath);
        if (ecRes.data && Object.keys(ecRes.data).length > 0) {
          editorConfig = ecRes.data;
        }
      } catch {
        // No .editorconfig or server error — that's fine
      }

      // Re-check after async gap — another openFile call for the same path
      // may have completed while we were fetching content / editorconfig.
      const raceWinner = tabs.find((t) => t.filePath === filePath);
      if (raceWinner) {
        activeTabId = raceWinner.id;
        if (previewTabId === raceWinner.id && !preview) {
          previewTabId = null;
        }
        if (goTo) pendingGoTo = goTo;
        return;
      }

      const tab: EditorTab = {
        id,
        filePath,
        fileName,
        language,
        content,
        originalContent: content,
        cursorLine: 1,
        cursorCol: 1,
        scrollTop: 0,
        scrollLeft: 0,
        editorConfig,
      };

      // If preview, replace existing preview tab
      if (preview && previewTabId) {
        const previewIdx = tabs.findIndex((t) => t.id === previewTabId);
        if (previewIdx >= 0) {
          tabs = [...tabs.slice(0, previewIdx), tab, ...tabs.slice(previewIdx + 1)];
          previewTabId = id;
          activeTabId = id;
          if (layoutMode === 'chat-only') {
            layoutMode = 'split-horizontal';
          }
          return;
        }
      }

      tabs = [...tabs, tab];
      activeTabId = id;
      if (preview) previewTabId = id;
      if (goTo) pendingGoTo = goTo;

      // Auto-switch to split mode on first tab
      if (layoutMode === 'chat-only') {
        layoutMode = 'split-horizontal';
      }
    },

    openDiffTab(filePath: string, diffContent: string, staged: boolean) {
      const fileName = `${filePath.split('/').pop() ?? filePath} (${staged ? 'staged' : 'unstaged'})`;
      // Reuse existing diff tab for the same file+staged combo
      const existing = tabs.find(
        (t) => t.kind === 'diff' && t.filePath === filePath && t.fileName === fileName,
      );
      if (existing) {
        existing.diffContent = diffContent;
        activeTabId = existing.id;
        tabs = [...tabs];
        if (layoutMode === 'chat-only') layoutMode = 'split-horizontal';
        return;
      }
      const id = uuid();
      const tab: EditorTab = {
        id,
        filePath,
        fileName,
        language: 'text',
        content: '',
        originalContent: '',
        cursorLine: 1,
        cursorCol: 1,
        scrollTop: 0,
        scrollLeft: 0,
        kind: 'diff',
        diffContent,
      };
      tabs = [...tabs, tab];
      activeTabId = id;
      if (layoutMode === 'chat-only') layoutMode = 'split-horizontal';
    },

    closeTab(id: string) {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;

      if (previewTabId === id) previewTabId = null;

      tabs = tabs.filter((t) => t.id !== id);

      // Update active tab
      if (activeTabId === id) {
        if (tabs.length === 0) {
          activeTabId = null;
          layoutMode = 'chat-only';
        } else {
          activeTabId = tabs[Math.min(idx, tabs.length - 1)].id;
        }
      }
    },

    async saveFile(id: string) {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      try {
        // Apply editorconfig rules before saving
        if (tab.editorConfig) {
          tab.content = applyEditorConfig(tab.content, tab.editorConfig);
        }
        await api.files.write(tab.filePath, tab.content);
        tab.originalContent = tab.content;
        tabs = [...tabs]; // trigger reactivity
        uiStore.toast(`Saved ${tab.fileName}`, 'success', 2000);
      } catch (e) {
        uiStore.toast(`Failed to save: ${e}`, 'error');
      }
    },

    updateContent(id: string, content: string) {
      const tab = tabs.find((t) => t.id === id);
      if (tab) {
        tab.content = content;
        tabs = [...tabs];
      }
    },

    setCursorPosition(id: string, line: number, col: number) {
      const tab = tabs.find((t) => t.id === id);
      if (tab) {
        tab.cursorLine = line;
        tab.cursorCol = col;
      }
    },

    setScrollPosition(id: string, top: number, left: number) {
      const tab = tabs.find((t) => t.id === id);
      if (tab) {
        tab.scrollTop = top;
        tab.scrollLeft = left;
      }
    },

    setActiveTab(id: string) {
      activeTabId = id;
    },

    setLayoutMode(mode: LayoutMode) {
      layoutMode = mode;
    },

    setSplitRatio(ratio: number) {
      splitRatio = Math.max(0.15, Math.min(0.85, ratio));
    },

    async refreshFile(filePath: string) {
      const tab = tabs.find((t) => t.filePath === filePath);
      if (!tab) return;
      try {
        const res = await api.files.read(filePath);
        const newContent = res.data.content;
        // If user hasn't modified, just update both
        if (tab.content === tab.originalContent) {
          tab.content = newContent;
          tab.originalContent = newContent;
        } else {
          // File changed externally while user has local edits — update original only
          tab.originalContent = newContent;
        }
        tabs = [...tabs];
      } catch {
        // File may have been deleted
      }
    },

    reorderTab(fromIndex: number, toIndex: number) {
      const newTabs = [...tabs];
      const [moved] = newTabs.splice(fromIndex, 1);
      newTabs.splice(toIndex, 0, moved);
      tabs = newTabs;
    },

    cycleTab(direction: 1 | -1) {
      if (tabs.length < 2) return;
      const currentIdx = tabs.findIndex((t) => t.id === activeTabId);
      const next = (currentIdx + direction + tabs.length) % tabs.length;
      activeTabId = tabs[next].id;
    },

    activateTabByIndex(index: number) {
      if (index >= 0 && index < tabs.length) {
        activeTabId = tabs[index].id;
      }
    },

    restoreState(state: {
      tabs: EditorTab[];
      activeTabId: string | null;
      layoutMode: LayoutMode;
      splitRatio: number;
      previewTabId: string | null;
    }) {
      // Deduplicate tabs by filePath (keep first occurrence)
      const seen = new Set<string>();
      tabs = state.tabs.filter((t) => {
        if (seen.has(t.filePath)) return false;
        seen.add(t.filePath);
        return true;
      });
      activeTabId = state.activeTabId;
      layoutMode = state.layoutMode;
      splitRatio = state.splitRatio;
      previewTabId = state.previewTabId;
    },
  };
}

export const editorStore = createEditorStore();
