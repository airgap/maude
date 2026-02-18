<script lang="ts">
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';
  import { sendAndStream, cancelStream } from '$lib/api/sse';
  import { api } from '$lib/api/client';
  import { executeSlashCommand, type SlashCommandContext } from '$lib/commands/slash-commands';
  import { uiStore, onFocusChatInput } from '$lib/stores/ui.svelte';
  import { workStore } from '$lib/stores/work.svelte';
  import { onMount } from 'svelte';
  import SlashCommandMenu from './SlashCommandMenu.svelte';
  import MentionMenu from './MentionMenu.svelte';
  import MentionFilePicker from './MentionFilePicker.svelte';
  import MentionSymbolPicker from './MentionSymbolPicker.svelte';
  import MentionRulePicker from './MentionRulePicker.svelte';
  import MentionThreadPicker from './MentionThreadPicker.svelte';
  import TaskSplitSuggestion from './TaskSplitSuggestion.svelte';
  import VoiceButton from './VoiceButton.svelte';
  import {
    detectMultiPartRequest,
    type DetectedTask,
    type DetectionResult,
  } from '$lib/utils/task-detector';

  // ── @-mention types ──
  type MentionKind = 'file' | 'symbol' | 'diagnostics' | 'rule' | 'thread';

  interface Mention {
    id: string;
    kind: MentionKind;
    label: string;
    /** Context text to inject, formatted as XML */
    context: string;
    collapsed: boolean;
  }

  let inputText = $state('');
  let textarea: HTMLTextAreaElement;
  let lastShiftTab = 0;
  let localPlanMode = $state(false);
  let localTeachMode = $state(false);
  let showSlashMenu = $state(false);
  let slashQuery = $state('');
  let showDirPicker = $state(false);
  let dirOptions = $state<{ name: string; path: string }[]>([]);
  let browsedPath = $state('');
  let dirScopeEl: HTMLDivElement;
  let editingPath = $state(false);
  let pathInputValue = $state('');
  let pathInput = $state<HTMLInputElement>();
  let contextFiles = $state<Set<string>>(new Set());
  let diffPreview = $state<any>(null);
  let diffLoading = $state(false);
  let taskSuggestion = $state<DetectionResult | null>(null);
  let pendingMessage = $state('');

  // ── @-mention state ──
  let showMentionMenu = $state(false);
  let mentionQuery = $state('');
  let mentionAtPos = $state(-1); // position of '@' in inputText
  let activePicker = $state<MentionKind | null>(null);
  let mentions = $state<Mention[]>([]);

  onMount(() => {
    onFocusChatInput(() => {
      // Small delay to let Svelte finish any pending state updates (e.g. clearing active conversation)
      requestAnimationFrame(() => textarea?.focus());
    });
  });

  function toggleContextFile(tabId: string) {
    const next = new Set(contextFiles);
    if (next.has(tabId)) next.delete(tabId);
    else next.add(tabId);
    contextFiles = next;
  }

  function buildContextPrefix(): string {
    const parts: string[] = [];

    // Editor tab context files (existing behaviour)
    for (const tabId of contextFiles) {
      const tab = editorStore.tabs.find((t) => t.id === tabId);
      if (tab) {
        parts.push(`<file path="${tab.filePath}">\n${tab.content}\n</file>`);
      }
    }

    // @-mention context
    for (const mention of mentions) {
      parts.push(mention.context);
    }

    return parts.length > 0 ? parts.join('\n') + '\n\n' : '';
  }

  // ── Mention helpers ──

  function closeMentionMenu() {
    showMentionMenu = false;
    activePicker = null;
    mentionAtPos = -1;
    mentionQuery = '';
  }

  function removeMentionToken() {
    // Remove the @... token from the input text
    if (mentionAtPos >= 0) {
      const before = inputText.slice(0, mentionAtPos);
      // Remove everything from '@' to end of the mention token (up to next space or end)
      const after = inputText.slice(mentionAtPos);
      const spaceIdx = after.search(/\s/);
      const remaining = spaceIdx >= 0 ? after.slice(spaceIdx) : '';
      inputText = (before + remaining).trimStart();
      resizeTextarea();
    }
    mentionAtPos = -1;
  }

  function addMention(mention: Omit<Mention, 'id' | 'collapsed'>) {
    const id = `mention-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    mentions = [...mentions, { ...mention, id, collapsed: false }];
    removeMentionToken();
    closeMentionMenu();
    textarea?.focus();
  }

  function removeMention(id: string) {
    mentions = mentions.filter((m) => m.id !== id);
  }

  function toggleMentionCollapse(id: string) {
    mentions = mentions.map((m) => (m.id === id ? { ...m, collapsed: !m.collapsed } : m));
  }

  async function handleMentionTypeSelect(type: MentionKind) {
    showMentionMenu = false;
    if (type === 'diagnostics') {
      // @diagnostics: collect all current LSP diagnostics immediately — no secondary picker
      const diagText = await collectDiagnostics();
      addMention({
        kind: 'diagnostics',
        label: '@diagnostics',
        context: `<diagnostics>\n${diagText || 'No active LSP diagnostics found.'}\n</diagnostics>`,
      });
    } else {
      activePicker = type;
    }
  }

  async function collectDiagnostics(): Promise<string> {
    // Collect cached diagnostics from open editor tabs via LSP publishDiagnostics
    // We use a short-lived subscription to gather any pending diagnostics
    const lines: string[] = [];
    // Check all open tabs and request diagnostics from the LSP
    for (const tab of editorStore.tabs) {
      const ext = tab.fileName.split('.').pop() || '';
      const langMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        py: 'python',
        rs: 'rust',
        go: 'go',
        cs: 'csharp',
        java: 'java',
      };
      const language = langMap[ext];
      if (!language) continue;
      if (!lspStore.isConnected(language)) continue;
      // Request document diagnostics
      try {
        const result = await lspStore.request(language, 'textDocument/diagnostic', {
          textDocument: { uri: `file://${tab.filePath}` },
        });
        const items = result?.items || result?.diagnostics || [];
        for (const d of items) {
          const severity = d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info';
          const line = (d.range?.start?.line ?? 0) + 1;
          lines.push(`[${severity}] ${tab.filePath}:${line} — ${d.message}`);
        }
      } catch {
        // LSP may not support pull diagnostics; skip
      }
    }
    return lines.join('\n');
  }

  async function handleFileMentionSelect(filePath: string) {
    try {
      const res = await api.files.read(filePath);
      const content = res.data.content;
      const fileName = filePath.split('/').pop() || filePath;
      addMention({
        kind: 'file',
        label: `@file:${fileName}`,
        context: `<file path="${filePath}">\n${content}\n</file>`,
      });
    } catch {
      closeMentionMenu();
      textarea?.focus();
    }
  }

  function handleSymbolMentionSelect(sym: {
    name: string;
    kind: string;
    filePath: string;
    startRow: number;
    startCol: number;
  }) {
    addMention({
      kind: 'symbol',
      label: `@symbol:${sym.name}`,
      context: `<symbol name="${sym.name}" kind="${sym.kind}" file="${sym.filePath}" line="${sym.startRow + 1}" />`,
    });
  }

  function handleRuleMentionSelect(rule: { name: string; content: string; path: string }) {
    addMention({
      kind: 'rule',
      label: `@rule:${rule.name}`,
      context: `<rule name="${rule.name}">\n${rule.content}\n</rule>`,
    });
  }

  async function handleThreadMentionSelect(conv: {
    id: string;
    title: string;
    messageCount: number;
    compactSummary?: string;
  }) {
    try {
      let summaryText: string;

      if (conv.compactSummary) {
        // Use already-loaded summary from conversation list
        summaryText = conv.compactSummary;
      } else {
        // Request on-demand summary generation (LLM-based, falls back to rule-based)
        const res = await api.conversations.summarize(conv.id);
        summaryText = res.data?.summary || '';
      }

      if (!summaryText) {
        // Final fallback: pull raw messages and excerpt
        const res = await api.conversations.get(conv.id);
        const messages = res.data.messages || [];
        const userMsgs = messages.filter((m: any) => m.role === 'user');
        const assistantMsgs = messages.filter((m: any) => m.role === 'assistant');
        const firstUser = userMsgs[0]?.content?.[0]?.text || '';
        const lastAssistant = assistantMsgs[assistantMsgs.length - 1]?.content?.[0]?.text || '';
        summaryText = [
          firstUser ? `User: ${firstUser.slice(0, 300)}` : '',
          lastAssistant ? `Assistant: ${lastAssistant.slice(0, 300)}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      }

      addMention({
        kind: 'thread',
        label: `@thread:${conv.title.slice(0, 30)}`,
        context: `<thread title="${conv.title}" messages="${conv.messageCount}" source="prior-conversation">\n${summaryText || 'No content available.'}\n</thread>`,
      });
    } catch {
      closeMentionMenu();
      textarea?.focus();
    }
  }

  async function detectAndParseDiff(text: string) {
    const trimmed = text.trim();
    const isGitHubUrl = /https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|commit)\/\w+/.test(trimmed);
    const isRawDiff = trimmed.startsWith('diff --git') || trimmed.startsWith('---');
    if (!isGitHubUrl && !isRawDiff) return;

    diffLoading = true;
    try {
      const res = await api.diff.parse(trimmed, settingsStore.workspacePath || undefined);
      if (res.ok) diffPreview = res.data;
    } catch {
      /* ignore */
    } finally {
      diffLoading = false;
    }
  }

  function getDisplayPath(): string {
    const p = conversationStore.active?.workspacePath || settingsStore.workspacePath;
    return !p || p === '.' ? '~' : p;
  }

  function getBreadcrumbs(): { name: string; path: string }[] {
    const p = getDisplayPath();
    if (p === '~') return [{ name: '~', path: '' }];
    const parts = p.split('/').filter(Boolean);
    return parts.map((name, i) => ({
      name: i === 0 ? '/' + name : name,
      path: '/' + parts.slice(0, i + 1).join('/'),
    }));
  }

  function startEditingPath() {
    pathInputValue = settingsStore.workspacePath === '.' ? '' : settingsStore.workspacePath;
    editingPath = true;
    // Focus after Svelte renders the input
    setTimeout(() => pathInput?.focus(), 0);
  }

  function commitPathInput() {
    editingPath = false;
    const val = pathInputValue.trim();
    if (val && val !== getDisplayPath()) {
      settingsStore.update({ workspacePath: val });
      if (conversationStore.activeId) {
        api.conversations.update(conversationStore.activeId, { workspacePath: val });
        if (conversationStore.active) {
          conversationStore.active.workspacePath = val;
        }
      }
    }
  }

  async function browseDirectories(parentPath?: string) {
    try {
      const res = await api.files.directories(parentPath);
      browsedPath = res.data.parent;
      dirOptions = res.data.directories;
      showDirPicker = true;
    } catch {}
  }

  function selectDirectory(path: string) {
    settingsStore.update({ workspacePath: path });
    showDirPicker = false;
    // If mid-conversation, update the conversation's workspace path too
    if (conversationStore.activeId) {
      api.conversations.update(conversationStore.activeId, { workspacePath: path });
      if (conversationStore.active) {
        conversationStore.active.workspacePath = path;
      }
    }
  }

  async function send() {
    const text = inputText.trim();
    // Block sending if this conversation has an active stream
    const isStreamingHere =
      streamStore.isStreaming && streamStore.conversationId === conversationStore.activeId;
    if (!text || isStreamingHere) return;

    // Intercept `cd` as directory navigation
    if (text === 'cd' || text.startsWith('cd ')) {
      const target = text.slice(2).trim();
      const current = getDisplayPath();
      let newPath: string;
      if (!target || target === '~') {
        newPath = ''; // server defaults to homedir
      } else if (target === '..') {
        newPath = current.split('/').slice(0, -1).join('/') || '/';
      } else if (target.startsWith('/')) {
        newPath = target;
      } else {
        newPath = current === '/' ? '/' + target : current + '/' + target;
      }
      // Verify directory exists via the API then select it
      try {
        const res = await api.files.directories(newPath || undefined);
        selectDirectory(res.data.parent);
      } catch {
        // Directory doesn't exist — let it fall through to Claude
        selectDirectory(newPath);
      }
      inputText = '';
      resizeTextarea();
      return;
    }

    // Check for slash commands
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/);
      const cmdName = parts[0].slice(1);
      const cmdArgs = parts.slice(1).join(' ');
      const ctx: SlashCommandContext = {
        conversationId: conversationStore.activeId,
        sessionId: streamStore.sessionId,
        args: cmdArgs,
      };
      const result = executeSlashCommand(cmdName, ctx);
      if (result.handled) {
        inputText = '';
        resizeTextarea();
        showSlashMenu = false;
        // If command wants to send text to Claude, fall through below
        if (!result.sendAsMessage) return;
        // Replace text with the passthrough content
        const passthroughText = result.sendAsMessage;
        if (!conversationStore.activeId) {
          await createConversation(passthroughText);
        }
        await sendAndStream(conversationStore.activeId!, passthroughText);
        return;
      }
    }

    // Check for multi-part tasks — suggest splitting into stories
    if (!(conversationStore.active?.planMode || localPlanMode)) {
      const detection = detectMultiPartRequest(text);
      if (detection.isMultiPart && detection.tasks.length >= 2) {
        pendingMessage = text;
        taskSuggestion = detection;
        inputText = '';
        resizeTextarea();
        return;
      }
    }

    // Normal send
    await sendOriginalMessage(text);
  }

  /** Send a message through the normal flow (conversation creation + stream). */
  async function sendOriginalMessage(text: string) {
    if (!conversationStore.activeId) {
      await createConversation(text);
    }

    const contextPrefix = buildContextPrefix();
    const diffContext = diffPreview ? diffPreview.contextBlock + '\n\n' : '';
    diffPreview = null;
    inputText = '';
    resizeTextarea();
    contextFiles = new Set();
    mentions = [];
    await sendAndStream(conversationStore.activeId!, diffContext + contextPrefix + text);
  }

  // ── Task split suggestion handlers ──

  async function handleTaskConfirm(tasks: DetectedTask[]) {
    const workspacePath = workspaceListStore.activeWorkspace?.path || settingsStore.workspacePath;
    if (!workspacePath) return;

    const selected = tasks.filter((t) => t.selected);
    const result = await workStore.createStandaloneStories(
      workspacePath,
      selected.map((t) => ({ title: t.text })),
    );

    uiStore.toast(`Created ${result.created} stories`, 'success');
    uiStore.setSidebarTab('work');

    taskSuggestion = null;
    pendingMessage = '';
  }

  async function handleTaskConfirmAndLoop(tasks: DetectedTask[]) {
    await handleTaskConfirm(tasks);
    // Open loop config so user can configure and start
    uiStore.openModal('loop-config');
  }

  function handleTaskDismiss() {
    const text = pendingMessage;
    taskSuggestion = null;
    pendingMessage = '';
    sendOriginalMessage(text);
  }

  function handleToggleTask(index: number) {
    if (!taskSuggestion) return;
    const updated = [...taskSuggestion.tasks];
    updated[index] = { ...updated[index], selected: !updated[index].selected };
    taskSuggestion = { ...taskSuggestion, tasks: updated };
  }

  function handleEditTask(index: number, newText: string) {
    if (!taskSuggestion) return;
    const updated = [...taskSuggestion.tasks];
    updated[index] = { ...updated[index], text: newText };
    taskSuggestion = { ...taskSuggestion, tasks: updated };
  }

  async function createConversation(text: string) {
    // Use active workspace path if available, otherwise fall back to settings
    const workspacePath =
      workspaceListStore.activeWorkspace?.path ||
      (settingsStore.workspacePath !== '.' ? settingsStore.workspacePath : undefined);
    const res = await api.conversations.create({
      title: text.slice(0, 60),
      model: settingsStore.model,
      workspacePath,
      permissionMode: localTeachMode ? 'teach' : settingsStore.permissionMode,
      effort: settingsStore.effort,
      maxBudgetUsd: settingsStore.maxBudgetUsd ?? undefined,
      maxTurns: settingsStore.maxTurns ?? undefined,
      planMode: localPlanMode || undefined,
    });
    const convRes = await api.conversations.get(res.data.id);
    conversationStore.setActive(convRes.data);
    conversationStore.prependConversation({
      id: convRes.data.id,
      title: convRes.data.title,
      createdAt: convRes.data.createdAt,
      updatedAt: convRes.data.updatedAt,
      messageCount: 0,
      model: convRes.data.model,
    });
    localPlanMode = false;
    localTeachMode = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Send: Enter (default) or Ctrl+Enter depending on setting
    if (e.key === 'Enter') {
      if (settingsStore.sendWithEnter) {
        // Enter sends, Shift+Enter for newline
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          send();
          return;
        }
      } else {
        // Ctrl/Cmd+Enter sends, plain Enter for newline
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          send();
          return;
        }
      }
    }

    // Shift+Tab x2: toggle plan mode
    if (e.shiftKey && e.key === 'Tab') {
      e.preventDefault();
      const now = Date.now();
      if (now - lastShiftTab < 500) {
        lastShiftTab = 0;
        if (conversationStore.active) {
          conversationStore.setPlanMode(!conversationStore.active.planMode);
        } else {
          localPlanMode = !localPlanMode;
        }
      } else {
        lastShiftTab = now;
      }
      return;
    }

    // Slash command detection
    if (e.key === '/' && inputText === '') {
      showSlashMenu = true;
      slashQuery = '';
    }

    // @-mention detection
    if (e.key === '@') {
      const cursorPos = textarea?.selectionStart ?? inputText.length;
      // Show mention menu when @ is typed (at any position)
      showMentionMenu = true;
      mentionQuery = '';
      mentionAtPos = cursorPos;
      // Don't prevent default so @ gets inserted into input
    }

    // Escape: cancel streaming or close menus
    if (e.key === 'Escape') {
      if (activePicker) {
        activePicker = null;
        textarea?.focus();
      } else if (showMentionMenu) {
        closeMentionMenu();
      } else if (showSlashMenu) {
        showSlashMenu = false;
      } else if (
        streamStore.isStreaming &&
        streamStore.conversationId === conversationStore.activeId &&
        conversationStore.activeId
      ) {
        cancelStream(conversationStore.activeId);
      }
    }

    // Backspace: if we just deleted the @, close the mention menu
    if (e.key === 'Backspace' && showMentionMenu) {
      const cursorPos = textarea?.selectionStart ?? 0;
      if (cursorPos <= mentionAtPos) {
        closeMentionMenu();
      }
    }
  }

  function handleInput() {
    resizeTextarea();
    // Slash command filtering
    if (inputText.startsWith('/')) {
      showSlashMenu = true;
      slashQuery = inputText.slice(1);
    } else {
      showSlashMenu = false;
    }

    // Update mention menu query as user types after '@'
    if (showMentionMenu && mentionAtPos >= 0) {
      const cursorPos = textarea?.selectionStart ?? inputText.length;
      if (cursorPos > mentionAtPos) {
        // Extract query text after '@'
        const textAfterAt = inputText.slice(mentionAtPos + 1, cursorPos);
        // If there's a space, the mention token ended — close menu
        if (/\s/.test(textAfterAt)) {
          closeMentionMenu();
        } else {
          mentionQuery = textAfterAt;
        }
      } else {
        // Cursor went back before '@'
        closeMentionMenu();
      }
    }

    // Detect if the entire input is a diff/URL and show preview
    if (inputText.trim().length > 10) {
      detectAndParseDiff(inputText.trim());
    } else {
      diffPreview = null;
    }
  }

  function resizeTextarea() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';
  }

  function handleVoiceTranscript(text: string) {
    inputText = inputText ? inputText + ' ' + text : text;
    resizeTextarea();
  }

  function selectSlashCommand(command: string) {
    // For commands that need args (theme, model, permissions), put them in the input
    const needsArgs = ['theme', 'model', 'permissions'];
    if (needsArgs.includes(command)) {
      inputText = `/${command} `;
      showSlashMenu = false;
      textarea?.focus();
      return;
    }

    // For no-arg commands, execute immediately
    inputText = `/${command}`;
    showSlashMenu = false;
    send();
  }
</script>

<svelte:window
  onclick={(e) => {
    if (showDirPicker && dirScopeEl && !dirScopeEl.contains(e.target as Node)) {
      showDirPicker = false;
    }
  }}
/>

<div class="chat-input-container">
  {#if showSlashMenu}
    <SlashCommandMenu
      query={slashQuery}
      onSelect={selectSlashCommand}
      onClose={() => (showSlashMenu = false)}
    />
  {/if}

  {#if showMentionMenu && !activePicker}
    <MentionMenu
      query={mentionQuery}
      onSelect={handleMentionTypeSelect}
      onClose={closeMentionMenu}
    />
  {/if}

  {#if activePicker === 'file'}
    <MentionFilePicker onSelect={handleFileMentionSelect} onClose={closeMentionMenu} />
  {:else if activePicker === 'symbol'}
    <MentionSymbolPicker onSelect={handleSymbolMentionSelect} onClose={closeMentionMenu} />
  {:else if activePicker === 'rule'}
    <MentionRulePicker onSelect={handleRuleMentionSelect} onClose={closeMentionMenu} />
  {:else if activePicker === 'thread'}
    <MentionThreadPicker onSelect={handleThreadMentionSelect} onClose={closeMentionMenu} />
  {/if}

  {#if diffLoading}
    <div class="diff-detecting">Detecting diff...</div>
  {:else if diffPreview}
    <div class="diff-preview">
      <div class="diff-preview-header">
        <span class="diff-type-badge">{diffPreview.type.replace('_', ' ')}</span>
        {#if diffPreview.title}<span class="diff-title">{diffPreview.title}</span>{/if}
        <span class="diff-stats">
          {diffPreview.summary.filesChanged} files
          <span class="insertions">+{diffPreview.summary.insertions}</span>
          <span class="deletions">-{diffPreview.summary.deletions}</span>
        </span>
        <button class="diff-dismiss" onclick={() => (diffPreview = null)}>×</button>
      </div>
      <div class="diff-files">
        {#each diffPreview.files.slice(0, 5) as f}
          <span class="diff-file">{f.path}</span>
        {/each}
        {#if diffPreview.files.length > 5}
          <span class="diff-more">+{diffPreview.files.length - 5} more</span>
        {/if}
      </div>
    </div>
  {/if}

  {#if taskSuggestion}
    <TaskSplitSuggestion
      tasks={taskSuggestion.tasks}
      onConfirm={handleTaskConfirm}
      onConfirmAndLoop={handleTaskConfirmAndLoop}
      onDismiss={handleTaskDismiss}
      onToggleTask={handleToggleTask}
      onEditTask={handleEditTask}
    />
  {/if}

  <div class="dir-scope" bind:this={dirScopeEl}>
    <div class="dir-breadcrumbs">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        ><path
          d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
        /></svg
      >
      {#if editingPath}
        <input
          class="dir-path-input"
          bind:this={pathInput}
          bind:value={pathInputValue}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              commitPathInput();
            }
            if (e.key === 'Escape') {
              editingPath = false;
            }
          }}
          onblur={() => commitPathInput()}
        />
      {:else}
        {#each getBreadcrumbs() as crumb, i}
          {#if i > 0}<span class="breadcrumb-sep">/</span>{/if}
          <button class="breadcrumb" onclick={() => browseDirectories(crumb.path)}
            >{crumb.name}</button
          >
        {/each}
        <button class="breadcrumb-edit" onclick={startEditingPath} title="Type a path">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            ><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path
              d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
            /></svg
          >
        </button>
      {/if}
    </div>
    {#if showDirPicker}
      <div class="dir-picker">
        {#if browsedPath !== '/'}
          <button
            class="dir-option"
            onclick={() => {
              const parent = browsedPath.split('/').slice(0, -1).join('/') || '/';
              browseDirectories(parent);
            }}>..</button
          >
        {/if}
        <button class="dir-option dir-select" onclick={() => selectDirectory(browsedPath)}>
          Select this directory
        </button>
        {#each dirOptions as dir}
          <button class="dir-option" onclick={() => browseDirectories(dir.path)}>
            {dir.name}/
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if mentions.length > 0}
    <div class="mention-badges">
      {#each mentions as mention (mention.id)}
        <div class="mention-badge" class:collapsed={mention.collapsed}>
          <button
            class="mention-badge-label"
            onclick={() => toggleMentionCollapse(mention.id)}
            title={mention.collapsed ? 'Expand context' : 'Collapse context'}
          >
            <span class="mention-badge-kind">{mention.label}</span>
            <span class="mention-badge-arrow">{mention.collapsed ? '▶' : '▼'}</span>
          </button>
          {#if !mention.collapsed}
            <div class="mention-badge-preview">
              <pre class="mention-context-text">{mention.context.slice(0, 300)}{mention.context
                  .length > 300
                  ? '…'
                  : ''}</pre>
            </div>
          {/if}
          <button
            class="mention-badge-remove"
            onclick={() => removeMention(mention.id)}
            title="Remove mention">×</button
          >
        </div>
      {/each}
    </div>
  {/if}

  {#if editorStore.tabs.length > 0}
    <div class="context-chips">
      {#each editorStore.tabs as tab}
        <button
          class="context-chip"
          class:active={contextFiles.has(tab.id)}
          onclick={() => toggleContextFile(tab.id)}
          title={tab.filePath}
        >
          {tab.fileName}
        </button>
      {/each}
    </div>
  {/if}

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="input-wrapper"
    class:plan-active={conversationStore.active?.planMode || localPlanMode}
    onmousedown={(e) => {
      if (e.target !== textarea) {
        e.preventDefault();
        textarea?.focus();
      }
    }}
  >
    <textarea
      bind:this={textarea}
      bind:value={inputText}
      onkeydown={handleKeydown}
      oninput={handleInput}
      placeholder={conversationStore.active?.planMode || localPlanMode
        ? 'Describe what you want to plan...'
        : 'Message Claude...'}
      rows="1"
      disabled={streamStore.status === 'tool_pending'}
    ></textarea>

    <div class="input-actions">
      {#if conversationStore.active?.planMode || localPlanMode}
        <span class="plan-indicator">PLAN</span>
      {/if}

      {#if localTeachMode}
        <span class="teach-indicator">TEACH</span>
      {/if}
      <button
        class="btn-icon-sm"
        class:active={localTeachMode}
        onclick={() => (localTeachMode = !localTeachMode)}
        title="Teach Me Mode — Claude guides you with questions instead of answers">🎓</button
      >

      <VoiceButton onTranscript={handleVoiceTranscript} />

      {#if streamStore.isStreaming && streamStore.conversationId === conversationStore.activeId}
        <button
          class="btn-action cancel"
          onclick={() => conversationStore.activeId && cancelStream(conversationStore.activeId)}
          title="Cancel (Esc)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
        </button>
      {:else}
        <button
          class="btn-action send"
          onclick={send}
          disabled={!inputText.trim()}
          title={settingsStore.sendWithEnter ? 'Send (Enter)' : 'Send (Ctrl+Enter)'}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .chat-input-container {
    position: relative;
    padding: 12px 28px 20px;
    background: var(--bg-primary);
    z-index: 1;
  }
  /* Let stars show through in canvas-based hyperthemes */
  :global([data-hypertheme='arcane']) .chat-input-container,
  :global([data-hypertheme='ethereal']) .chat-input-container,
  :global([data-hypertheme='astral']) .chat-input-container,
  :global([data-hypertheme='astral-midnight']) .chat-input-container,
  :global([data-hypertheme='study']) .chat-input-container {
    background: transparent;
  }

  .dir-scope {
    position: relative;
    margin-bottom: 6px;
  }
  .dir-breadcrumbs {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 12px;
    color: var(--text-tertiary);
    padding: 4px 8px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .dir-breadcrumbs::-webkit-scrollbar {
    display: none;
  }
  .breadcrumb {
    color: var(--text-tertiary);
    font-size: 12px;
    padding: 1px 4px;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    transition: all var(--transition);
  }
  .breadcrumb:hover {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .breadcrumb-sep {
    color: var(--text-tertiary);
    opacity: 0.4;
    margin: 0 1px;
  }
  .breadcrumb-edit {
    color: var(--text-tertiary);
    opacity: 0.4;
    padding: 2px 4px;
    margin-left: 4px;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .breadcrumb-edit:hover {
    opacity: 1;
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .dir-path-input {
    flex: 1;
    font-size: 12px;
    font-family: var(--font-family-mono, monospace);
    color: var(--text-primary);
    background: var(--bg-input);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    margin-left: 6px;
    outline: none;
  }

  .dir-picker {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    max-height: 240px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    padding: 4px;
    z-index: 10;
    box-shadow: var(--shadow-lg);
  }
  .dir-option {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .dir-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .dir-option.dir-select {
    color: var(--accent-primary);
    font-weight: 600;
  }

  .context-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
    padding: 0 4px;
  }
  .context-chip {
    font-size: 11px;
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--border-secondary);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
  }
  .context-chip:hover {
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }
  .context-chip.active {
    background: var(--bg-active);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    font-weight: 600;
  }

  .input-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-input);
    border: none;
    border-radius: var(--radius);
    padding: var(--ht-input-padding);
    transition: all var(--transition);
    cursor: text;
    outline: none;
  }
  .input-wrapper:focus-within {
    border: none;
    box-shadow: none;
    outline: none;
  }
  .input-wrapper.plan-active {
    border: none;
    box-shadow: none;
    outline: none;
  }
  .input-wrapper.plan-active:focus-within {
    border: none;
    box-shadow: none;
    outline: none;
  }

  /* ── Hypertheme input variants ── */

  /* Ethereal */
  :global([data-hypertheme='ethereal']) .input-wrapper {
    border-radius: var(--radius-xl);
  }

  /* Arcane */
  :global([data-hypertheme='arcane']) .input-wrapper {
    background-image: linear-gradient(0deg, rgba(139, 92, 246, 0.03), transparent 30%);
  }

  /* Astral — don't stack another opaque layer on top of the glass parent */
  :global([data-hypertheme='astral']) .input-wrapper,
  :global([data-hypertheme='astral-midnight']) .input-wrapper {
    background: transparent;
  }

  /* Study — warm inner glow, no ruled-paper lines */
  :global([data-hypertheme='study']) .input-wrapper {
    background-image: radial-gradient(
      ellipse 80% 60% at 50% 100%,
      rgba(228, 160, 60, 0.03) 0%,
      transparent 70%
    );
  }

  textarea {
    flex: 1;
    border: none;
    background: transparent;
    resize: none;
    font-family: var(--font-family-sans);
    font-size: var(--font-size-sans);
    font-weight: 500;
    line-height: 1.5;
    color: var(--text-primary);
    min-height: 24px;
    max-height: 300px;
    padding: 0;
    outline: none;
    box-shadow: none;
    letter-spacing: 0.3px;
  }
  textarea:focus {
    outline: none;
    box-shadow: none;
  }
  textarea::placeholder {
    color: var(--text-tertiary);
    letter-spacing: 0.5px;
  }
  textarea:disabled {
    opacity: 0.4;
  }

  .input-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .plan-indicator {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    background: var(--accent-warning);
    color: var(--text-on-accent);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
  }

  .teach-indicator {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 10px;
    border-radius: var(--radius-sm);
    background: var(--accent-secondary, #10b981);
    color: var(--text-on-accent);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
  }
  .btn-icon-sm {
    font-size: 14px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    color: var(--text-tertiary);
    opacity: 0.6;
  }
  .btn-icon-sm:hover,
  .btn-icon-sm.active {
    opacity: 1;
    background: var(--bg-hover);
  }

  .btn-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius);
    border: 1px solid transparent;
    transition: all var(--transition);
  }
  .btn-action:disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }

  .btn-action.send {
    color: var(--text-tertiary);
  }
  .btn-action.send:hover:not(:disabled) {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--bg-hover);
    box-shadow: var(--shadow-glow-sm);
  }

  .btn-action.cancel {
    color: var(--accent-error);
  }
  .btn-action.cancel:hover {
    border-color: var(--accent-error);
    background: var(--bg-hover);
    box-shadow: var(--shadow-glow-sm);
  }

  .diff-detecting {
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 4px 8px;
    animation: pulse 1s infinite;
  }
  .diff-preview {
    margin-bottom: 8px;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-left: 3px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }
  .diff-preview-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .diff-type-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 6px;
    background: var(--bg-active);
    color: var(--accent-primary);
    border-radius: var(--radius-sm);
  }
  .diff-title {
    flex: 1;
    color: var(--text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .diff-stats {
    color: var(--text-tertiary);
    font-size: 11px;
    margin-left: auto;
    display: flex;
    gap: 6px;
  }
  .insertions {
    color: #22c55e;
  }
  .deletions {
    color: #ef4444;
  }
  .diff-dismiss {
    color: var(--text-tertiary);
    font-size: 16px;
    padding: 0 4px;
    margin-left: 4px;
  }
  .diff-dismiss:hover {
    color: var(--text-primary);
  }
  .diff-files {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .diff-file {
    font-size: 10px;
    font-family: var(--font-family);
    color: var(--text-secondary);
    background: var(--bg-hover);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
  }
  .diff-more {
    font-size: 10px;
    color: var(--text-tertiary);
    padding: 1px 6px;
  }

  /* ── @-mention badges ── */
  .mention-badges {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
    padding: 0 4px;
  }

  .mention-badge {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-left: 3px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    font-size: 12px;
    overflow: hidden;
    transition: border-color var(--transition);
  }
  .mention-badge:hover {
    border-color: var(--accent-primary);
  }

  .mention-badge-label {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    text-align: left;
    cursor: pointer;
    background: transparent;
  }
  .mention-badge-label:hover {
    background: var(--bg-hover);
  }

  .mention-badge-kind {
    font-weight: 600;
    color: var(--accent-primary);
    font-size: 11px;
    flex: 1;
  }

  .mention-badge-arrow {
    font-size: 9px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .mention-badge-preview {
    padding: 4px 8px 6px;
    border-top: 1px solid var(--border-secondary);
  }

  .mention-context-text {
    font-family: var(--font-family-mono, monospace);
    font-size: 10px;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
    max-height: 80px;
    overflow: hidden;
    line-height: 1.4;
  }

  .mention-badge-remove {
    position: absolute;
    top: 3px;
    right: 4px;
    color: var(--text-tertiary);
    font-size: 14px;
    line-height: 1;
    padding: 0 3px;
    opacity: 0;
    transition: opacity var(--transition);
  }
  .mention-badge {
    position: relative;
  }
  .mention-badge:hover .mention-badge-remove {
    opacity: 1;
  }
  .mention-badge-remove:hover {
    color: var(--accent-error);
  }
</style>
