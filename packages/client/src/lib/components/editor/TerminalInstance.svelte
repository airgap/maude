<script lang="ts">
  import { onMount } from 'svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
  import type { ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';
  import { shellEscapePath } from '$lib/utils/shell-escape';
  import '@xterm/xterm/css/xterm.css';

  let { sessionId, active = true } = $props<{ sessionId: string; active?: boolean }>();

  let containerEl: HTMLDivElement;
  let mounted = $state(false);

  // ── Context menu state ──
  let showCtx = $state(false);
  let ctxX = $state(0);
  let ctxY = $state(0);

  // ── Drag-and-drop state ──
  let dragOver = $state(false);

  /** Resolve the working directory for new sessions */
  function getCwd(): string {
    return (
      workspaceListStore.activeWorkspace?.path ||
      conversationStore.active?.workspacePath ||
      settingsStore.workspacePath ||
      '.'
    );
  }

  // ── Clipboard actions ──

  /** Copy the current terminal selection to clipboard */
  async function copySelection(): Promise<void> {
    const text = terminalConnectionManager.getSelection(sessionId);
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API may fail in some contexts
      }
    }
  }

  /** Paste from clipboard into the terminal */
  async function pasteClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        terminalConnectionManager.write(sessionId, text);
      }
    } catch {
      // Clipboard API may fail in some contexts
    }
  }

  /** Register keyboard handler for search + clipboard shortcuts on the terminal */
  function registerKeyHandler() {
    terminalConnectionManager.attachCustomKeyHandler(sessionId, (ev: KeyboardEvent) => {
      // Ctrl+Shift+C: copy terminal selection to clipboard
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === 'C') {
        ev.preventDefault();
        ev.stopPropagation();
        copySelection();
        return false;
      }

      // Ctrl+Shift+V: paste from clipboard into terminal
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === 'V') {
        ev.preventDefault();
        ev.stopPropagation();
        pasteClipboard();
        return false;
      }

      // Ctrl+Shift+F: open terminal search for this instance
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === 'F') {
        ev.preventDefault();
        ev.stopPropagation();
        terminalStore.openSearchForSession(sessionId);
        return false;
      }

      // Escape: close search if open for this instance
      if (ev.key === 'Escape' && terminalStore.isSearchOpen(sessionId)) {
        ev.preventDefault();
        ev.stopPropagation();
        terminalStore.closeSearchForSession(sessionId);
        terminalConnectionManager.clearSearch(sessionId);
        return false;
      }

      return true;
    });
  }

  /** Register copy-on-select handler */
  function registerCopyOnSelect(): (() => void) | undefined {
    return terminalConnectionManager.onSelectionChange(sessionId, () => {
      if (!terminalStore.preferences.copyOnSelect) return;
      const text = terminalConnectionManager.getSelection(sessionId);
      if (text) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    });
  }

  // ── Context menu ──

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    ctxX = e.clientX;
    ctxY = e.clientY;
    showCtx = true;
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');

  let ctxItems = $derived<ContextMenuItem[]>([
    {
      label: 'Copy',
      shortcut: isMac ? '⌘⇧C' : 'Ctrl+Shift+C',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
      disabled: !terminalConnectionManager.hasSelection(sessionId),
      action: () => copySelection(),
    },
    {
      label: 'Paste',
      shortcut: isMac ? '⌘⇧V' : 'Ctrl+Shift+V',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`,
      action: () => pasteClipboard(),
    },
    {
      label: 'Select All',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>`,
      action: () => terminalConnectionManager.selectAll(sessionId),
    },
    { kind: 'separator' },
    {
      label: 'Clear Terminal',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="10"/></svg>`,
      action: () => terminalConnectionManager.clearTerminal(sessionId),
    },
    { kind: 'separator' },
    {
      label: 'Split Horizontally',
      shortcut: isMac ? '⌘⇧H' : 'Ctrl+Shift+H',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`,
      action: () => terminalStore.splitActive('horizontal'),
    },
    {
      label: 'Split Vertically',
      shortcut: isMac ? '⌘⇧V' : 'Ctrl+Shift+\\',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>`,
      action: () => terminalStore.splitActive('vertical'),
    },
    { kind: 'separator' },
    {
      label: 'Close Terminal',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      danger: true,
      action: () => {
        terminalConnectionManager.destroySession(sessionId);
        terminalStore.closeSplit(sessionId);
      },
    },
  ]);

  // ── Drag-and-drop handlers ──

  function handleDragOver(e: DragEvent) {
    // Only accept file-path drops from the FileTree
    if (e.dataTransfer?.types.includes('text/terminal-path')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      dragOver = true;
    }
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    dragOver = false;
    if (!e.dataTransfer) return;

    const filePath = e.dataTransfer.getData('text/terminal-path');
    if (filePath) {
      e.preventDefault();
      e.stopPropagation();
      // Shell-escape and write to terminal
      const escaped = shellEscapePath(filePath);
      terminalConnectionManager.write(sessionId, escaped);
      terminalConnectionManager.focus(sessionId);
    }
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

    // Register custom key handler for clipboard + search shortcuts
    registerKeyHandler();
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

  let cleanupCopyOnSelect: (() => void) | undefined;

  onMount(() => {
    mounted = true;
    ensureSession();
    cleanupCopyOnSelect = registerCopyOnSelect();

    return () => {
      mounted = false;
      cleanupCopyOnSelect?.();
      // Detach from DOM but keep session alive (AC #9)
      if (terminalConnectionManager.has(sessionId)) {
        terminalConnectionManager.detachFromContainer(sessionId);
      }
    };
  });
</script>

<!-- Context menu -->
{#if showCtx}
  <ContextMenu
    items={ctxItems}
    x={ctxX}
    y={ctxY}
    onClose={() => {
      showCtx = false;
    }}
  />
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="terminal-instance"
  class:hidden={!active}
  class:drag-over={dragOver}
  bind:this={containerEl}
  oncontextmenu={handleContextMenu}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
></div>

<style>
  .terminal-instance {
    flex: 1;
    min-height: 0;
    padding: 4px;
    transition: outline var(--transition);
  }
  .terminal-instance :global(.xterm) {
    height: 100%;
  }
  .terminal-instance.hidden {
    display: none;
  }
  .terminal-instance.drag-over {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }
  /* Tooltip shown when hovering clickable links in terminal output */
  .terminal-instance :global(.terminal-link-tooltip) {
    font-family: var(--font-ui, system-ui, sans-serif);
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
