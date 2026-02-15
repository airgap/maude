<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { projectStore } from '$lib/stores/projects.svelte';
  import { getWsBase } from '$lib/api/client';
  import '@xterm/xterm/css/xterm.css';

  let containerEl: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let ws: WebSocket | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let readyTimeout: ReturnType<typeof setTimeout>;
  let messageBuffer: string[] = [];

  function getWsUrl(): string {
    const cwd =
      projectStore.activeProject?.path ||
      conversationStore.active?.projectPath ||
      settingsStore.projectPath ||
      '.';
    return `${getWsBase()}/terminal/ws?cwd=${encodeURIComponent(cwd)}&cols=80&rows=24`;
  }

  function connect() {
    if (ws) {
      ws.close();
      ws = null;
    }

    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'var(--font-family-mono, monospace)',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#00b4ff',
        selectionBackground: 'rgba(0, 180, 255, 0.3)',
        black: '#0d1117',
        red: '#ff3344',
        green: '#00ff88',
        yellow: '#ffaa00',
        blue: '#00b4ff',
        magenta: '#f778ba',
        cyan: '#56d4dd',
        white: '#c9d1d9',
        brightBlack: '#6e7681',
        brightRed: '#ff6b7a',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#76e3ea',
        brightWhite: '#f0f6fc',
      },
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(containerEl);

    // Try WebGL addon for performance
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL not supported, fallback to canvas
    }

    fitAddon.fit();

    const url = getWsUrl();
    ws = new WebSocket(url);

    // Ensure terminal is ready before receiving messages
    // This is a workaround for a race condition where data arrives before terminal is fully rendered
    let isReady = false;
    readyTimeout = setTimeout(() => {
      isReady = true;
      // Flush any buffered messages
      if (messageBuffer.length > 0) {
        messageBuffer.forEach((msg) => terminal?.write(msg));
        messageBuffer.length = 0;
      }
    }, 100);

    ws.onopen = () => {
      terminalStore.setConnected(true);
      // Send initial size
      if (terminal && fitAddon) {
        fitAddon.fit();
        ws?.send(`\x01${terminal.cols},${terminal.rows}`);
      }
    };

    ws.onmessage = (e) => {
      if (isReady) {
        terminal?.write(e.data);
      } else {
        // Buffer messages until terminal is ready
        messageBuffer.push(e.data);
      }
    };

    ws.onclose = () => {
      terminalStore.setConnected(false);
    };

    ws.onerror = () => {
      terminalStore.setConnected(false);
    };

    terminal.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    terminal.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(`\x01${cols},${rows}`);
      }
    });

    // Auto-fit on container resize
    resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
    });
    resizeObserver.observe(containerEl);
  }

  function disconnect() {
    clearTimeout(readyTimeout);
    messageBuffer.length = 0;
    resizeObserver?.disconnect();
    resizeObserver = null;
    ws?.close();
    ws = null;
    terminal?.dispose();
    terminal = null;
    terminalStore.setConnected(false);
  }

  onMount(() => {
    connect();
    return () => disconnect();
  });
</script>

<div class="terminal-panel" style:height="{terminalStore.panelHeight}px">
  <div class="terminal-header">
    <span class="terminal-title">
      <span class="conn-dot" class:connected={terminalStore.connected}></span>
      Terminal
    </span>
    <button class="terminal-close" onclick={() => terminalStore.close()} title="Close terminal">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
  <div class="terminal-container" bind:this={containerEl}></div>
</div>

<style>
  .terminal-panel {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-primary);
    background: #0d1117;
    min-height: 100px;
  }

  .terminal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
  }

  .terminal-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .conn-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-tertiary);
    transition: all var(--transition);
  }
  .conn-dot.connected {
    background: var(--accent-secondary, #00ff88);
    box-shadow: 0 0 6px rgba(0, 255, 136, 0.4);
  }

  .terminal-close {
    color: var(--text-tertiary);
    padding: 2px;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .terminal-close:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .terminal-container {
    flex: 1;
    min-height: 0;
    padding: 4px;
  }
  .terminal-container :global(.xterm) {
    height: 100%;
  }
</style>
