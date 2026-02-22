/** Shared store for tracking ongoing git operations across all UI components */

export interface GitOperation {
  type: 'commit' | 'push';
  progress: string[];
  error: string | null;
  inProgress: boolean;
  timestamp: number;
}

function createGitOperationsStore() {
  let commitOperation = $state<GitOperation>({
    type: 'commit',
    progress: [],
    error: null,
    inProgress: false,
    timestamp: 0,
  });

  let pushOperation = $state<GitOperation>({
    type: 'push',
    progress: [],
    error: null,
    inProgress: false,
    timestamp: 0,
  });

  return {
    get commitOperation() {
      return commitOperation;
    },
    get pushOperation() {
      return pushOperation;
    },
    get hasActiveOperation() {
      return commitOperation.inProgress || pushOperation.inProgress;
    },

    startCommit() {
      commitOperation = {
        type: 'commit',
        progress: [],
        error: null,
        inProgress: true,
        timestamp: Date.now(),
      };
    },

    addCommitProgress(message: string) {
      if (commitOperation.inProgress) {
        commitOperation.progress = [...commitOperation.progress, message];
      }
    },

    setCommitError(error: string) {
      commitOperation.error = error;
    },

    endCommit(success: boolean) {
      commitOperation.inProgress = false;
      if (success && !commitOperation.error) {
        // Auto-clear successful commits after 2 seconds
        setTimeout(() => {
          if (!commitOperation.error) {
            commitOperation = {
              type: 'commit',
              progress: [],
              error: null,
              inProgress: false,
              timestamp: 0,
            };
          }
        }, 2000);
      }
    },

    startPush() {
      pushOperation = {
        type: 'push',
        progress: [],
        error: null,
        inProgress: true,
        timestamp: Date.now(),
      };
    },

    addPushProgress(message: string) {
      if (pushOperation.inProgress) {
        pushOperation.progress = [...pushOperation.progress, message];
      }
    },

    setPushError(error: string) {
      pushOperation.error = error;
    },

    endPush(success: boolean) {
      pushOperation.inProgress = false;
      if (success && !pushOperation.error) {
        // Auto-clear successful pushes after 2 seconds
        setTimeout(() => {
          if (!pushOperation.error) {
            pushOperation = {
              type: 'push',
              progress: [],
              error: null,
              inProgress: false,
              timestamp: 0,
            };
          }
        }, 2000);
      }
    },

    clearCommit() {
      commitOperation = {
        type: 'commit',
        progress: [],
        error: null,
        inProgress: false,
        timestamp: 0,
      };
    },

    clearPush() {
      pushOperation = {
        type: 'push',
        progress: [],
        error: null,
        inProgress: false,
        timestamp: 0,
      };
    },

    clearAll() {
      this.clearCommit();
      this.clearPush();
    },
  };
}

export const gitOperationsStore = createGitOperationsStore();
