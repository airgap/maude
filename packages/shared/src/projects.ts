export interface Workspace {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
  settings?: WorkspaceSettings;
  createdAt: number;
}

export interface WorkspaceSettings {
  defaultModel?: string;
  defaultPermissionMode?: string;
  systemPrompt?: string;
  effort?: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}
