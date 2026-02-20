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
  commentaryPersonality?: string;
  commentaryMuted?: boolean;
  commentaryVerbosity?: 'low' | 'medium' | 'high';
  commentaryHistoryEnabled?: boolean;
  commentaryTtsEnabled?: boolean;
  commentaryTtsVolume?: number; // 0.0 to 1.0
  commentaryTtsProvider?: 'browser' | 'elevenlabs' | 'google';
  commentaryTtsElevenLabsApiKey?: string;
  commentaryTtsGoogleApiKey?: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}
