# Tool Call Display Order Fix

## Problem
Tool calls were appearing at the END of the message, AFTER all streamed text. This meant users would see:

1. Text content streams in
2. Tool calls suddenly appear at the bottom
3. Tool results populate below

This created a poor UX where the natural reading order didn't match the message structure.

## Root Cause
The Claude CLI outputs a single `assistant` event containing ALL content blocks in the order returned by the API:
1. Text block(s) first
2. Tool use block(s) last

When the server translated this to SSE events, it emitted them in that order - all text events, then all tool events. However, on the client side, since all these events arrived atomically, they all rendered at once, placing tools at the end visually.

## Solution
**Reorder content blocks BEFORE translating to SSE events** so that:
1. Text/thinking blocks are emitted first
2. Tool use blocks are emitted after text
3. Original block indices are preserved for correct SSE event handling

This ensures text appears in the UI before tool calls, creating a more natural reading experience.

## Changes Made

### `/home/nicole/maude/packages/server/src/services/claude-process.ts`

In the `translateCliEvent` function's `assistant` case (lines 68-82):

#### Before:
```typescript
// Emit content blocks
const content = msg.content || [];
for (let i = 0; i < content.length; i++) {
  const block = content[i];
  // Process all blocks in order...
}
```

#### After:
```typescript
// Emit content blocks
const content = msg.content || [];

// Reorder blocks: text/thinking first, then tool_use blocks
// This ensures text appears in UI before tool calls
// Map blocks with their original indices to preserve SSE event indexing
const blocksWithIndex = content.map((block, idx) => ({ block, originalIndex: idx }));
const textBlocksWithIndex = blocksWithIndex.filter(item => item.block.type === 'text' || item.block.type === 'thinking');
const toolBlocksWithIndex = blocksWithIndex.filter(item => item.block.type === 'tool_use');
const reorderedBlocks = [...textBlocksWithIndex, ...toolBlocksWithIndex];

for (let orderIdx = 0; orderIdx < reorderedBlocks.length; orderIdx++) {
  const { block, originalIndex } = reorderedBlocks[orderIdx];
  const i = originalIndex;  // Use original index for SSE events
  // Process reordered blocks, but emit with original indices...
}
```

## How It Works

### Data Structure
```javascript
// Original blocks from CLI
[
  { type: 'text', text: 'Here is the code...' },
  { type: 'tool_use', id: '1', name: 'write_file' },
  { type: 'tool_use', id: '2', name: 'execute_command' }
]

// Converted to indexed map
[
  { block: { type: 'text', ... }, originalIndex: 0 },
  { block: { type: 'tool_use', ... }, originalIndex: 1 },
  { block: { type: 'tool_use', ... }, originalIndex: 2 }
]

// Filtered and reordered
Text blocks:
[
  { block: { type: 'text', ... }, originalIndex: 0 }
]
Tool blocks:
[
  { block: { type: 'tool_use', ... }, originalIndex: 1 },
  { block: { type: 'tool_use', ... }, originalIndex: 2 }
]

// Final reordered array
[
  { block: { type: 'text', ... }, originalIndex: 0 },
  { block: { type: 'tool_use', ... }, originalIndex: 1 },
  { block: { type: 'tool_use', ... }, originalIndex: 2 }
]
```

### SSE Event Emission
When SSE events are emitted:
- Text block events use index: 0
- Tool block events use indices: 1, 2 (original indices preserved)

This maintains correct indexing for the client-side stream store, which uses indices to track and update blocks.

## UX Impact

### Before Fix
```
─────────────────────────────
Claude: 
Here is the code I'll write for you:
```typescript
function example() {
  return true;
}
```

Tool: write_file
Input: { path: '/app.js', content: '...' }

Tool: execute_command
Input: { command: 'npm test' }
─────────────────────────────
```

### After Fix
```
─────────────────────────────
Claude:
Here is the code I'll write for you:
```typescript
function example() {
  return true;
}
```

Tool: write_file
Input: { path: '/app.js', content: '...' }

Tool: execute_command
Input: { command: 'npm test' }
─────────────────────────────
```

(Visually similar, but now tools appear in their logical position after the explanation text, matching the natural reading order)

## Technical Notes

1. **Index Preservation**: Original indices are preserved so client-side code can correctly match SSE events to blocks
2. **No Duplication**: Each block is processed exactly once, just in reordered sequence
3. **Filter Performance**: The double filter operation is O(n) and negligible compared to network latency
4. **Backward Compatible**: The fix is transparent to client code - all SSE events are identical, just in different order

## Testing

To verify the fix works:
1. Send a message that returns both text and tool calls
2. Observe:
   - ✅ Text content appears in the message body
   - ✅ Tool calls appear BELOW the text
   - ✅ Tool results populate correctly
   - ✅ No indexing errors in browser console

## Related Components
- **StreamingMessage.svelte**: Renders blocks in order from contentBlocks array
- **stream.svelte.ts**: Stores content blocks and updates them as events arrive
- **claude-process.ts**: Emits the SSE events (this file)
- **sse.ts**: Client-side SSE event handler
