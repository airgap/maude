// ---------------------------------------------------------------------------
// Worktree types — shared between server and client
// ---------------------------------------------------------------------------

/** Information about a single git worktree. */
export interface WorktreeInfo {
  /** Absolute filesystem path to the worktree. */
  path: string;
  /** Branch checked out in this worktree (e.g. "story/add-auth"). */
  branch: string | null;
  /** HEAD commit SHA. */
  head: string;
  /** Story ID extracted from branch name (null for non-story branches). */
  storyId: string | null;
  /** Whether this is the main (bare) worktree. */
  isMain: boolean;
  /** Whether the worktree is locked (git worktree lock). */
  isLocked: boolean;
  /** Whether the worktree has uncommitted changes. */
  isDirty: boolean;
}

/** Options for creating a new worktree. */
export interface WorktreeCreateOptions {
  /** Absolute path to the workspace/repo root. */
  workspacePath: string;
  /** Story ID — used to derive worktree path and branch name. */
  storyId: string;
  /** Base branch/ref to create the worktree from. Defaults to HEAD. */
  baseBranch?: string;
}

/** Structured result wrapper for all worktree operations. */
export interface WorktreeResult<T> {
  /** Whether the operation succeeded. */
  ok: boolean;
  /** Result data on success. */
  data?: T;
  /** Error message on failure. */
  error?: string;
  /** List of dirty files (for remove rejection). */
  dirtyFiles?: string[];
}

/** Validation result for a worktree. */
export interface WorktreeValidation {
  /** Whether the worktree is valid. */
  valid: boolean;
  /** Whether the worktree directory exists. */
  dirExists: boolean;
  /** Whether HEAD is a valid ref. */
  headValid: boolean;
  /** Whether the branch is intact. */
  branchIntact: boolean;
}
