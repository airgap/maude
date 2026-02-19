<script lang="ts">
  import { onMount } from 'svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { getBaseUrl, getAuthToken } from '$lib/api/client';
  import TerminalHeader from './TerminalHeader.svelte';
  import TerminalContent from './TerminalContent.svelte';
  import '@xterm/xterm/css/xterm.css';

  /** Fetch available shell profiles from the server */
  async function loadShellProfiles() {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${getBaseUrl()}/terminal/shells`, { headers });
      if (res.ok) {
        const { data } = await res.json();
        if (Array.isArray(data)) {
          terminalStore.setProfiles(
            data.map((s: { path: string; name: string; version: string }) => ({
              id: s.name.toLowerCase(),
              name: `${s.name}${s.version ? ` (${s.version})` : ''}`,
              shellPath: s.path,
              args: [],
              env: {},
              icon: 'terminal',
            })),
          );
        }
      }
    } catch {
      // Shell profiles are optional — terminal will use defaults
    }
  }

  onMount(() => {
    // Initialize store from localStorage
    terminalStore.init();

    // Load shell profiles
    loadShellProfiles();

    // If no tabs exist, create one
    if (terminalStore.tabs.length === 0) {
      terminalStore.createTab();
    }

    // Set up broadcast handler: when broadcast mode is active for a tab,
    // replicate keyboard input to all sibling sessions in the same tab.
    terminalConnectionManager.setBroadcastHandler((sourceSessionId, data) => {
      // Check if broadcast is enabled for the tab containing this session
      if (!terminalStore.isBroadcastActiveForSession(sourceSessionId)) return;

      // Get all sibling sessions (same tab, excluding the source)
      const siblings = terminalStore.getSiblingSessionIds(sourceSessionId);
      for (const siblingId of siblings) {
        terminalConnectionManager.write(siblingId, data);
      }
    });

    // Closing the panel does NOT kill sessions (AC #9).
    // On unmount, we just detach terminals from DOM.
    return () => {
      // Clear the broadcast handler on unmount
      terminalConnectionManager.setBroadcastHandler(null);
      // Sessions stay alive in ConnectionManager memory.
      // When panel reopens, TerminalInstance will reattach.
    };
  });

  // Sync terminal preferences from settingsStore → terminalStore → connectionManager
  $effect(() => {
    // Read all terminal settings from settingsStore (these are reactive)
    const prefs = {
      fontFamily: settingsStore.termFontFamily,
      fontSize: settingsStore.termFontSize,
      fontWeight: settingsStore.termFontWeight,
      lineHeight: settingsStore.termLineHeight,
      cursorStyle: settingsStore.termCursorStyle,
      cursorBlink: settingsStore.termCursorBlink,
      scrollback: settingsStore.termScrollback,
      bellStyle: settingsStore.termBellStyle,
      copyOnSelect: settingsStore.termCopyOnSelect,
      rightClickPaste: settingsStore.termRightClickPaste,
      defaultShell: settingsStore.termDefaultShell,
      enableShellIntegration: settingsStore.termEnableShellIntegration,
      enableImages: false,
    };
    // Push to terminalStore (persists in its own localStorage)
    terminalStore.updatePreferences(prefs);
    // Apply immediately to all open terminals
    terminalConnectionManager.updatePreferences(prefs);
  });

  // Panel height — default 250px, resizable 100-600px (AC #10)
  const panelHeight = $derived(
    terminalStore.maximized ? undefined : terminalStore.panelHeight,
  );
</script>

<div
  class="terminal-panel"
  class:maximized={terminalStore.maximized}
  style:height={panelHeight ? `${panelHeight}px` : undefined}
>
  <TerminalHeader />
  <TerminalContent />
</div>

<style>
  .terminal-panel {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-primary);
    background: var(--bg-primary);
    min-height: 100px;
    max-height: 600px;
  }

  .terminal-panel.maximized {
    flex: 1;
    max-height: none;
    min-height: 0;
  }
</style>
