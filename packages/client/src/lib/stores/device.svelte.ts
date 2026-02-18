/**
 * Device / input capability detection.
 *
 * - `isTouchPrimary`  — pointer:coarse (no fine mouse), i.e. phone/tablet
 * - `hasHardwareKeyboard` — a physical key has been pressed this session
 * - `isMobileUI`     — true when touch-primary AND no hardware keyboard detected
 *
 * The `isMobileUI` flag drives the `data-mobile` attribute on <html>, which
 * CSS and components use to switch between mobile-first and desktop layouts.
 */

function createDeviceStore() {
  // Start by sniffing pointer capability synchronously
  const coarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  let isTouchPrimary = $state(coarsePointer);
  let hasHardwareKeyboard = $state(false);

  // Derive mobile UI mode
  const isMobileUI = $derived(isTouchPrimary && !hasHardwareKeyboard);

  function init() {
    if (typeof window === 'undefined') return;

    // Re-evaluate pointer capability (e.g. Bluetooth mouse connected later)
    const mq = window.matchMedia('(pointer: coarse)');
    isTouchPrimary = mq.matches;
    mq.addEventListener('change', (e) => {
      isTouchPrimary = e.matches;
      // If a fine pointer appeared, also reset keyboard flag so desktop
      // layout kicks in immediately without requiring a keypress.
      if (!e.matches) hasHardwareKeyboard = true;
    });

    // Any physical keypress means hardware keyboard is present.
    // We listen for non-modifier, non-IME keys to avoid false positives.
    const onKeydown = (e: KeyboardEvent) => {
      if (hasHardwareKeyboard) return;
      // Ignore pure modifier keys and synthetic events from virtual keyboards
      if (['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Tab'].includes(e.key)) return;
      // isComposing = true means IME virtual input, not physical key
      if (e.isComposing) return;
      hasHardwareKeyboard = true;
    };
    window.addEventListener('keydown', onKeydown, { passive: true });

    // If the on-screen keyboard pops up (viewport height shrinks significantly
    // on input focus), we know there's NO hardware keyboard.
    let baseHeight = window.visualViewport?.height ?? window.innerHeight;
    const onViewportResize = () => {
      const current = window.visualViewport?.height ?? window.innerHeight;
      // >30% shrink = software keyboard appeared
      if (current < baseHeight * 0.7) {
        hasHardwareKeyboard = false;
      } else {
        baseHeight = Math.max(baseHeight, current);
      }
    };
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportResize);
    }

    // Apply/remove data-mobile on <html> reactively
    $effect(() => {
      if (isMobileUI) {
        document.documentElement.setAttribute('data-mobile', '');
      } else {
        document.documentElement.removeAttribute('data-mobile');
      }
    });
  }

  return {
    get isTouchPrimary() { return isTouchPrimary; },
    get hasHardwareKeyboard() { return hasHardwareKeyboard; },
    get isMobileUI() { return isMobileUI; },
    init,
  };
}

export const deviceStore = createDeviceStore();
