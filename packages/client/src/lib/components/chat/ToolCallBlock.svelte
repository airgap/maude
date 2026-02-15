<script lang="ts">
  let {
    toolName,
    input,
    result,
    running = false,
    compact = false,
  } = $props<{
    toolName: string;
    input: Record<string, unknown>;
    result?: { content: string; is_error?: boolean };
    running?: boolean;
    /** When true, suppress large error styling (used during streaming) */
    compact?: boolean;
  }>();

  let expanded = $state(false);

  const toolIcons: Record<string, string> = {
    Read: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
    Write: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
    Edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
    Bash: 'M4 17l6-6-6-6M12 19h8',
    Glob: 'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
    Grep: 'M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
    WebFetch: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z',
    WebSearch: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z',
    Task: 'M12 2L2 7l10 5 10-5-10-5z',
  };

  function formatInput(input: Record<string, unknown>): string {
    if (toolName === 'Read' && input.file_path) return String(input.file_path);
    if (toolName === 'Bash' && input.command) return String(input.command);
    if (toolName === 'Edit' && input.file_path) return String(input.file_path);
    if (toolName === 'Write' && input.file_path) return String(input.file_path);
    if (toolName === 'Glob' && input.pattern) return String(input.pattern);
    if (toolName === 'Grep' && input.pattern) return String(input.pattern);
    return JSON.stringify(input, null, 2).slice(0, 200);
  }

  const categoryColors: Record<string, string> = {
    Read: 'var(--accent-info)',
    Write: 'var(--accent-warning)',
    Edit: 'var(--accent-warning)',
    Bash: 'var(--accent-error)',
    Glob: 'var(--accent-info)',
    Grep: 'var(--accent-info)',
    WebFetch: 'var(--accent-purple)',
    WebSearch: 'var(--accent-purple)',
    Task: 'var(--accent-secondary)',
  };
</script>

<div class="tool-block" class:running class:error={result?.is_error && !compact} class:compact>
  <button class="tool-header" onclick={() => (expanded = !expanded)}>
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class:rotated={expanded}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
    <span class="tool-icon" style:color={categoryColors[toolName] || 'var(--text-tertiary)'}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          d={toolIcons[toolName] ||
            'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'}
        />
      </svg>
    </span>
    <span class="tool-name">{toolName}</span>
    <span class="tool-summary truncate">{formatInput(input)}</span>
    {#if running}
      <span class="running-indicator"></span>
    {:else if result && !result.is_error}
      <span class="success-badge">✓</span>
    {:else if result?.is_error}
      <span class="error-badge">{compact ? '✕' : 'ERROR'}</span>
    {/if}
  </button>

  {#if expanded && !compact}
    <div class="tool-details">
      <div class="detail-section">
        <span class="detail-label">Input</span>
        <pre class="detail-content">{JSON.stringify(input, null, 2)}</pre>
      </div>
      {#if result}
        <div class="detail-section">
          <span class="detail-label">Output</span>
          <pre class="detail-content" class:error-output={result.is_error}>{result.content}</pre>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool-block {
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    overflow: hidden;
    font-size: 13px;
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    transition: background var(--transition);
  }
  .tool-header:hover {
    background: var(--bg-hover);
  }

  .tool-name {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 12px;
  }

  .tool-summary {
    color: var(--text-tertiary);
    font-size: 12px;
    flex: 1;
    min-width: 0;
    font-family: var(--font-family);
    text-align: left;
  }

  .tool-icon {
    display: flex;
  }

  svg {
    transition: transform var(--transition);
  }
  .rotated {
    transform: rotate(90deg);
  }

  .running-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: pulse 1s infinite;
  }

  .error-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--accent-error);
    color: var(--text-on-accent);
  }

  .success-badge {
    font-size: 12px;
    font-weight: 700;
    color: var(--accent-secondary, #00ff88);
    opacity: 0.7;
  }

  .tool-block.compact {
    border-color: var(--border-secondary);
    transition: border-color 0.3s ease;
  }
  .tool-block.compact .error-badge {
    font-size: 10px;
    background: transparent;
    color: var(--accent-error);
    padding: 0;
  }

  .tool-details {
    border-top: 1px solid var(--border-secondary);
    background: var(--bg-primary);
  }

  .detail-section {
    padding: 8px 10px;
  }
  .detail-section + .detail-section {
    border-top: 1px solid var(--border-secondary);
  }

  .detail-label {
    font-size: 10px;
    text-transform: var(--ht-label-transform);
    letter-spacing: var(--ht-label-spacing);
    color: var(--text-tertiary);
    display: block;
    margin-bottom: 4px;
  }

  .detail-content {
    font-size: 12px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
    background: none;
    padding: 0;
    color: var(--text-secondary);
  }

  .error-output {
    color: var(--accent-error);
  }

  .tool-block.error {
    border-color: var(--accent-error);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
</style>
