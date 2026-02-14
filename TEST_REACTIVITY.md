# Manual Reactivity Test

## Quick Test to Run in Browser Console

If you want to manually test if the store reactivity is working without waiting for a full message, run this in the browser console:

```javascript
// Manually trigger a content block addition
import { streamStore } from '$lib/stores/stream.svelte';

// Start a fake stream
streamStore.startStream();

// Manually add some content blocks (simulate what handleEvent does)
const testEvent1 = {
  type: 'message_start',
  index: 0,
  content_block: { type: 'text', text: '' }
};

const testEvent2 = {
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: 'Hello' }
};

const testEvent3 = {
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text: ' world!' }
};

// Process these events
streamStore.handleEvent(testEvent1);
console.log('After message_start, contentBlocks:', streamStore.contentBlocks.length);

streamStore.handleEvent(testEvent2);
console.log('After content_block_start, contentBlocks:', streamStore.contentBlocks.length);

streamStore.handleEvent(testEvent3);
console.log('After content_block_delta, contentBlocks:', streamStore.contentBlocks.length);
console.log('Final contentBlocks:', streamStore.contentBlocks);

// Check if streaming is active
console.log('streamStore.isStreaming:', streamStore.isStreaming);
console.log('streamStore.status:', streamStore.status);
```

## What to Expect

If the store is working correctly, you should see:
```
[streamStore.handleEvent] Processing: message_start contentBlocks.length: 0
[streamStore.handleEvent] Processing: content_block_start contentBlocks.length: 0
[streamStore] Added text block, new length: 1
After message_start, contentBlocks: 0
After content_block_start, contentBlocks: 1
[streamStore.handleEvent] Processing: content_block_delta contentBlocks.length: 1
[streamStore] Updated text delta, block index: 0
After content_block_delta, contentBlocks: 1
Final contentBlocks: (1) [{...}]  // with text: 'Hello world!'
streamStore.isStreaming: true
streamStore.status: streaming
```

If StreamingMessage is properly reactive, you should also see:
```
[StreamingMessage] $derived recalculating, blocks.length: 1
[StreamingMessage] $derived recalculating, blocks.length: 1
```

## Interpreting Results

### Good Signs
- Store logs appear immediately
- contentBlocks array grows with new blocks
- StreamingMessage logs appear after store logs
- isStreaming becomes true

### Bad Signs
- No [streamStore] logs → Store updates not happening
- No [StreamingMessage] logs → Component not re-computing $derived
- contentBlocks stays at 0 → State updates not persisting
- isStreaming stays false → Status not updating

## Notes

Since the import path uses SvelteKit aliases, this test works in the browser console while the app is running. The `$lib` alias is available globally.

If you can't import the store in the console, that's another sign of reactivity issues.
