<script lang="ts">
  import '../app.css';
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import LoginPage from '$lib/components/auth/LoginPage.svelte';
  import { api, getAuthToken } from '$lib/api/client';
  import { streamStore, STREAM_CONTEXT_KEY } from '$lib/stores/stream.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { findFont, buildGoogleFontsUrl, type FontOption } from '$lib/config/fonts';
  import { onMount, setContext } from 'svelte';

  // Set stream store in context for proper Svelte 5 reactivity tracking
  setContext(STREAM_CONTEXT_KEY, streamStore);

  // --- Dynamic font loading & CSS variable application ---
  const loadedFonts = new Set<string>();

  function loadGoogleFont(font: FontOption) {
    if (!font.googleFont || loadedFonts.has(font.id)) return;
    const url = buildGoogleFontsUrl([font]);
    if (!url) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
    loadedFonts.add(font.id);
  }

  $effect(() => {
    const root = document.documentElement;

    // Apply font size
    root.style.setProperty('--font-size', `${settingsStore.fontSize}px`);

    // Apply mono font
    const monoFont = findFont(settingsStore.fontFamily);
    if (monoFont) {
      loadGoogleFont(monoFont);
      root.style.setProperty('--font-family', monoFont.family);
    }

    // Apply sans font
    const sansFont = findFont(settingsStore.fontFamilySans);
    if (sansFont) {
      loadGoogleFont(sansFont);
      root.style.setProperty('--font-family-sans', sansFont.family);
    }
  });

  let { children } = $props();

  let authRequired = $state(false);
  let authenticated = $state(false);
  let checking = $state(true);

  onMount(async () => {
    try {
      const status = await api.auth.status();
      authRequired = status.data.enabled;
      if (authRequired && getAuthToken()) {
        // Validate existing token
        try {
          await api.auth.me();
          authenticated = true;
        } catch {
          authenticated = false;
        }
      } else if (!authRequired) {
        authenticated = true;
      }
    } catch {
      // Can't reach server or auth not set up — show app
      authenticated = true;
    }
    checking = false;
  });
</script>

{#if checking}
  <div
    style="display:flex;align-items:center;justify-content:center;height:100vh;background:var(--bg-primary);color:var(--text-tertiary);font-size:14px;"
  >
    Loading...
  </div>
{:else if authRequired && !authenticated}
  <LoginPage
    onAuthenticated={() => {
      authenticated = true;
    }}
  />
{:else}
  <AppShell>
    {@render children()}
  </AppShell>
{/if}
