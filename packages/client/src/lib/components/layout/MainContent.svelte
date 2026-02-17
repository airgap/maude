<script lang="ts">
  import type { Snippet } from 'svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import SplitPane from './SplitPane.svelte';
  import EditorPane from '../editor/EditorPane.svelte';
  import PrimaryPane from './PrimaryPane.svelte';

  let { children } = $props<{ children: Snippet }>();
</script>

{#if editorStore.layoutMode === 'chat-only'}
  <div class="pane-full">
    <PrimaryPane {children} />
  </div>
{:else if editorStore.layoutMode === 'editor-only'}
  <div class="pane-full">
    <EditorPane />
  </div>
{:else if editorStore.layoutMode === 'split-horizontal'}
  <SplitPane
    ratio={editorStore.splitRatio}
    direction="horizontal"
    onRatioChange={(r) => editorStore.setSplitRatio(r)}
  >
    {#snippet first()}
      <div class="pane-full">
        <PrimaryPane {children} />
      </div>
    {/snippet}
    {#snippet second()}
      <EditorPane />
    {/snippet}
  </SplitPane>
{:else if editorStore.layoutMode === 'split-vertical'}
  <SplitPane
    ratio={editorStore.splitRatio}
    direction="vertical"
    onRatioChange={(r) => editorStore.setSplitRatio(r)}
  >
    {#snippet first()}
      <div class="pane-full">
        <PrimaryPane {children} />
      </div>
    {/snippet}
    {#snippet second()}
      <EditorPane />
    {/snippet}
  </SplitPane>
{/if}

<style>
  .pane-full {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
