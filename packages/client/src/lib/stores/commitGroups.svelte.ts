/**
 * Commit groups store — manages AI-suggested commit groupings.
 *
 * Groups changed files into logical atomic commits, allows the user
 * to edit groups, drag files between them, and commit sequentially.
 *
 * State is persisted to sessionStorage so it survives HMR reloads
 * (which happen every time a commit changes watched files).
 */

import { api } from '$lib/api/client';
import { gitStore } from '$lib/stores/git.svelte';

export interface CommitGroup {
  id: string;
  name: string;
  message: string;
  files: string[];
  reason: string;
  status: 'pending' | 'committing' | 'committed' | 'failed';
  error?: string;
}

const STORAGE_KEY = 'e:commit-groups';

interface PersistedState {
  groups: CommitGroup[];
  error: string | null;
  nextId: number;
  /** When set, a "commit all" batch was in progress and should auto-resume. */
  batchWorkspacePath?: string | null;
}

function saveState(state: PersistedState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded or unavailable — ignore
  }
}

function loadState(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    // Reset any groups stuck in 'committing' back to 'pending'
    // (the commit was interrupted by the reload) and clear their errors
    for (const g of parsed.groups) {
      if (g.status === 'committing') {
        g.status = 'pending';
        g.error = undefined;
      }
    }
    // Also clear transient errors on failed groups caused by aborted requests
    // (e.g. HMR reload interrupted the fetch mid-flight)
    for (const g of parsed.groups) {
      if (g.status === 'failed' && g.error?.includes('connect to server')) {
        g.status = 'pending';
        g.error = undefined;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function createCommitGroupsStore() {
  const restored = loadState();

  let groups = $state<CommitGroup[]>(restored?.groups ?? []);
  let loading = $state(false);
  let error = $state<string | null>(restored?.error ?? null);
  let commitProgress = $state<{ current: number; total: number } | null>(null);
  /** Workspace path for an in-progress batch — persisted so we can resume after HMR. */
  let batchWorkspacePath: string | null = restored?.batchWorkspacePath ?? null;

  const hasGroups = $derived(groups.length > 0);
  const pendingGroups = $derived(groups.filter((g) => g.status === 'pending'));
  const committedGroups = $derived(groups.filter((g) => g.status === 'committed'));
  const allCommitted = $derived(groups.length > 0 && groups.every((g) => g.status === 'committed'));

  let nextId = restored?.nextId ?? 0;
  function genId(): string {
    return `cg-${++nextId}`;
  }

  /** Persist current state to sessionStorage. */
  function persist(): void {
    saveState({ groups, error, nextId, batchWorkspacePath });
  }

  return {
    get groups() {
      return groups;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get hasGroups() {
      return hasGroups;
    },
    get pendingGroups() {
      return pendingGroups;
    },
    get committedGroups() {
      return committedGroups;
    },
    get allCommitted() {
      return allCommitted;
    },
    get commitProgress() {
      return commitProgress;
    },

    /**
     * Request AI-suggested commit groups from the server.
     */
    async suggest(workspacePath: string): Promise<void> {
      loading = true;
      error = null;
      groups = [];

      try {
        const res = await api.git.suggestCommitGroups(workspacePath);
        if (res.ok && res.data?.groups) {
          groups = res.data.groups.map((g) => ({
            id: genId(),
            name: g.name,
            message: g.message,
            files: [...g.files],
            reason: g.reason,
            status: 'pending' as const,
          }));
        } else {
          error = res.error || 'Failed to get suggestions';
        }
      } catch (err) {
        error = String(err);
      } finally {
        loading = false;
        persist();
      }
    },

    /**
     * Update the commit message for a group.
     */
    setMessage(groupId: string, message: string) {
      const g = groups.find((g) => g.id === groupId);
      if (g) {
        g.message = message;
        persist();
      }
    },

    /**
     * Update the name for a group.
     */
    setName(groupId: string, name: string) {
      const g = groups.find((g) => g.id === groupId);
      if (g) {
        g.name = name;
        persist();
      }
    },

    /**
     * Move a file from one group to another.
     */
    moveFile(file: string, fromGroupId: string, toGroupId: string) {
      const from = groups.find((g) => g.id === fromGroupId);
      const to = groups.find((g) => g.id === toGroupId);
      if (!from || !to) return;

      from.files = from.files.filter((f) => f !== file);
      to.files = [...to.files, file];

      // Remove empty groups
      groups = groups.filter((g) => g.files.length > 0);
      persist();
    },

    /**
     * Remove a file from a group (it will be ungrouped / left for manual staging).
     */
    removeFile(groupId: string, file: string) {
      const g = groups.find((g) => g.id === groupId);
      if (g) {
        g.files = g.files.filter((f) => f !== file);
        groups = groups.filter((g) => g.files.length > 0);
        persist();
      }
    },

    /**
     * Add a new empty group.
     */
    addGroup(name: string = 'New group') {
      groups = [
        ...groups,
        {
          id: genId(),
          name,
          message: '',
          files: [],
          reason: 'User-created group',
          status: 'pending',
        },
      ];
      persist();
    },

    /**
     * Remove a group, returning its files to ungrouped.
     */
    removeGroup(groupId: string) {
      groups = groups.filter((g) => g.id !== groupId);
      persist();
    },

    /**
     * Commit a single group: unstage all -> stage group files -> commit.
     */
    async commitGroup(workspacePath: string, groupId: string): Promise<boolean> {
      const g = groups.find((g) => g.id === groupId);
      if (!g || g.status !== 'pending') return false;
      if (!g.message.trim()) {
        g.error = 'Commit message is required';
        persist();
        return false;
      }

      g.status = 'committing';
      g.error = undefined;
      persist();

      try {
        // Unstage everything first
        const unstageRes = await api.git.unstage(workspacePath);
        if (!unstageRes.ok) {
          g.status = 'failed';
          g.error = `Unstage failed: ${(unstageRes as Record<string, unknown>).error || 'unknown error'}`;
          persist();
          return false;
        }

        // Stage only this group's files
        const stageRes = await api.git.stage(workspacePath, g.files);
        if (!stageRes.ok) {
          g.status = 'failed';
          g.error = `Stage failed: ${(stageRes as Record<string, unknown>).error || 'unknown error'} — check that file paths are correct`;
          persist();
          return false;
        }

        // Commit with noAutoStage to prevent accidentally committing
        // files outside this group if staging silently failed
        const res = await api.git.commit(workspacePath, g.message, { noAutoStage: true });
        if (res.ok) {
          g.status = 'committed';
          // Refresh git status
          gitStore.refresh(workspacePath, { force: true });
          persist();
          return true;
        } else {
          g.status = 'failed';
          g.error = ((res as Record<string, unknown>).error as string) || 'Commit failed';
          persist();
          return false;
        }
      } catch (err) {
        g.status = 'failed';
        g.error = String(err);
        persist();
        return false;
      }
    },

    /**
     * Commit all pending groups sequentially.
     *
     * Persists the batch-in-progress state so that if an HMR reload kills
     * this loop mid-flight, it auto-resumes when the store re-initializes.
     */
    async commitAll(workspacePath: string): Promise<{ success: number; failed: number }> {
      const pending = groups.filter((g) => g.status === 'pending');
      let success = 0;
      let failed = 0;

      // Mark batch in progress so we can resume after HMR
      batchWorkspacePath = workspacePath;
      persist();

      commitProgress = { current: 0, total: pending.length };

      for (const g of pending) {
        commitProgress = { current: success + failed + 1, total: pending.length };
        const ok = await this.commitGroup(workspacePath, g.id);
        if (ok) success++;
        else failed++;
      }

      // Batch complete — clear resume marker
      batchWorkspacePath = null;
      commitProgress = null;
      persist();
      return { success, failed };
    },

    /**
     * Clear all groups and reset state.
     */
    clear() {
      groups = [];
      loading = false;
      error = null;
      commitProgress = null;
      batchWorkspacePath = null;
      persist();
    },

    /**
     * Resume an interrupted "commit all" batch (e.g. after HMR reload).
     * Called automatically on store init when persisted state indicates
     * a batch was in progress.
     */
    async resumeBatch(): Promise<void> {
      const wp = batchWorkspacePath;
      if (!wp) return;
      const remaining = groups.filter((g) => g.status === 'pending');
      if (remaining.length === 0) {
        // Nothing left to commit — batch must have finished right before reload
        batchWorkspacePath = null;
        persist();
        return;
      }
      console.log(
        '[commit-groups] Resuming interrupted batch: %d groups remaining',
        remaining.length,
      );
      await this.commitAll(wp);
    },
  };
}

export const commitGroupsStore = createCommitGroupsStore();

// Auto-resume interrupted batch after HMR reload.
// Deferred to the next microtask so the store is fully initialized
// and Svelte's reactivity is wired up before we start committing.
if (commitGroupsStore.pendingGroups.length > 0) {
  queueMicrotask(() => {
    commitGroupsStore.resumeBatch();
  });
}
