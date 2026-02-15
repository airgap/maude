<script lang="ts">
  import { highlightLines, langFromPath, escapeHtml } from '$lib/utils/highlight';

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
    TodoWrite: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    NotebookEdit:
      'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  };

  /** Short filename from a full path */
  function basename(path: string): string {
    return path.split('/').pop() || path;
  }

  function formatInput(input: Record<string, unknown>): string {
    if (toolName === 'Read' && input.file_path) return String(input.file_path);
    if (toolName === 'Bash' && input.command) return String(input.command);
    if (toolName === 'Edit' && input.file_path) return String(input.file_path);
    if (toolName === 'Write' && input.file_path) return String(input.file_path);
    if (toolName === 'Glob' && input.pattern) return String(input.pattern);
    if (toolName === 'Grep' && input.pattern) return String(input.pattern);
    if (toolName === 'TodoWrite') return 'update tasks';
    if (toolName === 'Task' && input.description) return String(input.description);
    return JSON.stringify(input, null, 2).slice(0, 200);
  }

  // ── Diff types ──

  interface DiffLine {
    type: 'context' | 'removed' | 'added' | 'header';
    text: string;
    html: string; // Highlighted HTML (or escaped plain text as fallback)
  }

  /**
   * Build unified diff lines for Edit tool.
   */
  function buildEditDiff(highlightedOld: string[], highlightedNew: string[]): DiffLine[] {
    const oldStr = String(input.old_string || '');
    const newStr = String(input.new_string || '');
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');
    const lines: DiffLine[] = [];

    lines.push({
      type: 'header',
      text: `@@ ${basename(String(input.file_path || ''))}`,
      html: escapeHtml(`@@ ${basename(String(input.file_path || ''))}`),
    });

    // Find common prefix/suffix
    let prefixLen = 0;
    while (
      prefixLen < oldLines.length &&
      prefixLen < newLines.length &&
      oldLines[prefixLen] === newLines[prefixLen]
    ) {
      prefixLen++;
    }

    let suffixLen = 0;
    while (
      suffixLen < oldLines.length - prefixLen &&
      suffixLen < newLines.length - prefixLen &&
      oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
    ) {
      suffixLen++;
    }

    // Context before
    const contextBefore = Math.min(prefixLen, 2);
    for (let i = prefixLen - contextBefore; i < prefixLen; i++) {
      lines.push({
        type: 'context',
        text: oldLines[i],
        html: highlightedOld[i] || escapeHtml(oldLines[i]),
      });
    }

    // Removed
    const oldEnd = oldLines.length - suffixLen;
    for (let i = prefixLen; i < oldEnd; i++) {
      lines.push({
        type: 'removed',
        text: oldLines[i],
        html: highlightedOld[i] || escapeHtml(oldLines[i]),
      });
    }

    // Added
    const newEnd = newLines.length - suffixLen;
    for (let i = prefixLen; i < newEnd; i++) {
      lines.push({
        type: 'added',
        text: newLines[i],
        html: highlightedNew[i] || escapeHtml(newLines[i]),
      });
    }

    // Context after
    const contextAfter = Math.min(suffixLen, 2);
    for (let i = oldEnd; i < oldEnd + contextAfter; i++) {
      lines.push({
        type: 'context',
        text: oldLines[i],
        html: highlightedOld[i] || escapeHtml(oldLines[i]),
      });
    }

    return lines;
  }

  /** Count lines in a string */
  function lineCount(s: string): number {
    if (!s) return 0;
    return s.split('\n').length;
  }

  /** Truncate content to N lines with indicator */
  function truncateLines(
    s: string,
    max: number,
  ): { text: string; truncated: boolean; total: number } {
    const lines = s.split('\n');
    if (lines.length <= max) return { text: s, truncated: false, total: lines.length };
    return { text: lines.slice(0, max).join('\n'), truncated: true, total: lines.length };
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
    TodoWrite: 'var(--accent-info)',
  };

  // ── Async syntax highlighting state ──

  let diffLines = $state<DiffLine[]>([]);
  let writeHighlightedHtml = $state('');

  // Recompute highlighted content when expanded
  $effect(() => {
    if (!expanded) return;

    const filePath = String(input.file_path || '');
    const lang = langFromPath(filePath);

    if (toolName === 'Edit') {
      const oldStr = String(input.old_string || '');
      const newStr = String(input.new_string || '');

      // Start with plain-text fallback immediately
      const oldPlain = oldStr.split('\n').map(escapeHtml);
      const newPlain = newStr.split('\n').map(escapeHtml);
      diffLines = buildEditDiff(oldPlain, newPlain);

      // Then async highlight
      if (lang) {
        Promise.all([highlightLines(oldStr, lang), highlightLines(newStr, lang)]).then(
          ([hlOld, hlNew]) => {
            diffLines = buildEditDiff(hlOld, hlNew);
          },
        );
      }
    } else if (toolName === 'Write') {
      const content = String(input.content || '');
      const preview = truncateLines(content, 20);

      // Plain fallback
      writeHighlightedHtml = escapeHtml(preview.text);

      // Async highlight
      if (lang) {
        highlightLines(preview.text, lang).then((lines) => {
          writeHighlightedHtml = lines.join('\n');
        });
      }
    }
  });
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
      {#if toolName === 'Edit'}
        <!-- Unified diff view for Edit -->
        <div class="detail-section">
          <span class="detail-label">{basename(String(input.file_path || ''))}</span>
          <div class="diff-view">
            {#each diffLines as line}
              <div
                class="diff-line"
                class:diff-header={line.type === 'header'}
                class:diff-removed={line.type === 'removed'}
                class:diff-added={line.type === 'added'}
                class:diff-context={line.type === 'context'}
              >
                <span class="diff-gutter"
                  >{line.type === 'removed'
                    ? '-'
                    : line.type === 'added'
                      ? '+'
                      : line.type === 'header'
                        ? '@@'
                        : ' '}</span
                >
                <span class="diff-text">{@html line.html}</span>
              </div>
            {/each}
          </div>
          {#if input.replace_all}
            <span class="edit-flag">replace all</span>
          {/if}
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Result</span>
            <pre class="detail-content" class:error-output={result.is_error}>{result.content}</pre>
          </div>
        {/if}
      {:else if toolName === 'Write'}
        <!-- Content preview for Write -->
        <div class="detail-section">
          <div class="write-header">
            <span class="detail-label">{String(input.file_path || '')}</span>
            <span class="write-meta">{lineCount(String(input.content || ''))} lines</span>
          </div>
          <pre class="detail-content write-preview">{@html writeHighlightedHtml}</pre>
          {#if truncateLines(String(input.content || ''), 20).truncated}
            <span class="truncated-indicator"
              >... {truncateLines(String(input.content || ''), 20).total - 20} more lines</span
            >
          {/if}
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Result</span>
            <pre class="detail-content" class:error-output={result.is_error}>{result.content}</pre>
          </div>
        {/if}
      {:else if toolName === 'Read'}
        <!-- File path + result content for Read -->
        <div class="detail-section">
          <span class="detail-label">{String(input.file_path || '')}</span>
          {#if input.offset || input.limit}
            <span class="read-range">
              {#if input.offset}offset: {input.offset}{/if}
              {#if input.limit}{input.offset ? ', ' : ''}limit: {input.limit}{/if}
            </span>
          {/if}
        </div>
        {#if result}
          <div class="detail-section">
            <pre class="detail-content" class:error-output={result.is_error}>{truncateLines(
                result.content,
                30,
              ).text}</pre>
            {#if truncateLines(result.content, 30).truncated}
              <span class="truncated-indicator"
                >... {truncateLines(result.content, 30).total - 30} more lines</span
              >
            {/if}
          </div>
        {/if}
      {:else if toolName === 'Bash'}
        <!-- Command + output for Bash -->
        <div class="detail-section">
          <span class="detail-label">Command</span>
          <pre class="detail-content bash-command">{String(input.command || '')}</pre>
          {#if input.description}
            <span class="bash-desc">{String(input.description)}</span>
          {/if}
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Output</span>
            <pre class="detail-content" class:error-output={result.is_error}>{truncateLines(
                result.content,
                30,
              ).text}</pre>
            {#if truncateLines(result.content, 30).truncated}
              <span class="truncated-indicator"
                >... {truncateLines(result.content, 30).total - 30} more lines</span
              >
            {/if}
          </div>
        {/if}
      {:else if toolName === 'Grep'}
        <!-- Pattern + path + results for Grep -->
        <div class="detail-section">
          <span class="detail-label">Search</span>
          <div class="grep-params">
            <span class="grep-pattern">/{String(input.pattern || '')}/</span>
            {#if input.path}<span class="grep-path">in {String(input.path)}</span>{/if}
            {#if input.glob}<span class="grep-flag">glob: {String(input.glob)}</span>{/if}
            {#if input.type}<span class="grep-flag">type: {String(input.type)}</span>{/if}
          </div>
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Matches</span>
            <pre class="detail-content" class:error-output={result.is_error}>{truncateLines(
                result.content,
                30,
              ).text}</pre>
            {#if truncateLines(result.content, 30).truncated}
              <span class="truncated-indicator"
                >... {truncateLines(result.content, 30).total - 30} more lines</span
              >
            {/if}
          </div>
        {/if}
      {:else if toolName === 'Glob'}
        <!-- Pattern + results for Glob -->
        <div class="detail-section">
          <span class="detail-label">Pattern</span>
          <pre class="detail-content">{String(input.pattern || '')}</pre>
          {#if input.path}
            <span class="grep-path">in {String(input.path)}</span>
          {/if}
        </div>
        {#if result}
          <div class="detail-section">
            <span class="detail-label">Files</span>
            <pre class="detail-content" class:error-output={result.is_error}>{truncateLines(
                result.content,
                30,
              ).text}</pre>
            {#if truncateLines(result.content, 30).truncated}
              <span class="truncated-indicator"
                >... {truncateLines(result.content, 30).total - 30} more lines</span
              >
            {/if}
          </div>
        {/if}
      {:else}
        <!-- Fallback: generic JSON display for unknown tools -->
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

  /* ── Diff view (Edit tool) ── */
  .diff-view {
    font-family: var(--font-family);
    font-size: 12px;
    line-height: 1.5;
    border-radius: 2px;
    overflow: hidden;
    max-height: 300px;
    overflow-y: auto;
  }
  .diff-line {
    display: flex;
    padding: 0 8px;
    min-height: 20px;
  }
  .diff-gutter {
    flex-shrink: 0;
    width: 18px;
    text-align: center;
    color: var(--text-tertiary);
    user-select: none;
    opacity: 0.6;
  }
  .diff-text {
    white-space: pre-wrap;
    word-break: break-word;
    flex: 1;
  }
  .diff-header {
    color: var(--accent-info);
    font-weight: 600;
    opacity: 0.7;
    font-size: 11px;
    padding: 2px 8px;
  }
  .diff-removed {
    background: color-mix(in srgb, var(--accent-error) 8%, transparent);
    border-left: 2px solid color-mix(in srgb, var(--accent-error) 40%, transparent);
  }
  .diff-removed .diff-gutter {
    color: var(--accent-error);
    opacity: 0.7;
  }
  .diff-added {
    background: color-mix(in srgb, var(--accent-secondary) 8%, transparent);
    border-left: 2px solid color-mix(in srgb, var(--accent-secondary) 40%, transparent);
  }
  .diff-added .diff-gutter {
    color: var(--accent-secondary);
    opacity: 0.7;
  }
  .diff-context {
    color: var(--text-tertiary);
    border-left: 2px solid transparent;
  }
  .edit-flag {
    display: inline-block;
    margin-top: 4px;
    font-size: 9px;
    padding: 1px 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* ── Syntax highlighting token classes ── */
  .diff-text :global(.syn-keyword) {
    color: var(--syn-keyword);
  }
  .diff-text :global(.syn-string) {
    color: var(--syn-string);
  }
  .diff-text :global(.syn-number) {
    color: var(--syn-number);
  }
  .diff-text :global(.syn-function) {
    color: var(--syn-function);
  }
  .diff-text :global(.syn-comment) {
    color: var(--syn-comment);
  }
  .diff-text :global(.syn-type) {
    color: var(--syn-type);
  }
  .diff-text :global(.syn-variable) {
    color: var(--syn-variable);
  }
  .diff-text :global(.syn-operator) {
    color: var(--syn-operator);
  }

  /* ── Write tool ── */
  .write-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .write-meta {
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .write-preview {
    border-left: 2px solid var(--accent-warning);
    padding-left: 8px !important;
    margin-top: 4px;
  }
  /* Syntax highlighting in write preview */
  .write-preview :global(.syn-keyword) {
    color: var(--syn-keyword);
  }
  .write-preview :global(.syn-string) {
    color: var(--syn-string);
  }
  .write-preview :global(.syn-number) {
    color: var(--syn-number);
  }
  .write-preview :global(.syn-function) {
    color: var(--syn-function);
  }
  .write-preview :global(.syn-comment) {
    color: var(--syn-comment);
  }
  .write-preview :global(.syn-type) {
    color: var(--syn-type);
  }
  .write-preview :global(.syn-variable) {
    color: var(--syn-variable);
  }
  .write-preview :global(.syn-operator) {
    color: var(--syn-operator);
  }

  /* ── Truncation ── */
  .truncated-indicator {
    display: block;
    font-size: 10px;
    color: var(--text-tertiary);
    font-style: italic;
    margin-top: 4px;
    padding-left: 10px;
  }

  /* ── Read tool ── */
  .read-range {
    display: inline-block;
    margin-top: 2px;
    font-size: 10px;
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }

  /* ── Bash tool ── */
  .bash-command {
    color: var(--text-primary) !important;
    font-weight: 500;
  }
  .bash-desc {
    display: block;
    margin-top: 4px;
    font-size: 10px;
    color: var(--text-tertiary);
    font-style: italic;
  }

  /* ── Grep/Glob tool ── */
  .grep-params {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
    font-size: 12px;
  }
  .grep-pattern {
    font-family: var(--font-family);
    color: var(--accent-primary);
    font-weight: 600;
  }
  .grep-path {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-family);
  }
  .grep-flag {
    font-size: 10px;
    padding: 1px 5px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-tertiary);
    font-family: var(--font-family);
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
