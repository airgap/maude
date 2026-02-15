# Throbber Selection Settings

## Overview

Add three new settings to let users choose the style of each streaming animation:

1. **Header indicator** (dots next to "Claude")
2. **Bottom progress bar** (rainbow bar at message bottom)
3. **Text cursor** (blinking character while typing)

## Settings to add to `SettingsState`

### `streamingIndicator`: `'dots' | 'spinner' | 'pulse' | 'none'`

- `dots` (default) — current 3 pulsing dots
- `spinner` — small spinning circle
- `pulse` — single pulsing orb
- `none` — hidden

### `streamingProgressBar`: `'rainbow' | 'accent' | 'pulse' | 'none'`

- `rainbow` (default) — current sliding rainbow gradient
- `accent` — solid accent-color slide
- `pulse` — subtle pulsing glow bar
- `none` — hidden

### `streamingCursor`: `'block' | 'line' | 'underscore' | 'none'`

- `block` (default) — current `▊` character
- `line` — thin `|` pipe
- `underscore` — `_` character
- `none` — hidden

## Files to modify

### 1. `packages/client/src/lib/stores/settings.svelte.ts`

- Add three new fields to `SettingsState` interface
- Add defaults
- Add getters

### 2. `packages/client/src/lib/components/settings/SettingsModal.svelte`

- Add "Streaming" section in the Appearance tab (after "Show budget in status bar")
- Three select dropdowns, one for each setting

### 3. `packages/client/src/lib/components/chat/StreamingMessage.svelte`

- Read `settingsStore.streamingIndicator` — conditionally render dots/spinner/pulse/none
- Read `settingsStore.streamingProgressBar` — conditionally render rainbow/accent/pulse/none
- Add CSS for spinner and pulse indicator variants
- Add CSS for accent and pulse progress bar variants

### 4. `packages/client/src/lib/components/chat/StreamingText.svelte`

- Read `settingsStore.streamingCursor` — render cursor char based on setting
- Adjust cursor styling per variant
