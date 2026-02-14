<script lang="ts">
  import '../app.css';
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import LoginPage from '$lib/components/auth/LoginPage.svelte';
  import { api, getAuthToken } from '$lib/api/client';
  import { streamStore, STREAM_CONTEXT_KEY } from '$lib/stores/stream.svelte';
  import { onMount, setContext } from 'svelte';
  
  // Set stream store in context for proper Svelte 5 reactivity tracking
  setContext(STREAM_CONTEXT_KEY, streamStore);

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
