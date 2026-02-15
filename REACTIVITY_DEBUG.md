# Svelte 5 Reactivity Debugging Guide

## Problem

Messages are not appearing in real-time during streaming, despite:

- SSE chunks arriving successfully (network working)
- Client receiving events (console shows `[sse] Received event:...`)
- `streamStore.handleEvent()` being called (we've confirmed this)
- Store state being reassigned (`contentBlocks = [...]`)

This suggests a **Svelte reactivity chain break** between store state updates and component rendering.

## Diagnostic Logging Added

### 1. Store Level: stream.svelte.ts

#### handleEvent() entry logging:

```typescript
console.log(
  '[streamStore.handleEvent] Processing:',
  event.type,
  'contentBlocks.length:',
  contentBlocks.length,
);
```

**What to look for**: Should log every SSE event type received

#### Block creation logging:

When content_block_start creates new blocks:

```typescript
console.log('[streamStore] Added text block, new length:', contentBlocks.length);
console.log('[streamStore] Added thinking block, new length:', contentBlocks.length);
console.log('[streamStore] Added tool_use block, new length:', contentBlocks.length);
```

**What to look for**: Confirms blocks are being added to contentBlocks array

#### Block update logging:

When content_block_delta updates blocks:

```typescript
console.log('[streamStore] Updated text delta, block index:', idx);
console.log('[streamStore] Updated thinking delta, block index:', idx);
console.log('[streamStore] Updated tool_use input, block index:', idx);
```

**What to look for**: Confirms blocks are being updated with streamed text

### 2. Component Level: StreamingMessage.svelte

#### $derived recalculation logging:

```typescript
console.log('[StreamingMessage] $derived recalculating, blocks.length:', blocks.length);
```

**What to look for**: Should log every time `streamStore.contentBlocks` changes AND component re-renders

## Debugging Steps

### Step 1: Verify Store Updates

1. Open browser DevTools → Console
2. Send a message that triggers Claude's response
3. Look for logs like:
   ```
   [sse] Received event: message_start
   [streamStore.handleEvent] Processing: message_start contentBlocks.length: 0
   [sse] Received event: content_block_start
   [streamStore.handleEvent] Processing: content_block_start contentBlocks.length: 0
   [streamStore] Added text block, new length: 1
   [sse] Received event: content_block_delta
   [streamStore.handleEvent] Processing: content_block_delta contentBlocks.length: 1
   [streamStore] Updated text delta, block index: 0
   ```

**Expected**: Store logs should appear continuously as events arrive

### Step 2: Verify Component Re-renders

Looking at the same console output, search for:

```
[StreamingMessage] $derived recalculating, blocks.length: 1
[StreamingMessage] $derived recalculating, blocks.length: 1
```

**Expected**: Should see `[StreamingMessage]` logs every time blocks update

### Step 3: Identify the Break

- If you see store logs but NO StreamingMessage logs → **Reactivity chain broken in store**
- If you see both store and component logs but message doesn't show → **Issue in component rendering**
- If you see neither → **SSE events not reaching store** (but console shows they are, so this is unlikely)

## Potential Root Causes

### Issue A: Getter Functions Don't Track as Reactive Dependencies

In Svelte 5, when a component does:

```typescript
let grouped = $derived.by(() => {
  const blocks = streamStore.contentBlocks; // Reading through getter
  // ...
});
```

The `$derived` may not properly track that `contentBlocks` is a reactive $state variable because it's accessed through a function return.

**Fix would be**: Export $state variables directly instead of through getters

### Issue B: Array Reassignments Not Triggering Reactivity

```typescript
contentBlocks = [...contentBlocks, { type: 'text', text: '', parentToolUseId: pid }];
```

While this looks correct (creating new array reference), there may be an issue with how Svelte 5 tracks this through the getter chain.

**Fix would be**: Direct state exports + component reading

### Issue C: Component Not Actually in DOM

The conditional rendering might be preventing StreamingMessage from mounting:

```svelte
{#if streamStore.isStreaming}
  <StreamingMessage />
{/if}
```

If `streamStore.isStreaming` is false, component doesn't mount at all.

**Check**: Should see `streamStore.isStreaming === true` in console when streaming

## Next Steps

1. **Run a test message** and collect the console output
2. **Compare timestamps** of store logs vs component logs
3. **Post logs** with the following info:
   - Do all three log sections appear? (SSE, store, component)
   - How many store updates before component re-render?
   - Any console errors?

Once we identify which step is breaking, we'll know exactly what to fix:

- If store is updating but component not re-rendering → refactor store exports
- If component not receiving updates → investigate SSE sync to conversation store
- If message still not visible after component updates → investigate template rendering

## Reference: Expected Flow

```
SSE chunk arrives
  ↓
sse.ts reads chunk
  ↓
[sse] console logs
  ↓
streamStore.handleEvent(event) called
  ↓
[streamStore.handleEvent] logs
  ↓
contentBlocks reassigned (state update)
  ↓
[streamStore] Added/Updated block logs
  ↓
StreamingMessage $derived notices contentBlocks changed
  ↓
[StreamingMessage] $derived recalculating logs
  ↓
StreamingMessage component re-renders
  ↓
Message appears in UI ✓
```

If any step is missing from the logs, that's where the problem is.
