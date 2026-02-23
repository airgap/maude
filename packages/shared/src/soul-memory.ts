/**
 * Files-as-Memory Architecture (SOUL.md Pattern)
 *
 * Persistent, human-editable agent memory using markdown files in the .e/ directory.
 * These files are auto-injected into agent system prompts to define personality,
 * knowledge, and available tool descriptions.
 *
 * Files:
 *   .e/SOUL.md      — Agent personality, persona, communication style
 *   .e/KNOWLEDGE.md  — Domain knowledge, conventions, architecture decisions
 *   .e/TOOLS.md      — Available tool descriptions and usage patterns
 */

/** The three recognized soul memory file types */
export type SoulMemoryFileKind = 'soul' | 'knowledge' | 'tools';

/** Static metadata for each soul memory file kind */
export interface SoulMemoryFileDef {
  kind: SoulMemoryFileKind;
  /** Relative path from workspace root (e.g. '.e/SOUL.md') */
  relativePath: string;
  /** File name (e.g. 'SOUL.md') */
  fileName: string;
  /** Human-readable label */
  label: string;
  /** Short description of what this file is for */
  description: string;
  /** Default content when creating a new file */
  defaultContent: string;
}

/** Runtime state of a single soul memory file */
export interface SoulMemoryFile {
  kind: SoulMemoryFileKind;
  /** Absolute path on disk */
  path: string;
  /** Whether the file exists on disk */
  exists: boolean;
  /** File content (empty string if file doesn't exist) */
  content: string;
  /** Content size in bytes */
  sizeBytes: number;
  /** Whether the content was summarized to fit context limits */
  summarized: boolean;
  /** Last modified timestamp (0 if file doesn't exist) */
  lastModified: number;
  /** Whether this file is enabled for injection in workspace settings */
  enabled: boolean;
}

/** Complete soul memory state for a workspace */
export interface SoulMemoryState {
  workspacePath: string;
  files: SoulMemoryFile[];
  /** Total characters that will be injected into the prompt */
  totalInjectionSize: number;
}

/** Settings for soul memory files per workspace */
export interface SoulMemorySettings {
  /** Enable/disable SOUL.md injection */
  soulEnabled: boolean;
  /** Enable/disable KNOWLEDGE.md injection */
  knowledgeEnabled: boolean;
  /** Enable/disable TOOLS.md injection */
  toolsEnabled: boolean;
}

/** Default soul memory settings */
export const DEFAULT_SOUL_MEMORY_SETTINGS: SoulMemorySettings = {
  soulEnabled: true,
  knowledgeEnabled: true,
  toolsEnabled: true,
};

/** Request to propose an update to a soul memory file */
export interface SoulMemoryUpdateProposal {
  kind: SoulMemoryFileKind;
  /** What the agent wants to add/change */
  proposedContent: string;
  /** Reason for the update */
  reason: string;
  /** Whether to append (true) or replace (false) */
  append: boolean;
}

/** Maximum size in characters before summarization kicks in */
export const SOUL_MEMORY_MAX_CHARS = 8000;

/** The file definitions — canonical source of truth */
export const SOUL_MEMORY_FILES: SoulMemoryFileDef[] = [
  {
    kind: 'soul',
    relativePath: '.e/SOUL.md',
    fileName: 'SOUL.md',
    label: 'Soul',
    description: 'Agent personality, persona, and communication style',
    defaultContent: `# SOUL.md — Agent Personality

## Persona

Describe how the agent should behave, its tone, communication style, and personality traits.

## Communication Style

- Be direct and helpful
- Match the user's level of formality
- Show genuine interest in the problem

## Values

- Code quality over speed
- Clear explanations over terse answers
- Respect existing project conventions
`,
  },
  {
    kind: 'knowledge',
    relativePath: '.e/KNOWLEDGE.md',
    fileName: 'KNOWLEDGE.md',
    label: 'Knowledge',
    description: 'Domain knowledge, conventions, and architecture decisions',
    defaultContent: `# KNOWLEDGE.md — Domain Knowledge

## Project Overview

Describe the project, its purpose, and key technologies.

## Conventions

- List coding conventions and style guidelines
- Naming patterns and idioms
- File organization rules

## Architecture

- Key architectural decisions
- Important patterns and their rationale
- Module boundaries and responsibilities

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| | | |
`,
  },
  {
    kind: 'tools',
    relativePath: '.e/TOOLS.md',
    fileName: 'TOOLS.md',
    label: 'Tools',
    description: 'Available tool descriptions and usage patterns',
    defaultContent: `# TOOLS.md — Tool Descriptions

## Available Tools

Describe custom tools, scripts, and commands available in this project.

## Usage Patterns

### Build
\`\`\`bash
# How to build the project
\`\`\`

### Test
\`\`\`bash
# How to run tests
\`\`\`

### Deploy
\`\`\`bash
# How to deploy
\`\`\`

## Tool Tips

- List any non-obvious tool behaviors
- Common gotchas and workarounds
`,
  },
];

/** Look up a file definition by kind */
export function getSoulMemoryFileDef(kind: SoulMemoryFileKind): SoulMemoryFileDef | undefined {
  return SOUL_MEMORY_FILES.find((f) => f.kind === kind);
}
