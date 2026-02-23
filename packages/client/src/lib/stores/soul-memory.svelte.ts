import type { SoulMemoryFile, SoulMemoryFileKind, SoulMemoryState } from '@e/shared';
import { SOUL_MEMORY_FILES } from '@e/shared';
import { api } from '$lib/api/client';

function createSoulMemoryStore() {
  let state = $state<SoulMemoryState | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let editingKind = $state<SoulMemoryFileKind | null>(null);
  let editContent = $state('');
  let saving = $state(false);
  let previewMode = $state(false);

  async function load(workspacePath: string) {
    if (!workspacePath) return;
    loading = true;
    error = null;
    try {
      const res = await api.soulMemory.getState(workspacePath);
      if (res.ok) {
        state = res.data;
      } else {
        error = 'Failed to load soul memory files';
      }
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  async function reload() {
    if (state?.workspacePath) {
      await load(state.workspacePath);
    }
  }

  function startEditing(kind: SoulMemoryFileKind) {
    const file = state?.files.find((f) => f.kind === kind);
    editingKind = kind;
    editContent = file?.content || '';
    previewMode = false;
  }

  function cancelEditing() {
    editingKind = null;
    editContent = '';
    previewMode = false;
  }

  async function saveEdit(workspacePath: string) {
    if (!editingKind) return;
    saving = true;
    try {
      await api.soulMemory.saveFile(editingKind, workspacePath, editContent);
      editingKind = null;
      editContent = '';
      previewMode = false;
      await load(workspacePath);
    } catch (err) {
      error = String(err);
    } finally {
      saving = false;
    }
  }

  async function initFile(kind: SoulMemoryFileKind, workspacePath: string) {
    try {
      await api.soulMemory.initFile(kind, workspacePath);
      await load(workspacePath);
    } catch (err) {
      error = String(err);
    }
  }

  function getFile(kind: SoulMemoryFileKind): SoulMemoryFile | undefined {
    return state?.files.find((f) => f.kind === kind);
  }

  function getFileDef(kind: SoulMemoryFileKind) {
    return SOUL_MEMORY_FILES.find((f) => f.kind === kind);
  }

  return {
    get state() {
      return state;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get editingKind() {
      return editingKind;
    },
    get editContent() {
      return editContent;
    },
    set editContent(v: string) {
      editContent = v;
    },
    get saving() {
      return saving;
    },
    get previewMode() {
      return previewMode;
    },
    set previewMode(v: boolean) {
      previewMode = v;
    },

    load,
    reload,
    startEditing,
    cancelEditing,
    saveEdit,
    initFile,
    getFile,
    getFileDef,
  };
}

export const soulMemoryStore = createSoulMemoryStore();
