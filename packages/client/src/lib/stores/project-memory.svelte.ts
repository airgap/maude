import type { ProjectMemory, MemoryCategory } from '@maude/shared';
import { api } from '$lib/api/client';

function createProjectMemoryStore() {
  let memories = $state<ProjectMemory[]>([]);
  let loading = $state(false);
  let currentProjectPath = $state<string | null>(null);
  let filterCategory = $state<MemoryCategory | 'all'>('all');

  const filtered = $derived(
    filterCategory === 'all' ? memories : memories.filter((m) => m.category === filterCategory),
  );

  const stats = $derived({
    total: memories.length,
    auto: memories.filter((m) => m.source === 'auto').length,
    manual: memories.filter((m) => m.source === 'manual').length,
    byCategory: Object.fromEntries(
      (['convention', 'decision', 'preference', 'pattern', 'context'] as const).map((cat) => [
        cat,
        memories.filter((m) => m.category === cat).length,
      ]),
    ),
  });

  return {
    get memories() {
      return filtered;
    },
    get allMemories() {
      return memories;
    },
    get loading() {
      return loading;
    },
    get stats() {
      return stats;
    },
    get filterCategory() {
      return filterCategory;
    },
    get currentProjectPath() {
      return currentProjectPath;
    },

    setFilter(cat: MemoryCategory | 'all') {
      filterCategory = cat;
    },

    async load(projectPath: string) {
      currentProjectPath = projectPath;
      loading = true;
      try {
        const res = await api.projectMemory.list(projectPath);
        memories = res.data;
      } catch {
        memories = [];
      }
      loading = false;
    },

    async create(body: {
      projectPath: string;
      category: MemoryCategory;
      key: string;
      content: string;
    }) {
      try {
        await api.projectMemory.create({ ...body, source: 'manual', confidence: 1.0 });
        if (currentProjectPath === body.projectPath) {
          await this.load(body.projectPath);
        }
        return true;
      } catch {
        return false;
      }
    },

    async update(id: string, body: Record<string, any>) {
      try {
        await api.projectMemory.update(id, body);
        if (currentProjectPath) await this.load(currentProjectPath);
        return true;
      } catch {
        return false;
      }
    },

    async remove(id: string) {
      try {
        await api.projectMemory.delete(id);
        memories = memories.filter((m) => m.id !== id);
        return true;
      } catch {
        return false;
      }
    },

    async search(q: string) {
      if (!currentProjectPath) return [];
      try {
        const res = await api.projectMemory.search(currentProjectPath, q);
        return res.data as ProjectMemory[];
      } catch {
        return [];
      }
    },

    async extractFromConversation(
      projectPath: string,
      messages: Array<{ role: string; content: string }>,
    ) {
      try {
        const res = await api.projectMemory.extract(projectPath, messages);
        if (res.data.created > 0 && currentProjectPath === projectPath) {
          await this.load(projectPath);
        }
        return res.data;
      } catch {
        return { extracted: 0, created: 0 };
      }
    },
  };
}

export const projectMemoryStore = createProjectMemoryStore();
