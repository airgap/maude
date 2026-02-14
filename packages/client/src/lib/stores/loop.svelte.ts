import type { PRD, LoopState, IterationLogEntry, StreamLoopEvent, LoopConfig, PlanMode, EditMode, GeneratedStory, RefinementQuestion, RefineStoryResponse, DependencyGraph, SprintValidation, SprintValidationWarning, ValidateACResponse, ACOverride, StoryEstimate, EstimatePrdResponse } from '@maude/shared';
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

  // Story refinement state
  let refiningStoryId = $state<string | null>(null);
  let refining = $state(false);
  let refineError = $state<string | null>(null);
  let refinementQuestions = $state<RefinementQuestion[]>([]);
  let refinementQualityScore = $state<number | null>(null);
  let refinementQualityExplanation = $state<string | null>(null);
  let refinementMeetsThreshold = $state(false);
  let refinementImprovements = $state<string[]>([]);
  let refinementUpdatedStory = $state<RefineStoryResponse['updatedStory'] | null>(null);
  let refinementRound = $state(0);

  // Dependency state
  let dependencyGraph = $state<DependencyGraph | null>(null);
  let dependencyLoading = $state(false);
  let dependencyError = $state<string | null>(null);
  let sprintValidation = $state<SprintValidation | null>(null);
  let analyzingDependencies = $state(false);

  // AC validation state
  let validatingCriteriaStoryId = $state<string | null>(null);
  let validatingCriteria = $state(false);
  let criteriaValidationResult = $state<ValidateACResponse | null>(null);
  let criteriaValidationError = $state<string | null>(null);
  let criteriaOverrides = $state<ACOverride[]>([]);

  // Estimation state
  let estimatingStoryId = $state<string | null>(null);
  let estimating = $state(false);
  let estimationResult = $state<StoryEstimate | null>(null);
  let estimationError = $state<string | null>(null);
  let estimatingPrd = $state(false);
  let prdEstimationResult = $state<EstimatePrdResponse | null>(null);

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
    get refiningStoryId() {
      return refiningStoryId;
    },
    get refining() {
      return refining;
    },
    get refineError() {
      return refineError;
    },
    get refinementQuestions() {
      return refinementQuestions;
    },
    get refinementQualityScore() {
      return refinementQualityScore;
    },
    get refinementQualityExplanation() {
      return refinementQualityExplanation;
    },
    get refinementMeetsThreshold() {
      return refinementMeetsThreshold;
    },
    get refinementImprovements() {
      return refinementImprovements;
    },
    get refinementUpdatedStory() {
      return refinementUpdatedStory;
    },
    get refinementRound() {
      return refinementRound;
    },
    get dependencyGraph() {
      return dependencyGraph;
    },
    get dependencyLoading() {
      return dependencyLoading;
    },
    get dependencyError() {
      return dependencyError;
    },
    get sprintValidation() {
      return sprintValidation;
    },
    get analyzingDependencies() {
      return analyzingDependencies;
    },
    get hasBlockedStories() {
      if (!dependencyGraph) return false;
      return dependencyGraph.nodes.some((n) => n.blockedByCount > 0 && !n.isReady && n.status === 'pending');
    },
    get sprintWarnings(): SprintValidationWarning[] {
      return sprintValidation?.warnings || [];
    },
    get validatingCriteriaStoryId() {
      return validatingCriteriaStoryId;
    },
    get validatingCriteria() {
      return validatingCriteria;
    },
    get criteriaValidationResult() {
      return criteriaValidationResult;
    },
    get criteriaValidationError() {
      return criteriaValidationError;
    },
    get criteriaOverrides() {
      return criteriaOverrides;
    },
    get estimatingStoryId() {
      return estimatingStoryId;
    },
    get estimating() {
      return estimating;
    },
    get estimationResult() {
      return estimationResult;
    },
    get estimationError() {
      return estimationError;
    },
    get estimatingPrd() {
      return estimatingPrd;
    },
    get prdEstimationResult() {
      return prdEstimationResult;
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

    // --- Story refinement ---

    setRefiningStoryId(id: string | null) {
      refiningStoryId = id;
    },

    clearRefinement() {
      refiningStoryId = null;
      refining = false;
      refineError = null;
      refinementQuestions = [];
      refinementQualityScore = null;
      refinementQualityExplanation = null;
      refinementMeetsThreshold = false;
      refinementImprovements = [];
      refinementUpdatedStory = null;
      refinementRound = 0;
    },

    async refineStory(
      prdId: string,
      storyId: string,
      answers?: Array<{ questionId: string; answer: string }>,
    ): Promise<{ ok: boolean; error?: string }> {
      refining = true;
      refineError = null;
      refiningStoryId = storyId;
      try {
        const res = await api.prds.refineStory(prdId, storyId, answers);
        if (res.ok) {
          refinementQuestions = res.data.questions as RefinementQuestion[];
          refinementQualityScore = res.data.qualityScore;
          refinementQualityExplanation = res.data.qualityExplanation;
          refinementMeetsThreshold = res.data.meetsThreshold;
          refinementImprovements = res.data.improvements || [];
          refinementUpdatedStory = res.data.updatedStory || null;
          refinementRound += 1;

          // If answers were provided and story was updated, reload the PRD to reflect changes
          if (answers && answers.length > 0 && res.data.updatedStory) {
            await this.loadPrd(prdId);
          }

          return { ok: true };
        }
        refineError = (res as any).error || 'Refinement failed';
        return { ok: false, error: refineError ?? undefined };
      } catch (err) {
        refineError = String(err);
        return { ok: false, error: refineError ?? undefined };
      } finally {
        refining = false;
      }
    },

    // --- Sprint planning ---

    // --- Dependency management ---

    async loadDependencyGraph(prdId: string): Promise<void> {
      dependencyLoading = true;
      dependencyError = null;
      try {
        const res = await api.prds.getDependencyGraph(prdId);
        if (res.ok) {
          dependencyGraph = res.data;
        } else {
          dependencyError = (res as any).error || 'Failed to load dependency graph';
        }
      } catch (err) {
        dependencyError = String(err);
      } finally {
        dependencyLoading = false;
      }
    },

    async addDependency(
      prdId: string,
      fromStoryId: string,
      toStoryId: string,
      reason?: string,
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.addDependency(prdId, fromStoryId, toStoryId, reason);
        if (res.ok) {
          dependencyGraph = res.data;
          // Reload PRD to reflect updated dependsOn arrays
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to add dependency' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async removeDependency(
      prdId: string,
      fromStoryId: string,
      toStoryId: string,
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.removeDependency(prdId, fromStoryId, toStoryId);
        if (res.ok) {
          dependencyGraph = res.data;
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to remove dependency' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async analyzeDependencies(
      prdId: string,
      replaceAutoDetected?: boolean,
    ): Promise<{ ok: boolean; error?: string }> {
      analyzingDependencies = true;
      dependencyError = null;
      try {
        const res = await api.prds.analyzeDependencies(prdId, replaceAutoDetected);
        if (res.ok) {
          dependencyGraph = res.data.graph;
          await this.loadPrd(prdId);
          return { ok: true };
        }
        dependencyError = (res as any).error || 'Analysis failed';
        return { ok: false, error: dependencyError ?? undefined };
      } catch (err) {
        dependencyError = String(err);
        return { ok: false, error: dependencyError ?? undefined };
      } finally {
        analyzingDependencies = false;
      }
    },

    async validateSprint(prdId: string): Promise<SprintValidation | null> {
      try {
        const res = await api.prds.validateSprint(prdId);
        if (res.ok) {
          sprintValidation = res.data;
          return res.data;
        }
        return null;
      } catch {
        return null;
      }
    },

    clearDependencyState() {
      dependencyGraph = null;
      dependencyError = null;
      sprintValidation = null;
      analyzingDependencies = false;
    },

    // --- Acceptance Criteria Validation ---

    setValidatingCriteriaStoryId(id: string | null) {
      validatingCriteriaStoryId = id;
    },

    clearCriteriaValidation() {
      validatingCriteriaStoryId = null;
      validatingCriteria = false;
      criteriaValidationResult = null;
      criteriaValidationError = null;
      criteriaOverrides = [];
    },

    async validateCriteria(
      prdId: string,
      storyId: string,
      criteria?: string[],
      storyTitle?: string,
      storyDescription?: string,
    ): Promise<{ ok: boolean; error?: string }> {
      validatingCriteria = true;
      criteriaValidationError = null;
      criteriaValidationResult = null;
      validatingCriteriaStoryId = storyId;
      criteriaOverrides = [];
      try {
        // If no criteria provided, extract from the story
        let criteriaToValidate = criteria;
        if (!criteriaToValidate) {
          const prd = prds.find((p) => p.id === prdId);
          const story = prd?.stories?.find((s) => s.id === storyId);
          if (story) {
            criteriaToValidate = story.acceptanceCriteria.map((ac: any) => ac.description);
            storyTitle = storyTitle || story.title;
            storyDescription = storyDescription || story.description;
          }
        }
        if (!criteriaToValidate || criteriaToValidate.length === 0) {
          criteriaValidationError = 'No acceptance criteria to validate';
          return { ok: false, error: criteriaValidationError };
        }

        const res = await api.prds.validateCriteria(prdId, storyId, criteriaToValidate, storyTitle, storyDescription);
        if (res.ok) {
          criteriaValidationResult = res.data;
          return { ok: true };
        }
        criteriaValidationError = (res as any).error || 'Validation failed';
        return { ok: false, error: criteriaValidationError ?? undefined };
      } catch (err) {
        criteriaValidationError = String(err);
        return { ok: false, error: criteriaValidationError ?? undefined };
      } finally {
        validatingCriteria = false;
      }
    },

    addCriteriaOverride(override: ACOverride) {
      criteriaOverrides = [...criteriaOverrides, override];
    },

    removeCriteriaOverride(criterionIndex: number) {
      criteriaOverrides = criteriaOverrides.filter((o) => o.criterionIndex !== criterionIndex);
    },

    async applyCriteriaSuggestions(
      prdId: string,
      storyId: string,
      acceptedIndices: number[],
    ): Promise<{ ok: boolean; error?: string }> {
      if (!criteriaValidationResult) {
        return { ok: false, error: 'No validation result to apply' };
      }

      // Find the current story
      const prd = prds.find((p) => p.id === prdId);
      const story = prd?.stories?.find((s) => s.id === storyId);
      if (!story) return { ok: false, error: 'Story not found' };

      // Build new criteria: apply suggestions for accepted indices, keep original for others
      const newCriteria = story.acceptanceCriteria.map((ac: any, idx: number) => {
        if (acceptedIndices.includes(idx)) {
          const validation = criteriaValidationResult!.criteria.find((c) => c.index === idx);
          if (validation?.suggestedReplacement) {
            return { ...ac, description: validation.suggestedReplacement };
          }
        }
        return ac;
      });

      try {
        const res = await api.prds.updateStory(prdId, storyId, {
          acceptanceCriteria: newCriteria,
        });
        if (res.ok) {
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to update criteria' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    // --- Story Estimation ---

    setEstimatingStoryId(id: string | null) {
      estimatingStoryId = id;
    },

    clearEstimation() {
      estimatingStoryId = null;
      estimating = false;
      estimationResult = null;
      estimationError = null;
    },

    clearPrdEstimation() {
      estimatingPrd = false;
      prdEstimationResult = null;
    },

    async estimateStory(
      prdId: string,
      storyId: string,
    ): Promise<{ ok: boolean; error?: string }> {
      estimating = true;
      estimationError = null;
      estimationResult = null;
      estimatingStoryId = storyId;
      try {
        const res = await api.prds.estimateStory(prdId, storyId);
        if (res.ok) {
          estimationResult = res.data.estimate;
          // Reload PRD to reflect the persisted estimate
          await this.loadPrd(prdId);
          return { ok: true };
        }
        estimationError = (res as any).error || 'Estimation failed';
        return { ok: false, error: estimationError ?? undefined };
      } catch (err) {
        estimationError = String(err);
        return { ok: false, error: estimationError ?? undefined };
      } finally {
        estimating = false;
      }
    },

    async saveManualEstimate(
      prdId: string,
      storyId: string,
      size: string,
      storyPoints: number,
      reasoning?: string,
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.prds.saveManualEstimate(prdId, storyId, {
          size,
          storyPoints,
          reasoning,
        });
        if (res.ok) {
          estimationResult = res.data.estimate;
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Failed to save estimate' };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async estimateAllStories(
      prdId: string,
      reEstimate?: boolean,
    ): Promise<{ ok: boolean; error?: string }> {
      estimatingPrd = true;
      prdEstimationResult = null;
      try {
        const res = await api.prds.estimatePrd(prdId, reEstimate);
        if (res.ok) {
          prdEstimationResult = res.data;
          await this.loadPrd(prdId);
          return { ok: true };
        }
        return { ok: false, error: (res as any).error || 'Bulk estimation failed' };
      } catch (err) {
        return { ok: false, error: String(err) };
      } finally {
        estimatingPrd = false;
      }
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
