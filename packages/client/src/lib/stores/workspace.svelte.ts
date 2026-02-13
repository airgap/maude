import { editorStore, type EditorTab, type LayoutMode } from './editor.svelte';
import { uiStore, type SidebarTab } from './ui.svelte';
import { streamStore, type StreamSnapshot } from './stream.svelte';
import { searchStore } from './search.svelte';
import { terminalStore } from './terminal.svelte';
import { projectStore } from './projects.svelte';
import { conversationStore } from './conversation.svelte';
import { gitStore } from './git.svelte';
import { settingsStore } from './settings.svelte';

const STORAGE_KEY = 'maude-workspaces';

export interface WorkspaceSnapshot {
  editorTabs: EditorTab[];
  activeEditorTabId: string | null;
  layoutMode: LayoutMode;
  splitRatio: number;
  previewTabId: string | null;
  activeConversationId: string | null;
  sidebarTab: SidebarTab;
  sidebarOpen: boolean;
  streamSnapshot: StreamSnapshot | null;
  searchQuery: string;
  searchIsRegex: boolean;
  terminalOpen: boolean;
  terminalHeight: number;
}

export interface Workspace {
  projectId: string;
  projectName: string;
  projectPath: string;
  snapshot: WorkspaceSnapshot;
}

function createDefaultSnapshot(): WorkspaceSnapshot {
  return {
    editorTabs: [],
    activeEditorTabId: null,
    layoutMode: 'chat-only',
    splitRatio: 0.5,
    previewTabId: null,
    activeConversationId: null,
    sidebarTab: 'conversations',
    sidebarOpen: true,
    streamSnapshot: null,
    searchQuery: '',
    searchIsRegex: false,
    terminalOpen: false,
    terminalHeight: 250,
  };
}

interface PersistedWorkspace {
  projectId: string;
  projectName: string;
  projectPath: string;
  snapshot: {
    editorTabs: EditorTab[];
    activeEditorTabId: string | null;
    layoutMode: LayoutMode;
    splitRatio: number;
    previewTabId: string | null;
    activeConversationId: string | null;
    sidebarTab: SidebarTab;
    sidebarOpen: boolean;
    searchQuery: string;
    searchIsRegex: boolean;
    terminalOpen: boolean;
    terminalHeight: number;
  };
}

interface PersistedState {
  workspaces: PersistedWorkspace[];
  activeWorkspaceId: string | null;
}

function loadFromStorage(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveToStorage(workspaces: Workspace[], activeId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    const persisted: PersistedState = {
      activeWorkspaceId: activeId,
      workspaces: workspaces.map((w) => ({
        projectId: w.projectId,
        projectName: w.projectName,
        projectPath: w.projectPath,
        snapshot: {
          editorTabs: w.snapshot.editorTabs,
          activeEditorTabId: w.snapshot.activeEditorTabId,
          layoutMode: w.snapshot.layoutMode,
          splitRatio: w.snapshot.splitRatio,
          previewTabId: w.snapshot.previewTabId,
          activeConversationId: w.snapshot.activeConversationId,
          sidebarTab: w.snapshot.sidebarTab,
          sidebarOpen: w.snapshot.sidebarOpen,
          // Do NOT persist: streamSnapshot, search results, terminal connections
          searchQuery: w.snapshot.searchQuery,
          searchIsRegex: w.snapshot.searchIsRegex,
          terminalOpen: w.snapshot.terminalOpen,
          terminalHeight: w.snapshot.terminalHeight,
        },
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {}
}

function createWorkspaceStore() {
  let workspaces = $state<Workspace[]>([]);
  let activeWorkspaceId = $state<string | null>(null);

  const activeWorkspace = $derived(
    workspaces.find((w) => w.projectId === activeWorkspaceId) ?? null,
  );
  const hasWorkspaces = $derived(workspaces.length > 0);

  function captureSnapshot(): WorkspaceSnapshot {
    return {
      editorTabs: [...editorStore.tabs],
      activeEditorTabId: editorStore.activeTabId,
      layoutMode: editorStore.layoutMode,
      splitRatio: editorStore.splitRatio,
      previewTabId: editorStore.previewTabId,
      activeConversationId: conversationStore.activeId,
      sidebarTab: uiStore.sidebarTab,
      sidebarOpen: uiStore.sidebarOpen,
      streamSnapshot: streamStore.isStreaming ? streamStore.captureState() : null,
      searchQuery: searchStore.query,
      searchIsRegex: searchStore.isRegex,
      terminalOpen: terminalStore.isOpen,
      terminalHeight: terminalStore.panelHeight,
    };
  }

  function restoreSnapshot(snapshot: WorkspaceSnapshot) {
    editorStore.restoreState({
      tabs: snapshot.editorTabs,
      activeTabId: snapshot.activeEditorTabId,
      layoutMode: snapshot.layoutMode,
      splitRatio: snapshot.splitRatio,
      previewTabId: snapshot.previewTabId,
    });

    uiStore.restoreState({
      sidebarTab: snapshot.sidebarTab,
      sidebarOpen: snapshot.sidebarOpen,
    });

    streamStore.restoreState(snapshot.streamSnapshot);

    searchStore.restoreState({
      query: snapshot.searchQuery,
      isRegex: snapshot.searchIsRegex,
    });

    terminalStore.restoreState({
      isOpen: snapshot.terminalOpen,
      panelHeight: snapshot.terminalHeight,
    });
  }

  function persist() {
    saveToStorage(workspaces, activeWorkspaceId);
  }

  return {
    get workspaces() {
      return workspaces;
    },
    get activeWorkspaceId() {
      return activeWorkspaceId;
    },
    get activeWorkspace() {
      return activeWorkspace;
    },
    get hasWorkspaces() {
      return hasWorkspaces;
    },

    init() {
      const saved = loadFromStorage();
      if (saved && saved.workspaces.length > 0) {
        workspaces = saved.workspaces.map((pw) => ({
          ...pw,
          snapshot: {
            ...createDefaultSnapshot(),
            ...pw.snapshot,
            // Stream state is never persisted
            streamSnapshot: null,
          },
        }));
        activeWorkspaceId = saved.activeWorkspaceId;

        // Restore the active workspace
        const active = workspaces.find((w) => w.projectId === activeWorkspaceId);
        if (active) {
          restoreSnapshot(active.snapshot);
          projectStore.setActiveProjectId(active.projectId);
          gitStore.startPolling(active.projectPath);
        }
      }
    },

    openWorkspace(project: { id: string; name: string; path: string }) {
      // If already open, just switch to it
      const existing = workspaces.find((w) => w.projectId === project.id);
      if (existing) {
        this.switchWorkspace(project.id);
        return;
      }

      // Capture current workspace state before switching
      if (activeWorkspaceId) {
        const current = workspaces.find((w) => w.projectId === activeWorkspaceId);
        if (current) {
          current.snapshot = captureSnapshot();
        }
      }

      // Create new workspace
      const workspace: Workspace = {
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        snapshot: createDefaultSnapshot(),
      };

      workspaces = [...workspaces, workspace];
      activeWorkspaceId = project.id;

      // Restore the fresh snapshot (clears stores)
      restoreSnapshot(workspace.snapshot);

      // Set project context
      projectStore.setActiveProjectId(project.id);
      gitStore.stopPolling();
      gitStore.startPolling(project.path);

      // Clear conversation for new workspace
      conversationStore.setActive(null);

      persist();
    },

    switchWorkspace(projectId: string) {
      if (projectId === activeWorkspaceId) return;

      const target = workspaces.find((w) => w.projectId === projectId);
      if (!target) return;

      // 1. Capture current workspace snapshot
      if (activeWorkspaceId) {
        const current = workspaces.find((w) => w.projectId === activeWorkspaceId);
        if (current) {
          current.snapshot = captureSnapshot();
        }
      }

      // 2. Switch
      activeWorkspaceId = projectId;

      // 3. Restore target snapshot
      restoreSnapshot(target.snapshot);

      // 4. Update project store + git polling
      projectStore.setActiveProjectId(projectId);
      gitStore.stopPolling();
      gitStore.startPolling(target.projectPath);

      // 5. Restore conversation context
      if (target.snapshot.activeConversationId) {
        // The conversation will be reloaded by the chat component
        // We just clear current to trigger reload
        conversationStore.setActive(null);
      } else {
        conversationStore.setActive(null);
      }

      // 6. Refresh active editor tab if any
      if (target.snapshot.activeEditorTabId) {
        const activeTab = target.snapshot.editorTabs.find(
          (t) => t.id === target.snapshot.activeEditorTabId,
        );
        if (activeTab) {
          editorStore.refreshFile(activeTab.filePath);
        }
      }

      persist();
    },

    closeWorkspace(projectId: string) {
      const idx = workspaces.findIndex((w) => w.projectId === projectId);
      if (idx < 0) return;

      const workspace = workspaces[idx];

      // If stream is running in this workspace, abort it
      if (workspace.snapshot.streamSnapshot?.abortController) {
        workspace.snapshot.streamSnapshot.abortController.abort();
      }
      // Also check if this is the active workspace with a live stream
      if (projectId === activeWorkspaceId && streamStore.isStreaming) {
        streamStore.cancel();
      }

      workspaces = workspaces.filter((w) => w.projectId !== projectId);

      // If we closed the active workspace, switch to adjacent
      if (projectId === activeWorkspaceId) {
        if (workspaces.length > 0) {
          const nextIdx = Math.min(idx, workspaces.length - 1);
          this.switchWorkspace(workspaces[nextIdx].projectId);
        } else {
          activeWorkspaceId = null;
          // Clear all stores to empty state
          restoreSnapshot(createDefaultSnapshot());
          projectStore.setActiveProjectId(null);
          gitStore.stopPolling();
          conversationStore.setActive(null);
        }
      }

      persist();
    },

    /** Update the active workspace's snapshot without a full switch */
    updateActiveSnapshot() {
      if (!activeWorkspaceId) return;
      const current = workspaces.find((w) => w.projectId === activeWorkspaceId);
      if (current) {
        current.snapshot = captureSnapshot();
        persist();
      }
    },

    /** Check if a workspace has unsaved editor tabs */
    hasDirtyTabs(projectId: string): boolean {
      const ws = workspaces.find((w) => w.projectId === projectId);
      if (!ws) return false;
      // If it's the active workspace, check live editor state
      if (projectId === activeWorkspaceId) {
        return editorStore.dirtyTabs.length > 0;
      }
      // Otherwise check snapshot
      return ws.snapshot.editorTabs.some((t) => t.content !== t.originalContent);
    },

    /** Check if a workspace has an active stream */
    hasActiveStream(projectId: string): boolean {
      if (projectId === activeWorkspaceId) {
        return streamStore.isStreaming;
      }
      const ws = workspaces.find((w) => w.projectId === projectId);
      if (!ws) return false;
      const ss = ws.snapshot.streamSnapshot;
      return ss !== null && (ss.status === 'streaming' || ss.status === 'connecting');
    },

    /** Called when a project is deleted externally */
    onProjectDeleted(projectId: string) {
      this.closeWorkspace(projectId);
    },
  };
}

export const workspaceStore = createWorkspaceStore();
