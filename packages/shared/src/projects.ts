export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
  settings?: ProjectSettings;
  createdAt: number;
}

export interface ProjectSettings {
  defaultModel?: string;
  defaultPermissionMode?: string;
  systemPrompt?: string;
  effort?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}
