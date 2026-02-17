import type { UserStory } from '@e/shared';
import { loopStore } from './loop.svelte';
import { api } from '../api/client';

/**
 * Filter for the Work pane.
 * - 'all': show all stories grouped by parent
 * - 'standalone': show only standalone stories (no PRD)
 * - 'external': show only externally-linked stories
 * - string: a specific prdId
 */
export type WorkFilter = 'all' | 'standalone' | 'external' | (string & {});

function createWorkStore() {
  let standaloneStories = $state<UserStory[]>([]);
  let activeFilter = $state<WorkFilter>('standalone');
  let loading = $state(false);

  return {
    // --- State getters ---
    get standaloneStories() {
      return standaloneStories;
    },
    get activeFilter() {
      return activeFilter;
    },
    get loading() {
      return loading;
    },

    // --- Delegate to loopStore for PRD data ---
    get prds() {
      return loopStore.prds;
    },
    get activeLoop() {
      return loopStore.activeLoop;
    },
    get isActive() {
      return loopStore.isActive;
    },

    // --- Filter ---
    setFilter(filter: WorkFilter) {
      activeFilter = filter;
      // If setting to a PRD, also update loopStore's selectedPrdId
      if (filter !== 'all' && filter !== 'standalone' && filter !== 'external') {
        loopStore.setSelectedPrdId(filter);
      } else {
        loopStore.setSelectedPrdId(null);
      }
    },

    // --- Filtered stories ---
    get filteredStories(): UserStory[] {
      if (activeFilter === 'standalone') return standaloneStories.filter((s) => !s.externalRef);
      if (activeFilter === 'external') return standaloneStories.filter((s) => !!s.externalRef);
      if (activeFilter === 'all') {
        const prdStories = loopStore.prds.flatMap((p) => p.stories || []);
        return [...standaloneStories, ...prdStories];
      }
      // Specific PRD
      const prd = loopStore.prds.find((p) => p.id === activeFilter);
      return prd?.stories || [];
    },

    get pendingStories() {
      return this.filteredStories.filter((s) => s.status === 'pending');
    },
    get inProgressStories() {
      return this.filteredStories.filter((s) => s.status === 'in_progress');
    },
    get completedStories() {
      return this.filteredStories.filter((s) => s.status === 'completed');
    },

    get standaloneCount() {
      return standaloneStories.length;
    },

    // --- External stories ---
    get externalStories() {
      return standaloneStories.filter((s) => !!s.externalRef);
    },
    get externalCount() {
      return standaloneStories.filter((s) => !!s.externalRef).length;
    },
    get hasExternalStories() {
      return standaloneStories.some((s) => !!s.externalRef);
    },

    // --- Is the current filter a PRD? ---
    get isPrdFilter() {
      return activeFilter !== 'all' && activeFilter !== 'standalone' && activeFilter !== 'external';
    },

    // --- Data loading ---
    async loadStandaloneStories(workspacePath: string) {
      loading = true;
      try {
        const res = await api.prds.listStandaloneStories(workspacePath);
        if (res.ok) {
          standaloneStories = res.data;
        }
      } finally {
        loading = false;
      }
    },

    // --- Standalone story CRUD ---
    async createStandaloneStory(workspacePath: string, title: string, description?: string) {
      const res = await api.prds.createStandaloneStory({
        workspacePath,
        title,
        description,
      });
      if (res.ok) {
        standaloneStories = [...standaloneStories, res.data];
      }
      return res;
    },

    async updateStandaloneStory(storyId: string, updates: Record<string, any>) {
      const res = await api.prds.updateStandaloneStory(storyId, updates);
      if (res.ok) {
        standaloneStories = standaloneStories.map((s) =>
          s.id === storyId ? { ...s, ...res.data } : s,
        );
      }
      return res;
    },

    async deleteStandaloneStory(storyId: string) {
      const res = await api.prds.deleteStandaloneStory(storyId);
      if (res.ok) {
        standaloneStories = standaloneStories.filter((s) => s.id !== storyId);
      }
      return res;
    },

    async toggleStoryStatus(storyId: string, currentStatus: string, prdId: string | null) {
      const next =
        currentStatus === 'pending'
          ? 'in_progress'
          : currentStatus === 'in_progress'
            ? 'completed'
            : 'pending';

      if (prdId) {
        await api.prds.updateStory(prdId, storyId, { status: next });
        await loopStore.loadPrd(prdId);
      } else {
        await this.updateStandaloneStory(storyId, { status: next });
      }
    },

    // Update a story from a loop event (used by SSE handler)
    updateStoryStatus(storyId: string, status: string) {
      standaloneStories = standaloneStories.map((s) =>
        s.id === storyId ? { ...s, status: status as any, updatedAt: Date.now() } : s,
      );
    },

    setStandaloneStories(stories: UserStory[]) {
      standaloneStories = stories;
    },

    // --- External provider operations ---
    async importExternalIssues(
      provider: string,
      projectKey: string,
      workspacePath: string,
      issueIds?: string[],
      prdId?: string,
    ) {
      const res = await api.external.importIssues({
        provider,
        projectKey,
        workspacePath,
        issueIds,
        prdId,
      });
      if (res.ok) {
        // Refresh standalone stories to pick up the new imports
        await this.loadStandaloneStories(workspacePath);
      }
      return res;
    },

    async refreshExternalStory(storyId: string) {
      const res = await api.external.refreshStory(storyId);
      if (res.ok) {
        // Re-fetch the updated story
        const updated = standaloneStories.find((s) => s.id === storyId);
        if (updated?.workspacePath) {
          await this.loadStandaloneStories(updated.workspacePath);
        }
      }
      return res;
    },

    async refreshAllExternalStories(workspacePath: string) {
      const res = await api.external.refreshAll(workspacePath);
      if (res.ok) {
        await this.loadStandaloneStories(workspacePath);
      }
      return res;
    },
  };
}

export const workStore = createWorkStore();
