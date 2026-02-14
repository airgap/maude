export type MemoryCategory = 'convention' | 'decision' | 'preference' | 'pattern' | 'context';

export type MemorySource = 'auto' | 'manual';

export interface ProjectMemory {
  id: string;
  projectPath: string;
  category: MemoryCategory;
  key: string;
  content: string;
  source: MemorySource;
  confidence: number; // 0.0 - 1.0
  timesSeen: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMemoryCreate {
  projectPath: string;
  category: MemoryCategory;
  key: string;
  content: string;
  source?: MemorySource;
  confidence?: number;
}

export interface ProjectMemoryUpdate {
  category?: MemoryCategory;
  key?: string;
  content?: string;
  confidence?: number;
}
