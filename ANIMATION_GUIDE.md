# Claude Message Animation System

## Overview

The Claude Code IDE now features a powerful, customizable animation system for Claude's reply messages! You can choose from **15+ different animation styles** to make your interactions more visually engaging and fun.

## Animation Options

### Basic Animations

These are smooth, elegant animations perfect for a professional look:

#### 1. **None**
- No animation effect
- Messages appear instantly
- Best for: Users who prefer minimal visual effects

#### 2. **Fade In**
- Smooth opacity transition with slight upward movement
- Duration: 0.4s
- Best for: Clean, professional look; default option

#### 3. **Slide In (Left)**
- Message slides in from the left with fade-in
- Duration: 0.5s
- Easing: Smooth cubic curve
- Best for: Modern, sleek appearance

#### 4. **Slide In (Right)**
- Message slides in from the right with fade-in
- Duration: 0.5s
- Easing: Smooth cubic curve
- Best for: Alternative slide-in direction

#### 5. **Slide In (Up)**
- Message slides up from below with fade-in
- Duration: 0.5s
- Easing: Smooth cubic curve
- Best for: Natural bottom-to-top entrance

#### 6. **Zoom In**
- Message scales up from small to full size
- Duration: 0.5s
- Includes elastic easing for smooth arrival
- Best for: Eye-catching, engaging feel

#### 7. **Bounce In**
- Message bounces into view with elastic spring effect
- Duration: 0.7s
- Scale: 0.3 → 1.05 → 0.95 → 1.0
- Best for: Playful, energetic interactions

#### 8. **Rotate In**
- Message spins and scales in from a small, rotated state
- Duration: 0.6s
- Rotation: -30° → 0°
- Best for: Dynamic, fun presentations

### Special Effects Animations

These are advanced animations with special visual effects:

#### 9. **Flip In**
- 3D card flip effect using perspective transform
- Duration: 0.6s
- Rotation: 90° → 0° (Y-axis)
- Best for: Striking, impressive entrances

#### 10. **Typewriter**
- Text appears to be typed out character by character
- Duration: 0.8s
- Uses clip-path for true character-by-character reveal
- Best for: Retro, classic typing experience

#### 11. **Glitch**
- Digital/VHS error effect with rapid position shifts
- Duration: 0.6s
- RGB shift simulation with color offsets
- Best for: Cyberpunk, hacker aesthetic, fun glitch effect

#### 12. **Matrix**
- "Matrix-style" digital rain effect
- Duration: 1.0s
- Includes glow text-shadow (cyan + green neon glow)
- Best for: Sci-fi, tech-forward feel

#### 13. **Neon Pulse**
- Glowing neon border effect with expanding glow
- Duration: 1.2s
- Multi-layer glowing aura animation
- Best for: Cyberpunk, neon aesthetic, nightlife vibe

#### 14. **Hologram**
- Futuristic holographic shimmer and phase effect
- Duration: 1.0s
- Includes hue rotation and brightness modulation
- Best for: Sci-fi, advanced tech aesthetic

#### 15. **Quantum Flutter**
- Random wave distortion with blur and rotation
- Duration: 0.8s
- Uses cubic Bézier easing for unpredictable motion
- Best for: Playful, quantum computing inspired, chaotic fun

## How to Use

### Changing Animation Style

1. Click the **Settings** button (gear icon) in the top menu
2. Go to the **Appearance** tab
3. Find **Message Animation** dropdown
4. Select your preferred animation style
5. Changes apply immediately!

### Setting Persistence

Your animation preference is automatically saved to local storage and will persist across:
- Browser refreshes
- New chat sessions
- Closing and reopening the application

## Technical Details

### Component Architecture

- **MessageAnimation.svelte**: Core animation wrapper component
- Exports `AnimationStyle` type with all 15 animation options
- Uses Svelte snippets for flexible rendering
- Responsive to `settingsStore.messageAnimation` changes

### Performance

- Animations use GPU-accelerated transforms where possible
- No JavaScript animations - pure CSS3 keyframes
- Minimal performance impact even on slower devices
- Optional: Can disable animations entirely for better performance

### Browser Compatibility

All animations use standard CSS3 features supported by:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- All modern browsers

## Customization

### Adding New Animations

To add a custom animation:

1. **Add to type definition** in `settings.svelte.ts`:
```typescript
messageAnimation: 'none' | 'fadeIn' | ... | 'myNewAnimation'
```

2. **Create animation keyframes** in `MessageAnimation.svelte`:
```css
@keyframes myNewAnimationKeyframe {
  from {
    opacity: 0;
    transform: /* your transform */;
  }
  to {
    opacity: 1;
    transform: none;
  }
}
```

3. **Add selector** in `MessageAnimation.svelte`:
```css
.message-animation-wrapper[data-animation='myNewAnimation'] {
  animation: myNewAnimationKeyframe 0.5s ease-out forwards;
}
```

4. **Add to settings UI** in `SettingsModal.svelte`:
```svelte
<option value="myNewAnimation">My New Animation</option>
```

### Adjusting Animation Timing

All animations can be customized by modifying:
- Duration (e.g., `0.4s`, `0.6s`)
- Easing function (e.g., `ease-out`, `cubic-bezier(...)`)
- Transform properties (scale, rotate, translate, etc.)

## Recommendations by Use Case

### For Professional/Corporate
- **Fade In** - clean and minimal
- **Slide In (Up)** - subtle and smooth
- **Slide In (Left)** - modern and polished

### For Creative/Design
- **Zoom In** - engaging and professional
- **Flip In** - striking and impressive
- **Hologram** - futuristic and cool

### For Fun/Casual
- **Bounce In** - playful and energetic
- **Glitch** - fun and retro
- **Quantum Flutter** - chaotic and whimsical

### For Cyberpunk/Gaming
- **Neon Pulse** - cyberpunk aesthetic
- **Matrix** - hacker vibe
- **Glitch** - digital error effect

## Troubleshooting

### Animations not working
- Ensure you're on a modern browser (Chrome 90+, Firefox 88+, etc.)
- Check that animations are not set to "None"
- Clear browser cache and localStorage if needed

### Animations look janky
- Try a different easing function
- Reduce animation duration
- Disable GPU-intensive effects if on older hardware

### Performance issues
- Set animation to "None" for maximum performance
- Reduce the duration of animations
- Close other browser tabs

## CSS Variables Used

Animations use Maude's existing CSS variable system:
- `--accent-primary`: Primary accent color (#00b4ff in dark mode)
- `--accent-secondary`: Secondary accent color (#00ff88 in dark mode)
- `--text-primary`: Main text color
- `--bg-primary`, `--bg-secondary`: Background colors
- All variables respond to theme changes automatically

## Future Enhancements

Potential additions for future versions:
- Pre-made animation presets/themes
- Animation speed control slider
- Ability to combine multiple animations
- Custom keyframe upload support
- Animation randomization option
- Per-message animation override

## Contributing

To suggest new animations or improve existing ones:
1. Check the `MessageAnimation.svelte` component
2. Submit enhancement requests with animation descriptions
3. Include any reference videos or live examples

---

**Enjoy the enhanced visual experience with Claude's new animation system!** 🎨✨
