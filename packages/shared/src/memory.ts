export interface MemoryFile {
  path: string;
  content: string;
  type: MemoryFileType;
  lastModified: number;
}

export type MemoryFileType =
  | 'project'       // ./CLAUDE.md
  | 'project-local' // ./CLAUDE.local.md
  | 'user'          // ~/.claude/CLAUDE.md
  | 'auto-memory'   // ~/.claude/projects/xxx/memory/MEMORY.md
  | 'auto-topic'    // ~/.claude/projects/xxx/memory/topic.md
  | 'rules'         // .claude/rules/*.md
  | 'skills';       // .claude/skills/*/SKILL.md

export interface Skill {
  name: string;
  command: string; // slash command trigger
  description: string;
  content: string;
  filePath: string;
}

export interface MemoryState {
  files: MemoryFile[];
  skills: Skill[];
  autoMemoryEnabled: boolean;
}
