import type { PRD, LoopState, IterationLogEntry, StreamLoopEvent, LoopConfig, PlanMode, EditMode, GeneratedStory } from '@maude/shared';
import { api, getBaseUrl, getAuthToken } from '../api/client';

function createLoopStore() {
  let activeLoop = $state<LoopState | null>(null);
  let prds = $state<PRD[]>([]);
  let selectedPrdId = $state<string | null>(null);
  let loading = $state(false);
  let log = $state<IterationLogEntry[]>([]);
  let eventReader = $state<ReadableStreamDefaultReader | null>(null);
  let eventAbort = $state<AbortController | null>(null);

  // Sprint planning state
  let editMode = $state<EditMode>('locked');
  let planConversationId = $state<string | null>(null);
  let planPrdId = $state<string | null>(null);

  // Story generation state
  let generatedStories = $state<GeneratedStory[]>([]);
  let generating = $state(false);
  let generateError = $state<string | null>(null);

  return {
    get activeLoop() {
      return activeLoop;
    },
    get prds() {
      return prds;
    },
    get selectedPrdId() {
      return selectedPrdId;
    },
    get selectedPrd() {
      return prds.find((p) => p.id === selectedPrdId) || null;
    },
    get loading() {
      return loading;
    },
    get log() {
      return log;
    },
    get isRunning() {
      return activeLoop?.status === 'running';
    },
    get isPaused() {
      return activeLoop?.status === 'paused';
    },
    get isActive() {
      return activeLoop?.status === 'running' || activeLoop?.status === 'paused';
    },
    get completedStories() {
      return activeLoop?.totalStoriesCompleted ?? 0;
    },
    get totalStories() {
      const prd = prds.find((p) => p.id === activeLoop?.prdId);
      return prd?.stories?.length ?? 0;
    },
    get progress() {
      const total = this.totalStories;
      if (total === 0) return 0;
      return Math.round((this.completedStories / total) * 100);
    },
    get editMode() {
      return editMode;
    },
    get allowEdits() {
      return editMode !== 'locked';
    },
    get planConversationId() {
      return planConversationId;
    },
    get planPrdId() {
      return planPrdId;
    },
    get generatedStories() {
      return generatedStories;
    },
    get generating() {
      return generating;
    },
    get generateError() {
      return generateError;
    },

    // --- Setters ---

    setActiveLoop(loop: LoopState | null) {
      activeLoop = loop;
      if (loop) {
        log = loop.iterationLog || [];
      }
    },
    setPrds(list: PRD[]) {
      prds = list;
    },
    setSelectedPrdId(id: string | null) {
      selectedPrdId = id;
    },
    setLoading(v: boolean) {
      loading = v;
    },
    addLogEntry(entry: IterationLogEntry) {
      log = [...log, entry];
    },
    clearLog() {
      log = [];
    },
    setEditMode(v: EditMode) {
      editMode = v;
    },
    setPlanConversationId(id: string | null) {
      planConversationId = id;
    },
    setPlanPrdId(id: string | null) {
      planPrdId = id;
    },

    // --- Loop event handling ---

    handleLoopEvent(event: StreamLoopEvent) {
      if (!activeLoop || event.loopId !== activeLoop.id) return;

      switch (event.event) {
        case 'started':
          activeLoop = { ...activeLoop, status: 'running' };
          break;

        case 'iteration_start':
          activeLoop = {
            ...activeLoop,
            currentIteration: event.data.iteration ?? activeLoop.currentIteration,
            currentStoryId: event.data.storyId ?? null,
          };
          break;

        case 'story_started':
          // Update story status in the PRD list
          this.updateStoryInPrds(event.data.storyId!, 'in_progress');
          break;

        case 'story_completed':
          activeLoop = {
            ...activeLoop,
            totalStoriesCompleted: activeLoop.totalStoriesCompleted + 1,
          };
          this.updateStoryInPrds(event.data.storyId!, 'completed');
          break;

        case 'story_failed':
          this.updateStoryInPrds(event.data.storyId!, 'failed');
          break;

        case 'paused':
          activeLoop = { ...activeLoop, status: 'paused', pausedAt: Date.now() };
          break;

        case 'resumed':
          activeLoop = { ...activeLoop, status: 'running' };
          break;

        case 'completed':
        case 'cancelled':
          activeLoop = {
            ...activeLoop,
            status: event.event === 'completed' ? 'completed' : 'cancelled',
            completedAt: Date.now(),
            currentStoryId: null,
          };
          this.disconnectEvents();
          break;
      }

      // Add to log for relevant events
      if (event.data.storyId && event.event !== 'quality_check') {
        this.addLogEntry({
          iteration: event.data.iteration ?? activeLoop?.currentIteration ?? 0,
          storyId: event.data.storyId,
          storyTitle: event.data.storyTitle ?? '',
          action: event.event as IterationLogEntry['action'],
          detail: event.data.message ?? event.event,
          timestamp: Date.now(),
          qualityResults: event.data.qualityResult ? [event.data.qualityResult] : undefined,
        });
      }
    },

    updateStoryInPrds(storyId: string, status: string) {
      prds = prds.map((prd) => ({
        ...prd,
        stories: (prd.stories || []).map((s) =>
          s.id === storyId ? { ...s, status: status as any } : s,
        ),
      }));
    },

    // --- SSE event streaming ---

    async connectEvents(loopId: string) {
      this.disconnectEvents();

      const abort = new AbortController();
      eventAbort = abort;

      try {
        const headers: Record<string, string> = {};
        const token = getAuthToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${getBaseUrl()}/loops/${loopId}/events`, {
          headers,
          signal: abort.signal,
        });

        if (!res.ok || !res.body) return;

        const reader = res.body.getReader();
        eventReader = reader;
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const json = line.slice(6).trim();
            if (!json || json === '{"type":"ping"}') continue;

            try {
              const event = JSON.parse(json) as StreamLoopEvent;
              if (event.type === 'loop_event') {
                this.handleLoopEvent(event);
              }
            } catch {
              /* non-JSON line */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[loop] Event stream error:', err);
        }
      }
    },

    disconnectEvents() {
      if (eventAbort) {
        eventAbort.abort();
        eventAbort = null;
      }
      eventReader = null;
    },

    // --- API helpers ---

    async loadPrds(projectPath: string) {
      loading = true;
      try {
        const res = await api.prds.list(projectPath);
        if (res.ok) {
          prds = res.data;
        }
      } finally {
        loading = false;
      }
    },

    async loadPrd(id: string) {
      loading = true;
      try {
        const res = await api.prds.get(id);
        if (res.ok) {
          // Update in place
          prds = prds.map((p) => (p.id === id ? res.data : p));
          if (!prds.find((p) => p.id === id)) {
            prds = [...prds, res.data];
          }
        }
      } finally {
        loading = false;
      }
    },

    async loadActiveLoop() {
      try {
        const res = await api.loops.list('running');
        if (res.ok && res.data.length > 0) {
          activeLoop = res.data[0];
          log = activeLoop!.iterationLog || [];
          // Connect to events
          this.connectEvents(activeLoop!.id);
        } else {
          // Check for paused loops
          const pausedRes = await api.loops.list('paused');
          if (pausedRes.ok && pausedRes.data.length > 0) {
            activeLoop = pausedRes.data[0];
            log = activeLoop!.iterationLog || [];
          }
        }
      } catch {
        /* server may not be ready */
      }
    },

    async startLoop(prdId: string, projectPath: string, config: LoopConfig): Promise<{ ok: boolean; error?: string }> {
      loading = true;
      try {
        const res = await api.loops.start({ prdId, projectPath, config });
        if (res.ok) {
          const loopRes = await api.loops.get(res.data.loopId);
          if (loopRes.ok) {
            activeLoop = loopRes.data;
            log = [];
            this.connectEvents(res.data.loopId);
          }
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to start loop' };
      } catch (err) {
        return { ok: false, error: String(err) };
      } finally {
        loading = false;
      }
    },

    async pauseLoop() {
      if (!activeLoop) return;
      await api.loops.pause(activeLoop.id);
    },

    async resumeLoop() {
      if (!activeLoop) return;
      await api.loops.resume(activeLoop.id);
    },

    async cancelLoop() {
      if (!activeLoop) return;
      await api.loops.cancel(activeLoop.id);
    },

    // --- Story generation ---

    setGeneratedStories(stories: GeneratedStory[]) {
      generatedStories = stories;
    },
    clearGeneration() {
      generatedStories = [];
      generateError = null;
    },

    async generateStories(
      prdId: string,
      description: string,
      context?: string,
      count?: number,
    ): Promise<{ ok: boolean; error?: string }> {
      generating = true;
      generateError = null;
      generatedStories = [];
      try {
        const res = await api.prds.generate(prdId, { description, context, count });
        if (res.ok) {
          generatedStories = res.data.stories as GeneratedStory[];
          return { ok: true };
        }
        generateError = (res as any).error || 'Generation failed';
        return { ok: false, error: generateError ?? undefined };
      } catch (err) {
        generateError = String(err);
        return { ok: false, error: generateError ?? undefined };
      } finally {
        generating = false;
      }
    },

    async acceptGeneratedStories(
      prdId: string,
      stories: GeneratedStory[],
    ): Promise<{ ok: boolean; error?: string }> {
      loading = true;
      try {
        const res = await api.prds.acceptGenerated(prdId, stories);
        if (res.ok) {
          generatedStories = [];
          generateError = null;
          // Reload the PRD to show the new stories
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to accept stories' };
      } catch (err) {
        return { ok: false, error: String(err) };
      } finally {
        loading = false;
      }
    },

    updateGeneratedStory(index: number, updates: Partial<GeneratedStory>) {
      generatedStories = generatedStories.map((s, i) =>
        i === index ? { ...s, ...updates } : s,
      );
    },

    removeGeneratedStory(index: number) {
      generatedStories = generatedStories.filter((_, i) => i !== index);
    },

    // --- Sprint planning ---

    async startPlanning(
      prdId: string,
      projectPath: string,
      mode: PlanMode,
      userPrompt?: string,
    ): Promise<{ conversationId: string; mode: string } | null> {
      loading = true;
      try {
        const res = await api.prds.plan(prdId, {
          mode,
          editMode,
          userPrompt,
        });
        if (res.ok) {
          planConversationId = res.data.conversationId;
          planPrdId = prdId;
          return res.data;
        }
        return null;
      } catch (err) {
        console.error('[loop] Failed to start planning:', err);
        return null;
      } finally {
        loading = false;
      }
    },
  };
}

export const loopStore = createLoopStore();
