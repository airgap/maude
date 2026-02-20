<script lang="ts">
  let { data } = $props<{ data: string }>();

  interface ProgressData {
    percent: number;
    label: string;
    speed?: string;
  }

  const parsed = $derived.by((): ProgressData | null => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  });

  const barColor = $derived.by(() => {
    if (!parsed) return 'var(--accent-primary, #00b4ff)';
    if (parsed.percent >= 100) return 'var(--accent-secondary, #00ff88)';
    return 'var(--accent-primary, #00b4ff)';
  });
</script>

{#if parsed}
  <div class="progress-wrapper">
    <div class="progress-info">
      <span class="progress-label">{parsed.label}</span>
      <span class="progress-pct">{Math.round(parsed.percent)}%</span>
      {#if parsed.speed}
        <span class="progress-speed">{parsed.speed}</span>
      {/if}
    </div>
    <div class="progress-track">
      <div
        class="progress-fill"
        class:complete={parsed.percent >= 100}
        style="width: {Math.min(100, parsed.percent)}%; background: {barColor}"
      ></div>
    </div>
  </div>
{/if}

<style>
  .progress-wrapper {
    padding: 4px 0;
  }

  .progress-info {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 0;
    font-size: 10px;
  }

  .progress-label {
    flex: 1;
    color: var(--text-secondary, #8b949e);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-pct {
    color: var(--text-primary, #c9d1d9);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .progress-speed {
    color: var(--text-tertiary, #6e7681);
  }

  .progress-track {
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--text-tertiary, #6e7681) 15%, transparent);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: 2px;
    transition:
      width 0.3s ease,
      background 0.3s ease;
  }

  .progress-fill.complete {
    background: var(--accent-secondary, #00ff88) !important;
  }
</style>
