# Real-Time Streaming Debug Guide

## Problem Statement
Messages are not appearing in the UI until after a page reload. They exist in the database, proving the server processed them, but they don't stream to the browser in real-time.

## Root Cause Analysis
The issue is likely one of these:

1. **Server-side**: SSE stream is not being flushed to the browser
   - The ReadableStream is created but not actually streaming data
   - The CLI output is being buffered entirely before being sent
   - The subprocess is not producing output in real-time

2. **Client-side**: Stream is received but not being processed
   - The fetch request completes before streaming chunks
   - The async loop in `sendAndStream` is not executing
   - Svelte reactivity is not detecting store changes

3. **Network**: Response is being buffered by proxies/middleware
   - Load balancer buffering entire response
   - Hono framework buffering the response
   - Browser HTTP implementation buffering

## Debug Logging Added

### Server-Side Logs (look in server console)

**Stream initialization:**
```
[stream] SSE ReadableStream started for session: <sessionId>
[stream] Starting to read from CLI stdout
[claude:sessionId] Received system event
[stream] Enqueuing message_start event
[claude:sessionId] Received assistant event
[stream] Enqueuing event: <event data>
```

**Event emission:**
```
[claude:sessionId] Received <event_type> event at <timestamp>
[stream] Enqueuing message_start event
[stream] Enqueuing event: ...
```

### Client-Side Logs (look in browser DevTools console)

**Stream start:**
```
[sse] Starting stream for conversation: <convId> content: <text>
```

**Response received:**
```
[sse] Got response: 200 true
[sse] Got reader: true
```

**Reading loop:**
```
[sse] Reading chunk...
[sse] Decoded buffer length: <N> contains: <data>
[sse] Received event: message_start {...}
[sse] Received event: content_block_start {...}
...
[sse] Stream done
```

## Testing Steps

### 1. Check Server Logs
1. Open terminal where server is running
2. Send a message from the UI
3. Watch for logs like:
   - `[stream] SSE ReadableStream started for session: ...`
   - `[stream] Starting to read from CLI stdout`
   - `[stream] Enqueuing message_start event`

**Expected:** Should see these logs within a few seconds

**If missing:** The ReadableStream `start()` function isn't being called, or the CLI process isn't producing output

### 2. Check Browser Console
1. Open DevTools (F12)
2. Go to Console tab
3. Send a message from the UI
4. Watch for logs like:
   - `[sse] Starting stream for conversation: ...`
   - `[sse] Got response: 200 true`
   - `[sse] Reading chunk...`
   - `[sse] Received event: message_start`

**Expected:** Should see chunk reading and events arriving within 1-2 seconds

**If missing:** The fetch request isn't completing or the reader isn't being called

### 3. Check Network Tab
1. Open DevTools Network tab
2. Send a message
3. Look for the `/stream/<convId>` request
4. Check if it's showing as "pending" or "completed"
5. Click on it and check Response tab

**Expected:** 
- Status: 200
- Content-Type: text/event-stream
- Response should show SSE data like `data: {...}`

**If wrong:**
- Status not 200: Server error, check server logs
- Response empty: No data sent from server
- Response shows all data at once: Response was buffered

## Probable Issues & Solutions

### Issue 1: Server Logs Don't Show Event Enqueuing
**Cause:** ReadableStream start() not executing or CLI not producing output

**Solutions:**
1. Check if CLI is installed: `which claude` or `which kiro-cli`
2. Try running the CLI manually with the same args
3. Check if process is spawning correctly
4. Add more verbose logging to CLI invocation

### Issue 2: Browser Shows No Logs At All
**Cause:** `sendAndStream()` not being called or fetch hanging

**Solutions:**
1. Check browser console for any errors
2. Verify ChatInput is actually calling `sendAndStream()`
3. Check if there's a CORS issue
4. Check if network request is stuck (Network tab)

### Issue 3: Browser Gets Response But No Chunk Reading
**Cause:** Response not streaming, or reader hanging

**Solutions:**
1. Check response headers for `Content-Type: text/event-stream`
2. Try using `fetch` with no special options
3. Check if it's a Hono buffering issue - might need to use `c.streamText()` instead of `Response`

### Issue 4: Events Arriving But UI Not Updating
**Cause:** Svelte reactivity issue - store changes not triggering re-renders

**Solutions:**
1. Add logging to store's `handleEvent()` to confirm it's being called
2. Check that assignments like `contentBlocks = [...]` are actually executing
3. Verify MessageList component is subscribed to store changes
4. Check browser console for Svelte warnings

## Quick Diagnosis Script

```javascript
// Run this in browser console:
console.log('Testing SSE streaming...');

// Check if fetch works
fetch('/api/conversations')
  .then(r => r.json())
  .then(d => console.log('Fetch works:', d))
  .catch(e => console.log('Fetch failed:', e));

// Check stores
console.log('Stream store status:', streamStore.status);
console.log('Conversation store active:', conversationStore.active?.id);
```

## Next Steps

1. **Run the debug steps above** and collect the logs
2. **Share the logs** to identify which stage is failing
3. **Based on which logs are missing**, we can identify the exact issue
4. **Apply the appropriate fix** from the solutions above

The logging is now comprehensive enough to pinpoint exactly where the streaming is breaking down.
