export type CommentaryPersonality =
  | 'sports_announcer'
  | 'documentary_narrator'
  | 'technical_analyst'
  | 'comedic_observer'
  | 'project_lead'
  | 'wizard';

export type CommentaryVerbosity = 'low' | 'medium' | 'high';

/**
 * Commentary-specific settings that can be stored per-workspace.
 * Default values: enabled=false, personality='technical_analyst', verbosity='medium'
 */
export interface CommentarySettings {
  enabled: boolean;
  personality: CommentaryPersonality;
  verbosity: CommentaryVerbosity;
}

/** Default commentary settings applied when none are configured. */
export const DEFAULT_COMMENTARY_SETTINGS: CommentarySettings = {
  enabled: false,
  personality: 'technical_analyst',
  verbosity: 'medium',
};

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
  commentaryEnabled?: boolean;
  commentaryPersonality?: CommentaryPersonality;
  commentaryMuted?: boolean;
  commentaryVerbosity?: CommentaryVerbosity;
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
