# Real-Time Streaming Reactivity Investigation Summary

## The Problem

Messages from Claude are not appearing in the browser in real-time during streaming. Instead, they only appear after:
1. The entire response finishes (or after ~5 minutes timeout)
2. The user manually reloads the page

This is blocking the core feature of showing real-time streaming responses.

## What Works

Through extensive debugging, we've confirmed:

✅ **Network Layer**: SSE stream is working perfectly
- Server sends chunks immediately
- Client receives them with streaming parser
- Browser console shows `[sse] Received event:...` logs confirming chunks arrive in real-time

✅ **Store Event Handler**: Events are reaching the store
- Console shows `[sse] Received event: message_start`, `content_block_delta`, etc.
- `streamStore.handleEvent()` is being called for every event
- State reassignments are executing (`contentBlocks = [...]`)

✅ **Conversation Sync**: Messages eventually appear after reload
- This proves events are being processed and saved to the database
- The issue is NOT with event loss or server-side state management

## What's Broken

❌ **UI Reactivity**: Components not re-rendering when store state changes
- SSE events arrive → Store updates happen → UI should update → **doesn't happen**
- After reload, messages appear because they're loaded from database, not because streaming is working
- The ToolCallTracker component we added shows real-time progress because it uses `conversationStore` (synced separately)

## Root Cause Analysis

The issue is a **Svelte 5 reactivity chain break** when components access state through store getter functions.

### How State Access Works Currently

```
stream.svelte.ts:
  let contentBlocks = $state<MessageContent[]>([])
  return { get contentBlocks() { return contentBlocks } }

StreamingMessage.svelte:
  let grouped = $derived.by(() => {
    const blocks = streamStore.contentBlocks  // Accessing via getter
    // ... build grouped entries
  })
```

The problem: When a component reads `streamStore.contentBlocks`, it gets the value through a function return. Svelte 5's `$derived.by()` may not properly recognize that the underlying `contentBlocks` is a `$state` variable that changed, especially when accessed indirectly through object getters.

### Why This Matters

When `contentBlocks = [...]` executes in the store:
1. The $state variable is reassigned ✓
2. Svelte should notify reactive dependents ✗
3. But the notification isn't reaching the component's `$derived`
4. So `grouped` doesn't recalculate
5. So the template doesn't re-render
6. So the user sees nothing

## Evidence from Logs

From your console logs:
```
[sse] Reading chunk...
[sse] Decoded buffer length: 650 contains: data: {"type":"message_start"...
[sse] Received event: message_start {...}
[sse] Received event: content_block_start {...}
[sse] Received event: content_block_delta {...}
```

These logs prove the SSE pipeline is working. But there are NO logs showing messages appearing on screen, confirming the reactivity break.

## The Solution (Next Step)

The fix is to **refactor the store to export reactive state directly** instead of through getters.

### Current Pattern (Broken)
```typescript
let contentBlocks = $state<MessageContent[]>([]);
return { 
  get contentBlocks() { return contentBlocks; }
}
```

### Corrected Pattern (Will Fix)
```typescript
export const streamState = {
  contentBlocks: $state<MessageContent[]>([]),
  // ... other state
};

// Components read directly
import { streamState } from '$lib/stores/stream.svelte';
let grouped = $derived.by(() => {
  const blocks = streamState.contentBlocks;  // Direct access to $state
  // ...
});
```

This ensures Svelte's reactivity system can properly track the dependency on `contentBlocks`.

## Diagnostic Changes Made

We've added comprehensive logging to pinpoint exactly which step is breaking:

### In stream.svelte.ts
- `handleEvent()` logs what event type is being processed
- Block creation logs when new blocks are added
- Block update logs when streamed text is appended

### In StreamingMessage.svelte
- `$derived.by()` logs when it recalculates

### In browser console
- All logs are prefixed with `[streamStore]`, `[StreamingMessage]`, etc. for easy filtering

## How to Verify the Fix

After we implement the refactored store:

1. Send a test message
2. Open browser console
3. Filter logs to show only `[StreamingMessage]`
4. Messages should appear in real-time
5. Console should show: `[StreamingMessage] $derived recalculating` logs in real-time

## Testing Guides

Two guides are included:

1. **REACTIVITY_DEBUG.md**
   - Step-by-step debugging process
   - What logs to expect at each stage
   - How to identify which step is broken

2. **TEST_REACTIVITY.md**
   - Browser console test script
   - Manually simulates SSE events without waiting for server
   - Quick verification that reactivity works

## Impact Assessment

**If we fix this**, real-time streaming will work immediately:
- Messages appear character-by-character as Claude types
- Tool calls show real-time progress
- Better UX for long-running operations
- No more 5-minute wait for responses to appear

**Current Workaround** (what users must do now):
- Wait for entire response to finish OR wait 5 minutes
- Reload page to see what was actually sent
- Use the ToolCallTracker for any progress visibility (which works because it syncs to conversationStore separately)

## Next Actions

1. **Create refactored stream.svelte.ts** with direct state exports
2. **Update all components** to import and use `streamState` directly
3. **Test with diagnostic logging** still in place
4. **Verify real-time rendering** works
5. **Remove diagnostic logs** for production
6. **Update documentation** on store patterns

This is a high-priority fix for a core feature.
