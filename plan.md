# Rename: Project → Workspace

## Overview

Rename all "Project" terminology to "Workspace" throughout the codebase. This frees up "Project" for the higher-level initiative concept, and "Workspace" better describes what these tabs/contexts actually are (a repo/folder working context).

Memory becomes "Workspace Memory" (workspace-specific), with global memory as a separate future concept.

## Execution Order

### Phase 1: Database Migration

Add migration logic in `database.ts` to rename tables and columns:

- Table: `projects` → `workspaces`
- Table: `project_memories` → `workspace_memories`
- Columns across tables: `project_path` → `workspace_path`, `project_id` → `workspace_id`
- All related indexes

### Phase 2: Shared Types (packages/shared)

1. Rename `projects.ts` → `workspaces.ts`
   - `Project` → `Workspace`, `ProjectSettings` → `WorkspaceSettings`, `ProjectSummary` → `WorkspaceSummary`
2. Rename `project-memory.ts` → `workspace-memory.ts`
   - `ProjectMemory` → `WorkspaceMemory`, `ProjectMemoryCreate` → `WorkspaceMemoryCreate`, `ProjectMemoryUpdate` → `WorkspaceMemoryUpdate`
   - `projectPath` → `workspacePath` in all interfaces
3. Update `messages.ts`: `projectPath` → `workspacePath`, `projectId` → `workspaceId` in Conversation/ConversationSummary
4. Update `api.ts`: `projectPath` → `workspacePath` in CreateConversationRequest
5. Update `settings.ts`: `projectPath` → `workspacePath`
6. Update `index.ts` exports

### Phase 3: Server Routes & Services

1. Rename `routes/projects.ts` → `routes/workspaces.ts`, export `workspaceRoutes`
2. Rename `routes/project-memory.ts` → `routes/workspace-memory.ts`, export `workspaceMemoryRoutes`
3. Update `index.ts` imports and route registration (`/api/workspaces`, `/api/workspace-memory`)
4. Update all route files: `projectPath` → `workspacePath`, `projectId` → `workspaceId`
   - conversations.ts, stream.ts, prd.ts, loop.ts, agents.ts, commands.ts, files.ts, git.ts, memory.ts
5. Update all services: `projectPath` → `workspacePath`
   - claude-process.ts, loop-orchestrator.ts, quality-checker.ts, code-verifier.ts
6. Update middleware/sandbox.ts: `projectPath` → `workspacePath`

### Phase 4: Client API

Update `api/client.ts`:

- `projects` → `workspaces` (object key + all endpoint paths)
- `projectMemory` → `workspaceMemory` (object key + all endpoint paths)
- `projectPath` → `workspacePath` in all parameters

### Phase 5: Client Stores

1. Rename `stores/projects.svelte.ts` → `stores/workspaces.svelte.ts`
   - `projectStore` → `workspaceStore`, all methods and properties
2. Rename `stores/project-memory.svelte.ts` → `stores/workspace-memory.svelte.ts`
   - `projectMemoryStore` → `workspaceMemoryStore`, all methods and properties
3. Update `stores/workspace.svelte.ts`: `projectId` → `workspaceId`, `projectName` → `workspaceName`, `projectPath` → `workspacePath`
4. Update `stores/settings.svelte.ts`: `projectPath` → `workspacePath`
5. Update `stores/ui.svelte.ts`: modal type `'project-setup'` → `'workspace-setup'`

### Phase 6: Client Components

1. Rename `ProjectSwitcher.svelte` → `WorkspaceSwitcher.svelte`
2. Rename `ProjectSetup.svelte` → `WorkspaceSetup.svelte`
3. Update all components that import/reference project stores and variables
4. Update UI strings: "Project" → "Workspace" in labels, placeholders, button text
5. Update CSS classes: `.project-*` → `.workspace-*`

### Phase 7: Tests

Update all test files with renamed types, routes, and parameters.

### Phase 8: Verify

- `npm run check` in client
- `npx tsc --noEmit` in server
- Build test
