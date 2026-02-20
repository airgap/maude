<script lang="ts">
  import type { CommentaryEntry } from '$lib/stores/commentary.svelte';
  import {
    exportAsMarkdown,
    exportAsJSON,
    exportAsAudio,
    downloadExport,
    type ExportFormat,
  } from '$lib/utils/commentary-export';
  import { uiStore } from '$lib/stores/ui.svelte';

  interface Props {
    show: boolean;
    history: CommentaryEntry[];
    workspacePath?: string;
    onClose: () => void;
  }

  let { show = $bindable(), history, workspacePath, onClose }: Props = $props();

  let selectedFormat = $state<ExportFormat>('markdown');
  let selectedTimeRange = $state<'all' | 'last_hour' | 'last_30min'>('all');
  let exportInProgress = $state(false);

  const formatOptions = [
    { id: 'markdown' as ExportFormat, label: 'Markdown', description: 'Timestamped text document' },
    { id: 'json' as ExportFormat, label: 'JSON', description: 'Structured data for analysis' },
    { id: 'audio' as ExportFormat, label: 'Audio', description: 'TTS replay (WAV file)' },
  ];

  const timeRangeOptions = [
    { id: 'all' as const, label: 'All Commentary', description: 'Export entire session' },
    { id: 'last_hour' as const, label: 'Last Hour', description: 'Export last 60 minutes' },
    { id: 'last_30min' as const, label: 'Last 30 Minutes', description: 'Export last 30 minutes' },
  ];

  function getTimeRangeTimestamps(): { startTime?: number; endTime?: number } {
    const now = Date.now();
    switch (selectedTimeRange) {
      case 'last_hour':
        return { startTime: now - 60 * 60 * 1000 };
      case 'last_30min':
        return { startTime: now - 30 * 60 * 1000 };
      default:
        return {};
    }
  }

  async function handleExport() {
    if (history.length === 0) {
      uiStore.toast('No commentary to export', 'error');
      return;
    }

    exportInProgress = true;

    try {
      const { startTime, endTime } = getTimeRangeTimestamps();
      const exportOptions = {
        format: selectedFormat,
        entries: history,
        workspacePath,
        startTime,
        endTime,
      };

      let content: string | Blob;

      switch (selectedFormat) {
        case 'markdown':
          content = exportAsMarkdown(exportOptions);
          break;
        case 'json':
          content = exportAsJSON(exportOptions);
          break;
        case 'audio':
          uiStore.toast('Generating audio export... This may take a moment.', 'info');
          content = await exportAsAudio(exportOptions);
          break;
        default:
          throw new Error(`Unsupported format: ${selectedFormat}`);
      }

      downloadExport(content, selectedFormat);
      uiStore.toast('Commentary exported successfully', 'success');
      onClose();
    } catch (error) {
      console.error('[commentary-export] Export failed:', error);
      uiStore.toast(
        `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      );
    } finally {
      exportInProgress = false;
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains('modal-overlay')) {
      onClose();
    }
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal-overlay" onclick={handleClickOutside}>
    <div class="export-modal">
      <div class="modal-header">
        <h3>Export Commentary</h3>
        <button class="close-btn" onclick={onClose} aria-label="Close">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <!-- Format Selection -->
        <div class="section">
          <label class="section-label">Format</label>
          <div class="option-group">
            {#each formatOptions as option}
              <button
                class="option-card"
                class:selected={selectedFormat === option.id}
                onclick={() => (selectedFormat = option.id)}
              >
                <div class="option-content">
                  <span class="option-label">{option.label}</span>
                  <span class="option-desc">{option.description}</span>
                </div>
                {#if selectedFormat === option.id}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    class="check-icon"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <!-- Time Range Selection -->
        <div class="section">
          <label class="section-label">Time Range</label>
          <div class="option-group">
            {#each timeRangeOptions as option}
              <button
                class="option-card"
                class:selected={selectedTimeRange === option.id}
                onclick={() => (selectedTimeRange = option.id)}
              >
                <div class="option-content">
                  <span class="option-label">{option.label}</span>
                  <span class="option-desc">{option.description}</span>
                </div>
                {#if selectedTimeRange === option.id}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    class="check-icon"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <!-- Export Info -->
        <div class="info-box">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <span
            >{history.length} commentary {history.length === 1 ? 'entry' : 'entries'} available for export</span
          >
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={onClose} disabled={exportInProgress}>
          Cancel
        </button>
        <button class="btn btn-primary" onclick={handleExport} disabled={exportInProgress}>
          {#if exportInProgress}
            <span class="spinner"></span>
            Exporting...
          {:else}
            Export
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }

  .export-modal {
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-secondary);
  }

  .modal-header h3 {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-primary);
  }

  .close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }

  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-label {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .option-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition);
    text-align: left;
  }

  .option-card:hover {
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .option-card.selected {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .option-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .option-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .option-desc {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  .check-icon {
    flex-shrink: 0;
    color: var(--accent-primary);
  }

  .info-box {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: color-mix(in srgb, var(--accent-info) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-info) 20%, transparent);
    border-radius: var(--radius-md);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }

  .info-box svg {
    flex-shrink: 0;
    color: var(--accent-info);
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 16px 20px;
    border-top: 1px solid var(--border-secondary);
  }

  .btn {
    padding: 8px 16px;
    border-radius: var(--radius-md);
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
    border: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-secondary);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-primary);
  }

  .btn-primary {
    background: var(--accent-primary);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-primary) 90%, black);
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
