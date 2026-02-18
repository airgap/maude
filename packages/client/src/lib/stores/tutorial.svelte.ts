const STORAGE_KEY = 'e-tutorial';

export type TutorialStepId =
  | 'welcome'
  | 'chat-basics'
  | 'slash-commands'
  | 'sidebar-panels'
  | 'editor-pane'
  | 'command-palette'
  | 'agents-loops'
  | 'settings-themes'
  | 'complete';

export interface TutorialStep {
  id: TutorialStepId;
  title: string;
  description: string;
  /** SVG path for the step icon */
  icon: string;
  /** Detailed body content (HTML) */
  body: string;
  /** Optional action label for a "try it" button */
  actionLabel?: string;
  /** Action identifier to dispatch */
  actionId?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to E',
    icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    description: 'Your AI-powered IDE assistant',
    body: `
      <p><strong>E</strong> is a desktop AI assistant — a full IDE-grade environment where you chat with AI while working on real codebases.</p>
      <h3>The three zones</h3>
      <ul>
        <li><strong>Left Sidebar</strong> — Panels for conversations, files, work items, memory, agents, tools, and more</li>
        <li><strong>Center Chat</strong> — Real-time streaming conversation with E</li>
        <li><strong>Right Editor</strong> — Monaco code editor with LSP, diff view, and integrated terminal</li>
      </ul>
      <p>Let's walk through the key features. Click <strong>Next</strong> to continue.</p>
    `,
  },
  {
    id: 'chat-basics',
    title: 'Chat & Conversations',
    icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    description: 'Talk to E in real time',
    body: `
      <p>The <strong>center chat</strong> is where you interact with E. Messages stream in real-time with visible thinking steps and tool calls.</p>
      <h3>Key shortcuts</h3>
      <ul>
        <li><kbd>Enter</kbd> — Send your message</li>
        <li><kbd>Shift+Enter</kbd> — New line</li>
        <li><kbd>Esc</kbd> — Cancel a streaming response</li>
        <li><kbd>↑</kbd> — Edit your last message (when input is empty)</li>
      </ul>
      <h3>Special features</h3>
      <ul>
        <li><strong>@ Mentions</strong> — Type <code>@</code> to attach files, symbols, or threads as context</li>
        <li><strong>Voice Input</strong> — Click the microphone button to speak your message</li>
        <li><strong>Teach Mode</strong> — Click the graduation cap button for Socratic-style responses</li>
        <li><strong>Branching</strong> — Hover any message and click the branch icon to fork the conversation</li>
      </ul>
    `,
    actionLabel: 'Focus Chat Input',
    actionId: 'focus-chat',
  },
  {
    id: 'slash-commands',
    title: 'Slash Commands',
    icon: 'M7 8l-4 4 4 4M17 8l4 4-4 4M14 4l-4 16',
    description: 'Quick actions at your fingertips',
    body: `
      <p>Type <code>/</code> in the chat input to access powerful commands:</p>
      <ul>
        <li><code>/clear</code> — Clear the current conversation</li>
        <li><code>/new</code> — Start a new conversation</li>
        <li><code>/plan</code> — Toggle Plan Mode (E thinks before acting)</li>
        <li><code>/teach</code> — Toggle Teach Me mode</li>
        <li><code>/fork</code> — Branch the conversation</li>
        <li><code>/replay</code> — Open session replay</li>
        <li><code>/digest</code> — Show today's digest</li>
        <li><code>/cost</code> — Jump to the cost dashboard</li>
      </ul>
      <p>All slash commands are also available in the <strong>Command Palette</strong>.</p>
    `,
  },
  {
    id: 'sidebar-panels',
    title: 'Sidebar Panels',
    icon: 'M4 6h16M4 12h16M4 18h16',
    description: '15+ panels at your fingertips',
    body: `
      <p>The sidebar contains panels for every aspect of your workflow. Press <kbd>Ctrl+/</kbd> to toggle it.</p>
      <h3>Essential panels</h3>
      <ul>
        <li><strong>Chats</strong> — Conversation history and branching</li>
        <li><strong>Files</strong> — Workspace file tree</li>
        <li><strong>Work</strong> — PRDs, user stories, and project planning</li>
        <li><strong>Memory</strong> — Persistent notes E remembers across conversations</li>
        <li><strong>Agents</strong> — Running agent loops and their status</li>
        <li><strong>Tools</strong> — Custom tools you define for E</li>
        <li><strong>MCP</strong> — External tool servers (databases, APIs, etc.)</li>
        <li><strong>Costs</strong> — Real-time token usage and spend tracking</li>
      </ul>
      <p>Panels can be dragged between left and right columns, or float as detached windows.</p>
    `,
    actionLabel: 'Toggle Sidebar',
    actionId: 'toggle-sidebar',
  },
  {
    id: 'editor-pane',
    title: 'Editor & Terminal',
    icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
    description: 'Full IDE built in',
    body: `
      <p>E includes a Monaco code editor (same as VS Code) with syntax highlighting, multi-cursor editing, and LSP integration.</p>
      <h3>Opening files</h3>
      <ul>
        <li><strong>File Tree</strong> — Click any file in the sidebar</li>
        <li><kbd>Ctrl+P</kbd> — Quick open (fuzzy file finder)</li>
        <li><strong>Auto-open</strong> — When E edits a file, it opens in a diff tab</li>
      </ul>
      <h3>Layout modes</h3>
      <ul>
        <li><kbd>Ctrl+\\</kbd> — Toggle between chat-only and split view</li>
        <li><strong>Chat Only</strong> / <strong>Split</strong> / <strong>Editor Only</strong> — Cycle with the status bar button</li>
      </ul>
      <h3>Terminal</h3>
      <p>Press <kbd>Ctrl+\`</kbd> to toggle the integrated terminal. E can run commands here when given permission.</p>
    `,
    actionLabel: 'Toggle Editor',
    actionId: 'toggle-editor',
  },
  {
    id: 'command-palette',
    title: 'Command Palette',
    icon: 'M18 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3zM8 11H5V9h3v2zm0 4H5v-2h3v2zm4-4h-3V9h3v2zm0 4h-3v-2h3v2zm4-4h-3V9h3v2zm0 4h-3v-2h3v2z',
    description: 'Every action, one shortcut away',
    body: `
      <p>Press <kbd>Ctrl+K</kbd> to open the Command Palette — a fuzzy-search launcher for every action in E.</p>
      <h3>What you can do</h3>
      <ul>
        <li>Run any slash command</li>
        <li>Switch conversations</li>
        <li>Open settings, panels, or modals</li>
        <li>Toggle features (plan mode, teach mode, etc.)</li>
      </ul>
      <p>It's the fastest way to navigate E without memorizing every shortcut.</p>
    `,
    actionLabel: 'Open Palette',
    actionId: 'open-command-palette',
  },
  {
    id: 'agents-loops',
    title: 'Agents & Loops',
    icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    description: 'Autonomous AI workflows',
    body: `
      <p><strong>Loop Mode</strong> runs E autonomously: it picks a story, implements it, verifies, and moves to the next — without intervention.</p>
      <h3>How to start</h3>
      <ol>
        <li>Open the <strong>Work</strong> panel and create a PRD with user stories</li>
        <li>Click <strong>Start Loop</strong></li>
        <li>Configure model, max iterations, and permissions</li>
        <li>Click <strong>Run</strong></li>
      </ol>
      <h3>Plan Mode</h3>
      <p>Press <kbd>Shift+Tab</kbd> twice (or click ✏ in the top bar) to toggle Plan Mode — E will outline its plan before taking action.</p>
      <h3>Agent Profiles</h3>
      <p>Use <kbd>Ctrl+Shift+,</kbd> to cycle between Write, Ask, and Minimal profiles that control how much autonomy E has.</p>
    `,
    actionLabel: 'Open Work Panel',
    actionId: 'open-work-panel',
  },
  {
    id: 'settings-themes',
    title: 'Settings & Themes',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    description: 'Make E yours',
    body: `
      <p>Open Settings with <kbd>Ctrl+,</kbd> to customize every aspect of E.</p>
      <h3>Hyperthemes</h3>
      <p>Complete aesthetic packages that change colors, animations, and ambient effects:</p>
      <ul>
        <li><strong>Tech</strong> — High-contrast cyan, scanline overlay</li>
        <li><strong>Arcane</strong> — Purple mystical, constellation effects</li>
        <li><strong>Ethereal</strong> — Soft lavender, floating motes</li>
        <li><strong>Study</strong> — Warm amber on cream, sparkle cursor</li>
        <li><strong>Astral</strong> — Deep blue star field</li>
      </ul>
      <h3>Other settings</h3>
      <ul>
        <li><strong>Fonts</strong> — Mono and sans typeface selection</li>
        <li><strong>Audio</strong> — Sound effects and style</li>
        <li><strong>Permissions</strong> — Tool and terminal access levels</li>
        <li><strong>MCP Servers</strong> — External tool integrations</li>
      </ul>
    `,
    actionLabel: 'Open Settings',
    actionId: 'open-settings',
  },
  {
    id: 'complete',
    title: 'You\'re Ready!',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    description: 'Start building with E',
    body: `
      <p>You now know the essentials. Here are some tips as you get started:</p>
      <h3>Quick tips</h3>
      <ul>
        <li>Press <kbd>?</kbd> any time to open the <strong>Help Panel</strong> with detailed docs</li>
        <li>Use <strong>Memory</strong> to teach E about your project's conventions</li>
        <li>Try <strong>Teach Mode</strong> when learning new concepts</li>
        <li>Use <strong>Session Replay</strong> to review how E solved a problem</li>
        <li>The <strong>Daily Digest</strong> summarizes everything that happened in your workspace</li>
      </ul>
      <p>You can re-run this tutorial any time from the <strong>Help</strong> panel.</p>
    `,
  },
];

interface TutorialState {
  completed: boolean;
  currentStepIndex: number;
  stepsVisited: string[];
  dismissedAt: number | null;
}

const defaultState: TutorialState = {
  completed: false,
  currentStepIndex: 0,
  stepsVisited: [],
  dismissedAt: null,
};

function loadState(): TutorialState {
  if (typeof window === 'undefined') return defaultState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultState, ...JSON.parse(raw) };
  } catch {}
  return defaultState;
}

function createTutorialStore() {
  let state = $state<TutorialState>(loadState());
  let active = $state(false);

  function persist() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  return {
    get active() {
      return active;
    },
    get completed() {
      return state.completed;
    },
    get currentStepIndex() {
      return state.currentStepIndex;
    },
    get currentStep(): TutorialStep {
      return TUTORIAL_STEPS[state.currentStepIndex] ?? TUTORIAL_STEPS[0];
    },
    get totalSteps() {
      return TUTORIAL_STEPS.length;
    },
    get stepsVisited() {
      return state.stepsVisited;
    },
    get isFirstTime(): boolean {
      return !state.completed && state.dismissedAt === null;
    },
    get progress(): number {
      return Math.round((state.currentStepIndex / (TUTORIAL_STEPS.length - 1)) * 100);
    },

    /** Open the tutorial (optionally at a specific step) */
    start(stepIndex = 0) {
      state.currentStepIndex = stepIndex;
      active = true;
      const stepId = TUTORIAL_STEPS[stepIndex]?.id;
      if (stepId && !state.stepsVisited.includes(stepId)) {
        state.stepsVisited = [...state.stepsVisited, stepId];
      }
      persist();
    },

    /** Advance to the next step */
    next() {
      if (state.currentStepIndex < TUTORIAL_STEPS.length - 1) {
        state.currentStepIndex++;
        const stepId = TUTORIAL_STEPS[state.currentStepIndex]?.id;
        if (stepId && !state.stepsVisited.includes(stepId)) {
          state.stepsVisited = [...state.stepsVisited, stepId];
        }
        persist();
      }
    },

    /** Go back to the previous step */
    prev() {
      if (state.currentStepIndex > 0) {
        state.currentStepIndex--;
        persist();
      }
    },

    /** Jump to a specific step */
    goToStep(index: number) {
      if (index >= 0 && index < TUTORIAL_STEPS.length) {
        state.currentStepIndex = index;
        const stepId = TUTORIAL_STEPS[index]?.id;
        if (stepId && !state.stepsVisited.includes(stepId)) {
          state.stepsVisited = [...state.stepsVisited, stepId];
        }
        persist();
      }
    },

    /** Mark as complete and close */
    complete() {
      state.completed = true;
      state.currentStepIndex = TUTORIAL_STEPS.length - 1;
      active = false;
      persist();
    },

    /** Dismiss without completing (close but remember position) */
    dismiss() {
      active = false;
      state.dismissedAt = Date.now();
      persist();
    },

    /** Reset the tutorial state (for re-running) */
    reset() {
      state = { ...defaultState };
      active = true;
      persist();
    },
  };
}

export const tutorialStore = createTutorialStore();
