// --- PRD Types ---

export type StoryStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export type StoryPriority = 'critical' | 'high' | 'medium' | 'low';

export interface AcceptanceCriterion {
  id: string;
  description: string;
  passed: boolean;
}

export interface UserStory {
  id: string;
  prdId: string;
  title: string;
  description: string;
  acceptanceCriteria: AcceptanceCriterion[];
  priority: StoryPriority;
  dependsOn: string[]; // story IDs this story depends on
  status: StoryStatus;
  taskId?: string; // linked Maude task ID
  agentId?: string; // agent that last worked on this
  conversationId?: string; // conversation created for this story
  commitSha?: string; // git commit after successful implementation
  attempts: number; // how many times the loop tried this story
  maxAttempts: number; // configurable per-story retry limit
  learnings: string[]; // accumulated learnings from attempts
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface PRD {
  id: string;
  projectPath: string;
  name: string;
  description: string;
  branchName?: string;
  stories: UserStory[];
  qualityChecks: QualityCheckConfig[];
  createdAt: number;
  updatedAt: number;
}

export interface PRDCreateInput {
  projectPath: string;
  name: string;
  description: string;
  branchName?: string;
  stories: Array<{
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority?: StoryPriority;
    dependsOn?: string[];
  }>;
  qualityChecks?: QualityCheckConfig[];
}

// --- Quality Check Types ---

export type QualityCheckType = 'typecheck' | 'lint' | 'test' | 'build' | 'custom';

export interface QualityCheckConfig {
  id: string;
  type: QualityCheckType;
  name: string;
  command: string; // e.g. "npm run typecheck", "bun run check"
  timeout: number; // ms
  required: boolean; // if true, failing this check fails the story
  enabled: boolean;
}

export interface QualityCheckResult {
  checkId: string;
  checkName: string;
  checkType: QualityCheckType;
  passed: boolean;
  output: string;
  duration: number;
  exitCode: number;
}

// --- Loop Orchestrator Types ---

export type LoopStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface LoopConfig {
  maxIterations: number; // max total iterations across all stories
  maxAttemptsPerStory: number; // max retries per individual story
  model: string;
  effort: string;
  autoCommit: boolean; // commit after each successful story
  autoSnapshot: boolean; // create git snapshot before each story
  pauseOnFailure: boolean; // pause the loop when a story fails
  qualityChecks: QualityCheckConfig[];
  systemPromptOverride?: string;
}

export interface LoopState {
  id: string;
  prdId: string;
  projectPath: string;
  status: LoopStatus;
  config: LoopConfig;
  currentIteration: number;
  currentStoryId: string | null;
  currentAgentId: string | null;
  startedAt: number;
  pausedAt?: number;
  completedAt?: number;
  totalStoriesCompleted: number;
  totalStoriesFailed: number;
  totalIterations: number;
  iterationLog: IterationLogEntry[];
}

export interface IterationLogEntry {
  iteration: number;
  storyId: string;
  storyTitle: string;
  action:
    | 'started'
    | 'quality_check'
    | 'passed'
    | 'failed'
    | 'committed'
    | 'skipped'
    | 'learning';
  detail: string;
  timestamp: number;
  qualityResults?: QualityCheckResult[];
}

// --- Sprint Planning Types ---

export type PlanMode = 'chat' | 'generate' | 'chat-generate';

/** Controls how Claude handles story edits during planning.
 *  - locked:   Claude discusses stories in plain text only
 *  - propose:  Claude outputs structured edit blocks for user approval
 *  - unlocked: Claude outputs structured edit blocks that are auto-applied
 */
export type EditMode = 'locked' | 'propose' | 'unlocked';

export interface PlanSprintRequest {
  mode: PlanMode;
  editMode: EditMode;
  userPrompt?: string; // optional user guidance
  model?: string; // override model
}

export interface PlanSprintResponse {
  conversationId: string;
  prdId: string;
  mode: PlanMode;
  editMode: EditMode;
}

// --- Story Generation Types ---

export interface GenerateStoriesRequest {
  description: string; // PRD description or high-level requirements text
  context?: string; // optional additional context (project info, constraints)
  count?: number; // target number of stories (default: 5-10)
}

export interface GeneratedStory {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: StoryPriority;
}

export interface GenerateStoriesResponse {
  stories: GeneratedStory[];
  prdId: string;
}

// --- Story Refinement Types ---

export interface RefinementQuestion {
  id: string;
  question: string;
  context: string; // why this question matters
  suggestedAnswers?: string[]; // optional suggestions
}

export interface RefineStoryRequest {
  storyId: string;
  answers?: Array<{ questionId: string; answer: string }>; // answers to previous questions
}

export interface RefineStoryResponse {
  storyId: string;
  questions: RefinementQuestion[]; // 2-5 clarifying questions
  qualityScore: number; // 0-100, how well-defined the story is
  qualityExplanation: string; // what was unclear
  meetsThreshold: boolean; // true if quality >= 80
  updatedStory?: {
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority: StoryPriority;
  };
  improvements?: string[]; // list of what was improved and how
}

// --- Stream Events for Loop ---

export interface StreamLoopEvent {
  type: 'loop_event';
  loopId: string;
  event:
    | 'started'
    | 'iteration_start'
    | 'iteration_end'
    | 'story_started'
    | 'story_completed'
    | 'story_failed'
    | 'quality_check'
    | 'paused'
    | 'resumed'
    | 'completed'
    | 'cancelled'
    | 'learning';
  data: {
    storyId?: string;
    storyTitle?: string;
    iteration?: number;
    qualityResult?: QualityCheckResult;
    learning?: string;
    message?: string;
  };
}
