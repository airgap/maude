<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    ratio = 0.5,
    direction = 'horizontal',
    onRatioChange,
    first,
    second,
  } = $props<{
    ratio: number;
    direction: 'horizontal' | 'vertical';
    onRatioChange: (ratio: number) => void;
    first: Snippet;
    second: Snippet;
  }>();

  let container: HTMLDivElement;
  let resizing = $state(false);

  function onResizeStart(e: MouseEvent) {
    e.preventDefault();
    resizing = true;
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }

  function onResizeMove(e: MouseEvent) {
    if (!resizing || !container) return;
    const rect = container.getBoundingClientRect();
    let newRatio: number;
    if (direction === 'horizontal') {
      newRatio = (e.clientX - rect.left) / rect.width;
    } else {
      newRatio = (e.clientY - rect.top) / rect.height;
    }
    onRatioChange(Math.max(0.15, Math.min(0.85, newRatio)));
  }

  function onResizeEnd() {
    resizing = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }
</script>

<div
  class="split-pane"
  class:horizontal={direction === 'horizontal'}
  class:vertical={direction === 'vertical'}
  class:resizing
  bind:this={container}
>
  <div
    class="split-first"
    style:flex-basis={direction === 'horizontal' ? `${ratio * 100}%` : `${ratio * 100}%`}
  >
    {@render first()}
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="split-handle" onmousedown={onResizeStart}></div>

  <div class="split-second">
    {@render second()}
  </div>
</div>

<style>
  .split-pane {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .split-pane.horizontal {
    flex-direction: row;
  }
  .split-pane.vertical {
    flex-direction: column;
  }

  .split-first {
    flex-shrink: 0;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .split-second {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .split-handle {
    flex-shrink: 0;
    background: transparent;
    transition: background var(--transition);
    position: relative;
    z-index: 5;
  }
  .horizontal > .split-handle {
    width: 2px;
    cursor: col-resize;
  }
  .vertical > .split-handle {
    height: 2px;
    cursor: row-resize;
  }
  .split-handle:hover,
  .resizing .split-handle {
    background: var(--accent-primary);
    box-shadow: 0 0 8px rgba(0, 180, 255, 0.4);
  }

  /* Prevent text selection while resizing */
  .resizing {
    user-select: none;
  }
</style>
