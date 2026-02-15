# Real-Time Streaming Visibility Fix

## Problem

Claude's replies were not showing in the UI until the entire response was completely finished streaming. With multi-tool responses (10-20+ tools), users would see a blank message for 5+ minutes with no feedback about what was happening.

## Root Cause

The Claude Code CLI outputs events in batches. The system was waiting for the first `assistant` event from the CLI before emitting anything to the client. Since the CLI doesn't emit events until it has collected significant content, the SSE stream remained empty for an extended period.

## Solution

**Emit `message_start` event immediately** when the system event is received, rather than waiting for the first assistant event.

This ensures:

1. ✅ Streaming message container appears immediately
2. ✅ ToolCallTracker displays right away to show progress
3. ✅ User sees clear feedback that the request is being processed
4. ✅ Content blocks are still added as they arrive from the CLI

## Changes Made

### 1. `/home/nicole/maude/packages/server/src/services/claude-process.ts`

#### Added tracking flag (line 357):

```typescript
let sentMessageStart = false;
```

#### Added immediate message_start emission (lines 392-405):

When the system event arrives (which signals the CLI has started), we now immediately:

1. Send a `message_start` event to the client
2. Prevent duplicate emissions with the `sentMessageStart` flag
3. Include the session model information
4. Catch any errors if the stream closes unexpectedly

```typescript
// Send message_start immediately so UI shows streaming indicator
// This ensures users see feedback even if response generation is slow
if (!sentMessageStart) {
  sentMessageStart = true;
  const messageStartEvent = JSON.stringify({
    type: 'message_start',
    message: {
      id: nanoid(),
      role: 'assistant',
      model: session.model || 'unknown',
    },
  });
  try {
    controller.enqueue(encoder.encode(`data: ${messageStartEvent}\n\n`));
  } catch {
    /* stream may be closed */
  }
}
```

### 2. `/home/nicole/maude/packages/server/src/services/claude-process.ts`

#### Enhanced spawn environment (lines 273-281):

Added unbuffered I/O settings to ensure CLI output is streamed immediately:

```typescript
const spawnEnv = {
  ...process.env,
  FORCE_COLOR: '0',
  PYTHONUNBUFFERED: '1', // Python: line-buffered output
  PYTHONIOENCODING: 'utf-8:strict',
};
```

### 3. Added debugging logging (line 377):

```typescript
// Log event receipt for debugging streaming delays
if (cliEvent.type !== 'system') {
  console.log(`[claude:${session.id}] Received ${cliEvent.type} event`);
}
```

## How It Works

### Before the Fix

```
User sends message
  ↓ (5+ minutes of nothing)
CLI finishes and outputs all events
  ↓
UI shows streaming message with all content
```

### After the Fix

```
User sends message
  ↓ (immediately)
System event received from CLI
  ↓
Server sends message_start event
  ↓ (UI shows immediately)
StreamingMessage renders with ToolCallTracker
  ↓ (as content arrives)
Content blocks are added and displayed in real-time
  ↓
CLI finishes
  ↓
message_stop event sent
```

## UI Flow

1. **Message appears immediately** (even if blank)
   - Streaming indicator dots appear
   - ToolCallTracker becomes visible

2. **Progress is visible in real-time**
   - Tool execution progress shows in ToolCallTracker
   - Tool statuses update: pending → running → completed
   - Progress bar shows completion percentage

3. **Content is added as it arrives**
   - Text blocks start appearing
   - Tool results populate
   - Thinking blocks become visible

## Testing

To verify the fix works:

1. Send a message that triggers multiple tools (10+)
2. Observe:
   - ✅ Message appears immediately with streaming indicator
   - ✅ ToolCallTracker shows "0/N tools completed"
   - ✅ Tools start showing completed status as they finish
   - ✅ Content blocks appear as they arrive

## Related Files

- **Client-side display**: `/packages/client/src/lib/components/chat/StreamingMessage.svelte`
- **Tool progress tracking**: `/packages/client/src/lib/components/chat/ToolCallTracker.svelte`
- **Message animations**: `/packages/client/src/lib/components/chat/MessageAnimation.svelte`
- **SSE event handling**: `/packages/client/src/lib/api/sse.ts`
- **Stream state management**: `/packages/client/src/lib/stores/stream.svelte.ts`
