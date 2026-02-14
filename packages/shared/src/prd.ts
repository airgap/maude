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
  estimate?: StoryEstimate; // AI or manual complexity/effort estimate
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

// --- Dependency Types ---

export type DependencyType = 'blocks' | 'blocked_by';

/** A directional dependency edge between two stories */
export interface StoryDependency {
  fromStoryId: string; // this story...
  toStoryId: string;   // ...depends on / blocks this story
  type: DependencyType; // relationship direction
  reason?: string;     // why this dependency exists
  autoDetected: boolean; // was this found by AI analysis?
}

/** Full dependency graph for a PRD */
export interface DependencyGraph {
  prdId: string;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  warnings: DependencyWarning[];
}

export interface DependencyNode {
  storyId: string;
  title: string;
  status: StoryStatus;
  priority: StoryPriority;
  /** Number of stories this one blocks (downstream dependents) */
  blocksCount: number;
  /** Number of stories blocking this one (upstream dependencies) */
  blockedByCount: number;
  /** Whether all upstream dependencies are satisfied (completed) */
  isReady: boolean;
  /** Depth in the dependency chain (0 = no dependencies) */
  depth: number;
}

export interface DependencyEdge {
  from: string; // story ID that blocks
  to: string;   // story ID that is blocked
  reason?: string;
}

export interface DependencyWarning {
  type: 'circular' | 'missing_dependency' | 'unresolved_blocker' | 'orphan_dependency';
  message: string;
  storyIds: string[];
}

/** Request for AI-powered dependency analysis */
export interface AnalyzeDependenciesRequest {
  /** If true, replace existing auto-detected dependencies. Manual ones are preserved. */
  replaceAutoDetected?: boolean;
}

/** Response from dependency analysis */
export interface AnalyzeDependenciesResponse {
  prdId: string;
  dependencies: StoryDependency[];
  graph: DependencyGraph;
}

/** Sprint plan validation result */
export interface SprintValidation {
  valid: boolean;
  warnings: SprintValidationWarning[];
}

export interface SprintValidationWarning {
  type: 'missing_dependency' | 'blocked_story' | 'circular_dependency';
  message: string;
  storyId: string;
  storyTitle: string;
  blockedByStoryIds?: string[];
  blockedByStoryTitles?: string[];
}

// --- Acceptance Criteria Validation Types ---

/** Severity of a validation issue found in a criterion */
export type ACValidationSeverity = 'error' | 'warning' | 'info';

/** Category of the validation issue */
export type ACValidationCategory = 'vague' | 'unmeasurable' | 'untestable' | 'too_broad' | 'ambiguous' | 'missing_detail';

/** A single validation issue for one acceptance criterion */
export interface ACValidationIssue {
  criterionIndex: number;
  criterionText: string;
  severity: ACValidationSeverity;
  category: ACValidationCategory;
  message: string;
  suggestedReplacement?: string;
}

/** Validation result for a single criterion */
export interface ACCriterionValidation {
  index: number;
  text: string;
  isValid: boolean;
  issues: ACValidationIssue[];
  suggestedReplacement?: string;
}

/** Request to validate acceptance criteria */
export interface ValidateACRequest {
  storyId: string;
  criteria: string[]; // the criteria text to validate
  storyTitle?: string;
  storyDescription?: string;
}

/** Response from AC validation */
export interface ValidateACResponse {
  storyId: string;
  overallScore: number; // 0-100 quality score for all criteria
  allValid: boolean;
  criteria: ACCriterionValidation[];
  summary: string; // brief overall assessment
}

/** Override justification when user dismisses a warning */
export interface ACOverride {
  criterionIndex: number;
  justification: string;
}

// --- Story Estimation Types ---

/** Complexity size for a story */
export type StorySize = 'small' | 'medium' | 'large';

/** Confidence level for an estimate */
export type EstimateConfidence = 'low' | 'medium' | 'high';

/** A single factor that influenced the estimate */
export interface EstimationFactor {
  factor: string;       // e.g. "Multiple API integrations required"
  impact: 'increases' | 'decreases' | 'neutral';
  weight: 'minor' | 'moderate' | 'major';
}

/** The full estimation result for a story */
export interface StoryEstimate {
  storyId: string;
  size: StorySize;
  storyPoints: number;           // Fibonacci: 1, 2, 3, 5, 8, 13
  confidence: EstimateConfidence;
  confidenceScore: number;       // 0-100 numeric confidence
  factors: EstimationFactor[];
  reasoning: string;             // Brief explanation of the estimate
  suggestedBreakdown?: string[]; // For large stories, suggest sub-tasks
  isManualOverride: boolean;     // Whether the user overrode the AI estimate
}

/** Request to estimate a story */
export interface EstimateStoryRequest {
  storyId: string;
  /** Optional: provide story details if not loading from DB */
  storyTitle?: string;
  storyDescription?: string;
  criteria?: string[];
}

/** Response from story estimation */
export interface EstimateStoryResponse {
  storyId: string;
  estimate: StoryEstimate;
}

/** Request to estimate all stories in a PRD */
export interface EstimatePrdRequest {
  /** If true, re-estimate stories that already have estimates */
  reEstimate?: boolean;
}

/** Response from bulk PRD estimation */
export interface EstimatePrdResponse {
  prdId: string;
  estimates: StoryEstimate[];
  summary: {
    totalPoints: number;
    averagePoints: number;
    smallCount: number;
    mediumCount: number;
    largeCount: number;
    averageConfidence: number;
  };
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
