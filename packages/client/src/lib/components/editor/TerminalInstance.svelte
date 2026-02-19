<script lang="ts">
  import { onMount } from 'svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import '@xterm/xterm/css/xterm.css';

  let { sessionId, active = true } = $props<{ sessionId: string; active?: boolean }>();

  let containerEl: HTMLDivElement;
  let mounted = $state(false);

  /** Resolve the working directory for new sessions */
  function getCwd(): string {
    return (
      workspaceListStore.activeWorkspace?.path ||
      conversationStore.active?.workspacePath ||
      settingsStore.workspacePath ||
      '.'
    );
  }

  /** Create or reconnect a session via the ConnectionManager */
  async function ensureSession() {
    if (!terminalConnectionManager.has(sessionId)) {
      // Session doesn't exist in ConnectionManager — create it
      try {
        const createdId = await terminalConnectionManager.createSession({
          cwd: getCwd(),
          cols: 80,
          rows: 24,
        });

        // Register session in the store
        terminalStore.registerSession({
          id: createdId,
          shell: 'sh',
          pid: 0,
          cwd: getCwd(),
          exitCode: null,
          attached: true,
        });

        // If the store's session ID differs from what the connection manager created,
        // we need to update the tab's layout to point to the actual session ID.
        // For now, both should match via the store's createTab flow.
        if (createdId !== sessionId) {
          // Update the tab layout to use the real session ID
          const tab = terminalStore.activeTab;
          if (tab && tab.focusedSessionId === sessionId) {
            tab.focusedSessionId = createdId;
            tab.layout = { type: 'leaf', sessionId: createdId };
          }
          sessionId = createdId;
        }
      } catch (err) {
        console.error('[TerminalInstance] Failed to create session:', err);
        return;
      }
    }

    // Attach to container if mounted and active
    if (mounted && containerEl && active) {
      try {
        terminalConnectionManager.attachToContainer(sessionId, containerEl);
        terminalConnectionManager.focus(sessionId);
      } catch (err) {
        console.error('[TerminalInstance] Failed to attach:', err);
      }
    }
  }

  // Re-derive and apply theme when settings change
  $effect(() => {
    // Access reactive theme/hypertheme values to trigger on change
    const _theme = settingsStore.theme;
    const _ht = settingsStore.hypertheme;

    // Reapply theme on next tick so CSS vars have updated
    if (typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        terminalConnectionManager.reapplyTheme();
      });
    }
  });

  // When active state changes, attach/detach
  $effect(() => {
    if (!mounted || !containerEl) return;

    if (active && terminalConnectionManager.has(sessionId)) {
      terminalConnectionManager.attachToContainer(sessionId, containerEl);
      terminalConnectionManager.focus(sessionId);
    } else if (!active && terminalConnectionManager.has(sessionId)) {
      terminalConnectionManager.detachFromContainer(sessionId);
    }
  });

  onMount(() => {
    mounted = true;
    ensureSession();

    return () => {
      mounted = false;
      // Detach from DOM but keep session alive (AC #9)
      if (terminalConnectionManager.has(sessionId)) {
        terminalConnectionManager.detachFromContainer(sessionId);
      }
    };
  });
</script>

<div class="terminal-instance" bind:this={containerEl} class:hidden={!active}></div>

<style>
  .terminal-instance {
    flex: 1;
    min-height: 0;
    padding: 4px;
  }
  .terminal-instance :global(.xterm) {
    height: 100%;
  }
  .terminal-instance.hidden {
    display: none;
  }
</style>
