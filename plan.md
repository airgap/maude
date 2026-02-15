# Hypertheme System — Four Magical Themes

## Concept

A **hypertheme** goes beyond color changes. It controls the entire visual _personality_ of the app:

- **Overlay effects** (grid → runes, particles, constellations, etc.)
- **Animation style** (HUD blink → candleflicker, shimmer, drift, etc.)
- **Border radii** (sharp tech → rounded organic, ornate, etc.)
- **Letter-spacing / text-transform** (uppercase HUD → normal, small-caps, etc.)
- **Suggested default fonts** (each hypertheme recommends a mono + sans pair)
- **Text shadows / glow style** (cyan glow → warm amber, soft iridescent, etc.)
- **Accent overlay pattern** (scanlines → none, subtle texture, etc.)

Regular color themes (dark, dracula, nord, etc.) continue to work _within_ any hypertheme. The hypertheme is the visual "shell"; the color theme fills in the palette.

## The Five Hyperthemes

### 1. `tech` (Current Default — extracted, not changed)

- Grid overlay (40px squares), scanline bars on topbar
- HUD blink, shieldCharge animations
- Sharp radii (2px), uppercase letter-spaced text
- Cyan glow text-shadows
- Fonts: Share Tech Mono + Rajdhani

### 2. `arcane` (Arcane/Runic)

- **Overlay**: Faint runic circle / sigil pattern (SVG-based, rotating slowly)
- **Animations**: Slow ember float, rune pulse (gentle glow throb)
- **Radii**: 4-6px (slightly rounded, like carved stone)
- **Text style**: Small-caps on labels, normal case elsewhere
- **Glows**: Warm amber/gold (`rgba(255, 170, 50, ...)`)
- **Suggested fonts**: `Fira Code` + `Exo 2`
- **Topbar accent**: No scanlines; subtle carved-edge border-bottom

### 3. `ethereal` (Ethereal/Fae)

- **Overlay**: Floating particle dots (CSS animation, 20-30 small circles drifting upward)
- **Animations**: Gentle shimmer, soft breathing glow
- **Radii**: 8-12px (pill-like, organic)
- **Text style**: Normal case, slightly increased letter-spacing
- **Glows**: Soft iridescent (shifting hue via oklch)
- **Suggested fonts**: `Victor Mono` + `Outfit`
- **Topbar accent**: No scanlines; soft gradient bottom-border

### 4. `study` (Wizard's Study)

- **Overlay**: None (clean, warm)
- **Animations**: Candlelight flicker on active elements, gentle page-turn fade
- **Radii**: 6px (rounded but not pill-shaped)
- **Text style**: Normal case, serif-influenced (we add a serif sans option)
- **Glows**: Warm candlelight amber (`rgba(200, 150, 60, ...)`)
- **Suggested fonts**: `Courier Prime` + `Inter` (or new `Crimson Pro` serif)
- **Topbar accent**: Thin ornate double-line border

### 5. `astral` (Celestial/Astral)

- **Overlay**: Tiny star dots (CSS radial-gradient speckle pattern)
- **Animations**: Slow constellation drift, nebula color shift
- **Radii**: 4px (clean, geometric)
- **Text style**: Normal case, wider letter-spacing
- **Glows**: Silvery moonlight (`rgba(180, 200, 240, ...)`)
- **Suggested fonts**: `Space Mono` + `Space Grotesk`
- **Topbar accent**: No scanlines; subtle starfield speckle

## Implementation Plan

### Phase 1: Hypertheme Infrastructure

**Step 1: Define hypertheme config type and registry**

- New file: `packages/client/src/lib/config/hyperthemes.ts`
- Define `HyperthemeConfig` interface:
  ```typescript
  interface HyperthemeConfig {
    id: string;
    label: string;
    description: string;
    // CSS custom properties this hypertheme sets
    cssVars: Record<string, string>; // --radius, --radius-sm, etc.
    // Overlay type
    overlay: 'grid' | 'runes' | 'particles' | 'stars' | 'none';
    // Topbar accent
    topbarAccent: 'scanlines' | 'gradient' | 'ornate' | 'speckle' | 'none';
    // Animation set name
    animationSet: 'tech' | 'arcane' | 'ethereal' | 'study' | 'astral';
    // Text style
    textTransform: 'uppercase' | 'small-caps' | 'none';
    letterSpacing: string;
    // Suggested fonts (just defaults — user can override)
    suggestedMonoFont: string; // font ID
    suggestedSansFont: string; // font ID
    // Brand styling
    brandTextShadow: string;
  }
  ```
- Register all 5 hyperthemes with their configs

**Step 2: Add hypertheme to settings store**

- Add `hypertheme: string` to `SettingsState` (default: `'tech'`)
- In `applyTheme()`, also apply the active hypertheme's CSS vars
- New `setHypertheme(id)` method that:
  - Sets the hypertheme
  - Applies its CSS vars to `:root`
  - Sets `data-hypertheme` attribute on `<html>`
  - Optionally switches to suggested fonts (with confirmation)

**Step 3: Add new CSS custom properties for hypertheme-controlled values**
Add these to `:root` in app.css (tech defaults):

```css
--ht-overlay: ...; /* controlled by JS/data-attribute */
--ht-radius: 2px;
--ht-radius-sm: 1px;
--ht-radius-lg: 3px;
--ht-radius-xl: 4px;
--ht-letter-spacing: 0.3px;
--ht-label-transform: uppercase;
--ht-label-spacing: 1.5px;
--ht-brand-shadow: 0 0 10px rgba(0, 180, 255, 0.4), 0 0 20px rgba(0, 180, 255, 0.1);
--ht-glow-color: 0, 180, 255; /* RGB triplet for compositing */
--ht-glow-sm: 0 0 8px rgba(var(--ht-glow-color), 0.15);
--ht-glow-lg: 0 0 15px rgba(var(--ht-glow-color), 0.2), 0 0 30px rgba(var(--ht-glow-color), 0.05);
```

### Phase 2: Fix Hardcoded Tech Aesthetics

**Step 4: Replace hardcoded rgba(0, 180, 255, ...) across all components**

- Replace ~50+ hardcoded cyan values with `rgba(var(--ht-glow-color), <opacity>)` or appropriate CSS vars
- Files affected: AppShell, TopBar, StatusBar, ChatInput, StreamingMessage, StreamingText, MessageList, MessageBubble, FloatingPanel, ConversationList, SidebarTabBar, SplitPane, EditorPane, SearchPanel, MemoryPanel, StoryActionCards, ToolCallTracker, ToolCallBlock, ToolApprovalDialog, RightDockedPanels, maude-cm-theme.ts, TemplateLibraryModal

**Step 5: Replace hardcoded border-radius values**

- Swap hardcoded `2px`, `3px` etc. with `var(--ht-radius)`, `var(--ht-radius-sm)`, etc.

**Step 6: Make overlays conditional on `[data-hypertheme]`**

- AppShell `::before` grid overlay → conditional
- TopBar `::after` scanline overlay → conditional
- Each hypertheme gets its own overlay CSS in app.css

**Step 7: Make text-transform/letter-spacing use CSS vars**

- Brand in TopBar: use `var(--ht-label-transform)` and `var(--ht-label-spacing)`
- StatusBar labels: same
- Other uppercase labels throughout: same

### Phase 3: Create the Four Magic Hyperthemes

**Step 8: Arcane hypertheme CSS + overlay**

- `[data-hypertheme='arcane']` CSS block with all `--ht-*` overrides
- Runic circle SVG overlay (encoded as data URI in CSS background)
- Slow rotation animation `@keyframes runeRotate`
- Ember float animation `@keyframes emberFloat`

**Step 9: Ethereal hypertheme CSS + overlay**

- `[data-hypertheme='ethereal']` CSS block
- Particle overlay using multiple CSS `radial-gradient` dots with `@keyframes particleDrift`
- Shimmer animation `@keyframes shimmer`
- Breathing glow `@keyframes etherealBreathe`

**Step 10: Wizard's Study hypertheme CSS + overlay**

- `[data-hypertheme='study']` CSS block
- No overlay (clean warm aesthetic)
- Candleflicker animation `@keyframes candleFlicker` (subtle opacity + color-temp shift)
- Add `Crimson Pro` as a new serif sans-serif option in fonts.ts
- Ornate double-line topbar border

**Step 11: Astral hypertheme CSS + overlay**

- `[data-hypertheme='astral']` CSS block
- Starfield speckle using `radial-gradient` pattern
- `@keyframes starTwinkle` for random opacity shifts
- `@keyframes nebulaDrift` for slow background color shift

### Phase 4: Settings UI

**Step 12: Add Hypertheme selector to Settings > Appearance**

- New "Visual Style" section at the top of the Appearance tab
- Grid of 5 hypertheme cards (similar to theme grid but with icon + description)
- Each card shows: icon/glyph, name, one-line description
- Selecting a hypertheme applies it immediately (live preview)
- Optional "Also switch to suggested fonts?" prompt on first switch

### Summary of files to create/modify

**New files:**

- `packages/client/src/lib/config/hyperthemes.ts`

**Modified files:**

- `packages/shared/src/settings.ts` — add hypertheme to ThemeId/Settings type
- `packages/client/src/lib/stores/settings.svelte.ts` — add hypertheme state + apply logic
- `packages/client/src/app.css` — add `--ht-*` vars, `[data-hypertheme]` blocks, new keyframes
- `packages/client/src/lib/components/settings/SettingsModal.svelte` — hypertheme selector UI
- `packages/client/src/lib/components/layout/AppShell.svelte` — conditional overlay
- `packages/client/src/lib/components/layout/TopBar.svelte` — conditional accent + brand style
- `packages/client/src/lib/components/layout/StatusBar.svelte` — text style vars
- `packages/client/src/lib/config/fonts.ts` — add Crimson Pro serif option
- ~20 component files — replace hardcoded rgba(0,180,255,...) with CSS vars
