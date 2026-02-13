import { api } from '$lib/api/client';
import { settingsStore } from './settings.svelte';
import type { ProjectSummary } from '@maude/shared';

function createProjectStore() {
  let projects = $state<ProjectSummary[]>([]);
  let activeProjectId = $state<string | null>(null);
  let loading = $state(false);

  const activeProject = $derived(projects.find((p) => p.id === activeProjectId) ?? null);

  return {
    get projects() {
      return projects;
    },
    get activeProjectId() {
      return activeProjectId;
    },
    get activeProject() {
      return activeProject;
    },
    get loading() {
      return loading;
    },

    async loadProjects() {
      loading = true;
      try {
        const res = await api.projects.list();
        projects = res.data;
      } catch {
        projects = [];
      }
      loading = false;
    },

    async createProject(name: string, path: string) {
      try {
        const res = await api.projects.create({ name, path });
        await this.loadProjects();
        activeProjectId = res.data.id;
        settingsStore.update({ projectPath: path });
        return res.data.id;
      } catch (e) {
        throw e;
      }
    },

    async switchProject(id: string) {
      const project = projects.find((p) => p.id === id);
      if (!project) return;

      activeProjectId = id;
      settingsStore.update({ projectPath: project.path });

      // Update last-opened
      try {
        await api.projects.open(id);
      } catch {}
    },

    clearActiveProject() {
      activeProjectId = null;
    },

    async deleteProject(id: string) {
      try {
        await api.projects.delete(id);
        if (activeProjectId === id) activeProjectId = null;
        await this.loadProjects();
      } catch {}
    },

    setActiveProjectId(id: string | null) {
      activeProjectId = id;
      if (id) {
        const project = projects.find((p) => p.id === id);
        if (project) {
          settingsStore.update({ projectPath: project.path });
        }
      }
    },
  };
}

export const projectStore = createProjectStore();
