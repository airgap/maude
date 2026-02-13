import { api } from '$lib/api/client';

export interface GitFileStatus {
  path: string;
  status: string; // M, A, D, U, R
  staged: boolean;
}

function createGitStore() {
  let isRepo = $state(false);
  let branch = $state('');
  let fileStatuses = $state<GitFileStatus[]>([]);
  let pollTimer = $state<ReturnType<typeof setInterval> | null>(null);

  function getStatus(filePath: string): string | null {
    // Match by path suffix (relativePath may differ from absolute)
    for (const f of fileStatuses) {
      if (filePath.endsWith(f.path) || f.path.endsWith(filePath.split('/').pop() ?? '')) {
        return f.status;
      }
    }
    return null;
  }

  async function refresh(rootPath: string) {
    try {
      const [statusRes, branchRes] = await Promise.all([
        api.git.status(rootPath),
        api.git.branch(rootPath),
      ]);
      isRepo = statusRes.data.isRepo;
      fileStatuses = statusRes.data.files;
      branch = branchRes.data.branch;
    } catch {
      isRepo = false;
      fileStatuses = [];
      branch = '';
    }
  }

  function startPolling(rootPath: string, interval = 5000) {
    stopPolling();
    refresh(rootPath);
    pollTimer = setInterval(() => refresh(rootPath), interval);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return {
    get isRepo() {
      return isRepo;
    },
    get branch() {
      return branch;
    },
    get fileStatuses() {
      return fileStatuses;
    },
    getStatus,
    refresh,
    startPolling,
    stopPolling,
  };
}

export const gitStore = createGitStore();
