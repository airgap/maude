# Real-Time Streaming Fix - Testing & Validation Guide

## What Was Fixed

The Svelte 5 reactivity issue preventing real-time message display during streaming has been fixed using the Context API pattern.

**Before**: Messages only appeared after page reload or after 5-minute timeout
**After**: Messages should appear character-by-character in real-time

## How to Test

### Test 1: Basic Real-Time Streaming

1. **Start the development server**:
   ```bash
   npm run dev
   ```

2. **Open the app** in browser: `http://localhost:5173`

3. **Open Browser DevTools**:
   - Press F12 to open DevTools
   - Go to Console tab
   - Filter for logs starting with `[streamStore]` and `[StreamingMessage]`

4. **Send a test message** that triggers Claude's response:
   - Example: "Say hello in 5 different languages"
   - Something that produces quick output (not a long thinking operation)

5. **Observe the console logs**:
   You should see streaming logs like:
   ```
   [sse] Reading chunk...
   [sse] Decoded buffer length: 650
   [sse] Received event: message_start
   [streamStore.handleEvent] Processing: message_start contentBlocks.length: 0
   [sse] Received event: content_block_start
   [streamStore.handleEvent] Processing: content_block_start contentBlocks.length: 0
   [streamStore] Added text block, new length: 1
   [sse] Received event: content_block_delta
   [streamStore.handleEvent] Processing: content_block_delta contentBlocks.length: 1
   [streamStore] Updated text delta, block index: 0
   [StreamingMessage] $derived recalculating, blocks.length: 1
   [sse] Received event: content_block_delta
   [streamStore] Updated text delta, block index: 0
   [StreamingMessage] $derived recalculating, blocks.length: 1
   ```

6. **Observe the UI**:
   - Message should appear in the chat immediately
   - Text should stream character-by-character
   - NO need to wait for completion
   - NO need to reload page

### Test 2: Multi-Tool Streaming

1. **Send a message** that triggers tool calls:
   - Example: "Create a new file called test.txt with content 'hello world'"
   - Or: "Look at the files in this project"

2. **Expected behavior**:
   - Message text appears immediately
   - Tool calls appear as they're initiated
   - ToolCallTracker shows real-time progress
   - Results appear as tools complete

3. **Console verification**:
   - Should see `[streamStore] Added tool_use block` logs
   - Should see `[StreamingMessage] $derived recalculating` logs

### Test 3: Long-Running Streaming

1. **Send a message** that produces significant output:
   - Example: "Write me a detailed guide on TypeScript"
   - Something with thinking blocks + text + tool calls

2. **Verify**:
   - Message appears immediately
   - Content streams as it arrives
   - No lag or batching
   - Scrolling works smoothly

## What to Check In Console Logs

### Expected Log Pattern

When streaming works correctly, you'll see:

1. **SSE Events arriving**:
   ```
   [sse] Received event: message_start
   [sse] Received event: content_block_start
   [sse] Received event: content_block_delta (repeated many times)
   ```

2. **Store processing**:
   ```
   [streamStore.handleEvent] Processing: content_block_start
   [streamStore] Added text block, new length: 1
   [streamStore.handleEvent] Processing: content_block_delta
   [streamStore] Updated text delta, block index: 0
   ```

3. **Component reactivity** (THE KEY INDICATOR):
   ```
   [StreamingMessage] $derived recalculating, blocks.length: 1
   [StreamingMessage] $derived recalculating, blocks.length: 1
   [StreamingMessage] $derived recalculating, blocks.length: 1
   ```

### Red Flags (If You See These, Something's Wrong)

❌ No `[StreamingMessage] $derived recalculating` logs
- Means component isn't re-rendering
- Check browser console for errors
- Check that StreamingMessage.svelte is using getContext()

❌ Store logs appear but component logs don't
- Reactivity chain is broken
- Likely getContext() isn't working
- Verify +layout.svelte sets context

❌ SSE logs show events but store logs don't appear
- handleEvent() not being called
- Check sse.ts is correctly calling streamStore.handleEvent()

❌ All logs appear but message doesn't show
- Rendering issue in StreamingMessage template
- Check browser error console for rendering errors

## Filtering Console Logs

**In browser DevTools Console:**

```javascript
// Show only streaming logs
localStorage.debug = '[sse]*,[streamStore]*,[StreamingMessage]*'

// Or filter by pressing Ctrl+F in console and typing:
[streamStore]
[StreamingMessage]
```

## Performance Expectations

With proper reactivity:
- Initial message appears: < 100ms after first event
- Subsequent characters: < 16ms each (60fps streaming)
- No visible lag or batching
- Smooth scrolling

If you see:
- 1+ second delay before anything appears → reactivity broken
- Chunky updates (multiple characters at once) → batching happening
- Jank or stutter → performance issue

## Common Issues & Fixes

### Issue: Nothing appears, page stays blank

**Check 1**: Is conversation loaded?
- Try clicking on a previous conversation
- Or try sending a test message first

**Check 2**: Are there browser errors?
- Open DevTools → Console
- Look for red error messages
- Click them for stack trace

**Check 3**: Is context being set?
- In DevTools, run:
  ```javascript
  // Should show the streamStore object
  console.log(streamStore)
  ```

### Issue: Store logs appear but no component logs

**Check**: Is getContext() working?
- In StreamingMessage.svelte, add logging:
  ```typescript
  const streamStore = getContext(STREAM_CONTEXT_KEY);
  console.log('[StreamingMessage] Got streamStore from context:', !!streamStore);
  ```
- Should log `true`

**Check**: Is STREAM_CONTEXT_KEY correct?
- Make sure it matches between stream.svelte.ts and imports

### Issue: Component logs appear but message doesn't show

**Check**: Is template rendering?
- Add a simple test div:
  ```svelte
  <div>TEST: {streamStore.contentBlocks.length} blocks</div>
  ```
- This should update in real-time

**Check**: Is StreamingMessage mounted?
- In MessageList.svelte, verify condition:
  ```svelte
  {#if streamStore.isStreaming}
    <StreamingMessage /> <!-- Should mount when streaming -->
  {/if}
  ```

## Debugging Commands for Console

Copy-paste these into browser console while streaming:

```javascript
// Check if store exists in context
const store = streamStore; // if streamStore is in global scope
console.log('Store contentBlocks:', store?.contentBlocks?.length || 'not found');

// Manually trigger an update (tests reactivity)
streamStore.contentBlocks = [
  ...streamStore.contentBlocks,
  { type: 'text', text: 'TEST MESSAGE', parentToolUseId: undefined }
];
console.log('After manual update, should see UI change');

// Check streaming status
console.log('Streaming?', streamStore.isStreaming);
console.log('Status:', streamStore.status);
console.log('Block count:', streamStore.contentBlocks.length);
```

## Success Criteria

✅ **Test passes if**:
1. Message appears in chat within 100ms of first SSE event
2. Text streams character-by-character smoothly
3. `[StreamingMessage] $derived recalculating` logs appear in real-time
4. No page reload required
5. Multiple messages in sequence work correctly
6. Tool calls show real-time progress

## Reverting If Issues

If something breaks badly, the refactored-but-untested version is at:
```
packages/client/src/lib/stores/stream-refactored.svelte.ts
```

To revert:
```bash
git revert HEAD  # Last commit
```

## Next Steps

Once testing is complete:

1. **If streaming works**:
   - Remove diagnostic logging from stream.svelte.ts
   - Remove diagnostic logging from StreamingMessage.svelte
   - Commit final version

2. **If streaming still doesn't work**:
   - Check error messages in console for clues
   - Review the "Red Flags" section
   - May need to check MessageList.svelte or sse.ts for other issues

3. **Performance optimization** (if needed):
   - Could batch $derived recalculations
   - Could debounce component updates
   - Probably not necessary for smooth 60fps streaming

## Documentation

This fix is documented in:
- `REACTIVITY_INVESTIGATION.md` - Analysis of the problem
- `STREAMING_FIX_NOTES/svelte5-reactivity-solution.md` - Technical details
- This file - Testing & validation guide
