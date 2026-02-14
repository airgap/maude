# Animation Quick Reference

## 15 Animation Styles Available

| # | Name | Style | Duration | Vibe |
|---|------|-------|----------|------|
| 1 | **None** | Instant | - | Minimal |
| 2 | **Fade In** | Smooth opacity + move | 0.4s | Professional ⭐ |
| 3 | **Slide In (Left)** | Horizontal slide | 0.5s | Modern |
| 4 | **Slide In (Right)** | Horizontal slide | 0.5s | Modern |
| 5 | **Slide In (Up)** | Vertical slide | 0.5s | Natural |
| 6 | **Zoom In** | Scale up | 0.5s | Engaging |
| 7 | **Bounce In** | Elastic bounce | 0.7s | Playful 🎉 |
| 8 | **Rotate In** | Spin + scale | 0.6s | Dynamic |
| 9 | **Flip In** | 3D card flip | 0.6s | Impressive |
| 10 | **Typewriter** | Char-by-char reveal | 0.8s | Retro ⌨️ |
| 11 | **Glitch** | VHS error effect | 0.6s | Cyberpunk |
| 12 | **Matrix** | Digital glow | 1.0s | Sci-fi 🟢 |
| 13 | **Neon Pulse** | Glowing border | 1.2s | Cyberpunk 🟦 |
| 14 | **Hologram** | Shimmer phase | 1.0s | Futuristic |
| 15 | **Quantum Flutter** | Wave distortion | 0.8s | Chaotic Fun |

## How to Change

**Settings → Appearance → Message Animation → Select Style**

## Recommendation Matrix

```
PROFESSIONAL    : Fade In, Slide In (Left), Slide In (Up)
CREATIVE        : Zoom In, Flip In, Hologram
PLAYFUL         : Bounce In, Glitch, Quantum Flutter
CYBERPUNK/SCIFI : Neon Pulse, Matrix, Glitch, Hologram
PERFORMANCE     : None, Fade In
```

## Key Features

✨ **All animations...**
- Use pure CSS3 (no JavaScript overhead)
- Save to browser automatically
- Respond to theme changes
- Work across all message types
- Are GPU-accelerated for smooth performance

## Performance Impact

| Animation | Performance |
|-----------|-------------|
| None | Perfect |
| Fade In | Excellent ⭐ |
| Basic slides/zoom | Excellent |
| Typewriter | Good |
| Glitch | Good |
| Matrix | Good |
| Neon Pulse | Very Good |
| Hologram | Very Good |
| Quantum Flutter | Very Good |

## Files Modified

- `MessageAnimation.svelte` - New animation component (351 lines)
- `settings.svelte.ts` - Added `messageAnimation` setting
- `StreamingMessage.svelte` - Wrapped with animations
- `MessageBubble.svelte` - Wrapped with animations (for completed messages)
- `SettingsModal.svelte` - Added UI selector dropdown

## What's Animated

✅ Both streaming and completed Claude messages
✅ All message types (text, thinking, tool calls)
✅ Agent groups and nested content
✅ Works with all themes

## Browser Support

All modern browsers (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)

---

**Try them all and find your favorite! 🎬**
