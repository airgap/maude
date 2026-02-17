<script lang="ts">
  import type { Snippet } from 'svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { api } from '$lib/api/client';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { onMount } from 'svelte';
  import PrimaryTabBar from './PrimaryTabBar.svelte';
  import SplitPane from './SplitPane.svelte';

  let { children }: { children: Snippet } = $props();

  let pane = $derived(primaryPaneStore.panes[0]);

  // ── Tab → conversation sync ──
  // When the user clicks a tab in the tab bar, load the corresponding conversation.
  // Track the "last applied" tab ID to avoid re-firing on unrelated reactive updates.
  // Seed with the initial active tab so we don't double-load on mount.
  let lastAppliedTabId = $state<string | null>(null);
  onMount(() => {
    lastAppliedTabId = primaryPaneStore.activeTab()?.id ?? null;
  });

  $effect(() => {
    const tab = primaryPaneStore.activeTab();
    if (!tab || tab.id === lastAppliedTabId) return;
    lastAppliedTabId = tab.id;

    if (tab.conversationId === null) {
      // Blank/new tab — start a new conversation
      conversationStore.setActive(null);
      conversationStore.clearDraft();
      conversationStore.createDraft();
      if (!streamStore.isStreaming) streamStore.reset();
      uiStore.focusChatInput();
    } else if (tab.conversationId !== conversationStore.activeId) {
      // Load conversation for this tab
      conversationStore.setLoading(true);
      api.conversations
        .get(tab.conversationId)
        .then((res) => {
          conversationStore.setActive(res.data);
          if (!streamStore.isStreaming || streamStore.conversationId === tab.conversationId) {
            streamStore.reset();
          }
        })
        .catch((err) => {
          console.error('Failed to load conversation for tab:', err);
        })
        .finally(() => {
          conversationStore.setLoading(false);
        });
    }
  });

  // ── Conversation → tab sync ──
  // When conversationStore.active changes (e.g. sidebar click, page load restore),
  // ensure the tab bar reflects the active conversation.
  $effect(() => {
    const active = conversationStore.active;
    if (!active) {
      // active went null (new conversation from sidebar) — focus the blank tab or add one
      const blankTab = pane?.tabs.find((t) => t.conversationId === null);
      if (blankTab && pane && pane.activeTabId !== blankTab.id) {
        primaryPaneStore.setActiveTab(pane.id, blankTab.id);
        lastAppliedTabId = blankTab.id;
      } else if (!blankTab && pane) {
        primaryPaneStore.openConversation(null, 'New chat', pane.id);
      }
      return;
    }

    const tabExists = pane?.tabs.some((t) => t.conversationId === active.id);
    if (!tabExists) {
      primaryPaneStore.openConversation(active.id, active.title ?? 'Conversation', pane?.id);
    } else {
      const tab = pane?.tabs.find((t) => t.conversationId === active.id);
      if (tab && pane && pane.activeTabId !== tab.id) {
        primaryPaneStore.setActiveTab(pane.id, tab.id);
        lastAppliedTabId = tab.id;
      }
    }
  });

  // Keep tab titles in sync when conversation title updates
  $effect(() => {
    const active = conversationStore.active;
    if (active?.id && active.title) {
      primaryPaneStore.updateTabTitle(active.id, active.title);
    }
  });

  let showSplit = $derived(primaryPaneStore.isSplit);

  function handleSplitRatio(r: number) {
    primaryPaneStore.setSplitRatio(r);
    editorStore.setSplitRatio(r);
  }
</script>

<div class="primary-pane">
  {#if pane}
    <PrimaryTabBar {pane} />
  {/if}

  <div class="primary-content">
    {#if showSplit}
      <!-- Split: chat | editor -->
      <SplitPane
        ratio={primaryPaneStore.splitRatio}
        direction="horizontal"
        onRatioChange={handleSplitRatio}
      >
        {#snippet first()}
          <div class="chat-slot">
            {@render children()}
          </div>
        {/snippet}
        {#snippet second()}
          <!-- Second pane tab bar for the split side -->
          {#if primaryPaneStore.panes[1]}
            <div class="split-secondary">
              <PrimaryTabBar pane={primaryPaneStore.panes[1]} />
              <div class="split-secondary-content">
                <!-- Editor pane or placeholder -->
                <div class="split-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 3v18M3 9h6M3 15h6" />
                  </svg>
                  <p>Open a file from the sidebar to view it here</p>
                </div>
              </div>
            </div>
          {/if}
        {/snippet}
      </SplitPane>
    {:else}
      <div class="chat-slot">
        {@render children()}
      </div>
    {/if}
  </div>
</div>

<style>
  .primary-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .primary-content {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .chat-slot {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .split-secondary {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-left: 1px solid var(--border-primary);
  }

  .split-secondary-content {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .split-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-tertiary);
    padding: 40px;
    text-align: center;
  }

  .split-placeholder svg {
    width: 36px;
    height: 36px;
    opacity: 0.25;
  }

  .split-placeholder p {
    font-size: 13px;
    margin: 0;
    opacity: 0.7;
  }
</style>
