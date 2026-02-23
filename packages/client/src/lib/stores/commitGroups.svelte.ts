/**
 * Commit groups store — manages AI-suggested commit groupings.
 *
 * Groups changed files into logical atomic commits, allows the user
 * to edit groups, drag files between them, and commit sequentially.
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

function createCommitGroupsStore() {
  let groups = $state<CommitGroup[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let commitProgress = $state<{ current: number; total: number } | null>(null);

  const hasGroups = $derived(groups.length > 0);
  const pendingGroups = $derived(groups.filter((g) => g.status === 'pending'));
  const committedGroups = $derived(groups.filter((g) => g.status === 'committed'));
  const allCommitted = $derived(groups.length > 0 && groups.every((g) => g.status === 'committed'));

  let nextId = 0;
  function genId(): string {
    return `cg-${++nextId}`;
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
      }
    },

    /**
     * Update the commit message for a group.
     */
    setMessage(groupId: string, message: string) {
      const g = groups.find((g) => g.id === groupId);
      if (g) g.message = message;
    },

    /**
     * Update the name for a group.
     */
    setName(groupId: string, name: string) {
      const g = groups.find((g) => g.id === groupId);
      if (g) g.name = name;
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
    },

    /**
     * Remove a file from a group (it will be ungrouped / left for manual staging).
     */
    removeFile(groupId: string, file: string) {
      const g = groups.find((g) => g.id === groupId);
      if (g) {
        g.files = g.files.filter((f) => f !== file);
        groups = groups.filter((g) => g.files.length > 0);
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
    },

    /**
     * Remove a group, returning its files to ungrouped.
     */
    removeGroup(groupId: string) {
      groups = groups.filter((g) => g.id !== groupId);
    },

    /**
     * Commit a single group: unstage all → stage group files → commit.
     */
    async commitGroup(workspacePath: string, groupId: string): Promise<boolean> {
      const g = groups.find((g) => g.id === groupId);
      if (!g || g.status !== 'pending') return false;
      if (!g.message.trim()) {
        g.error = 'Commit message is required';
        return false;
      }

      g.status = 'committing';
      g.error = undefined;

      try {
        // Unstage everything first
        await api.git.unstage(workspacePath);

        // Stage only this group's files
        await api.git.stage(workspacePath, g.files);

        // Commit
        const res = await api.git.commit(workspacePath, g.message);
        if (res.ok) {
          g.status = 'committed';
          // Refresh git status
          gitStore.refresh(workspacePath, { force: true });
          return true;
        } else {
          g.status = 'failed';
          g.error = ((res as Record<string, unknown>).error as string) || 'Commit failed';
          return false;
        }
      } catch (err) {
        g.status = 'failed';
        g.error = String(err);
        return false;
      }
    },

    /**
     * Commit all pending groups sequentially.
     */
    async commitAll(workspacePath: string): Promise<{ success: number; failed: number }> {
      const pending = groups.filter((g) => g.status === 'pending');
      let success = 0;
      let failed = 0;

      commitProgress = { current: 0, total: pending.length };

      for (const g of pending) {
        commitProgress = { current: success + failed + 1, total: pending.length };
        const ok = await this.commitGroup(workspacePath, g.id);
        if (ok) success++;
        else failed++;
      }

      commitProgress = null;
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
    },
  };
}

export const commitGroupsStore = createCommitGroupsStore();
