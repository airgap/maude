<script lang="ts">
  /**
   * LoopNotifications — fires OS desktop notifications for loop/story events.
   *
   * Watches loopStore state transitions and fires notifications when the
   * browser tab is not focused. Runs alongside StreamAudio.svelte (which
   * handles chirp sounds for stream events).
   *
   * Mounted once in +layout.svelte.
   */
  import { loopStore } from '$lib/stores/loop.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { desktopNotifications } from '$lib/notifications/desktop-notifications';

  // Track previous values to detect transitions
  let prevLoopStatus = $state<string | null>(null);
  let prevCompletedCount = $state(0);
  let prevStoryStatuses = $state<Map<string, string>>(new Map());

  $effect(() => {
    const loop = loopStore.activeLoop;
    if (!loop) {
      prevLoopStatus = null;
      prevCompletedCount = 0;
      prevStoryStatuses = new Map();
      return;
    }

    const status = loop.status;

    // --- Loop completed ---
    if (status === 'completed' && prevLoopStatus === 'running') {
      if (settingsStore.notifyOnCompletion) {
        desktopNotifications.loopCompleted(loop.totalStoriesCompleted, {
          loopId: loop.id,
        });
      }
    }

    // --- Loop failed ---
    if (status === 'failed' && prevLoopStatus !== 'failed') {
      if (settingsStore.notifyOnFailure) {
        desktopNotifications.loopFailed(undefined, {
          loopId: loop.id,
        });
      }
    }

    prevLoopStatus = status;

    // --- Story completed / failed ---
    // Detect story completion count changes
    const completedNow = loop.totalStoriesCompleted;
    if (completedNow > prevCompletedCount && prevCompletedCount > 0) {
      // A story just completed — find the latest log entry
      const latestLog = loopStore.log[loopStore.log.length - 1];
      if (latestLog) {
        // 'passed' or 'committed' actions indicate a story completed successfully
        if (
          settingsStore.notifyOnCompletion &&
          (latestLog.action === 'passed' || latestLog.action === 'committed')
        ) {
          desktopNotifications.storyCompleted(latestLog.storyTitle || 'Story', {
            storyId: latestLog.storyId,
            loopId: loop.id,
          });
        }
      }
    }
    prevCompletedCount = completedNow;
  });

  // Separate effect for story failures — watches the log for new 'story_failed' entries
  let prevLogLength = $state(0);

  $effect(() => {
    const entries = loopStore.log;
    if (entries.length > prevLogLength) {
      // Check new entries for failures
      const newEntries = entries.slice(prevLogLength);
      for (const entry of newEntries) {
        if (entry.action === 'failed' && settingsStore.notifyOnFailure) {
          desktopNotifications.storyFailed(entry.storyTitle || 'Story', entry.detail || undefined, {
            storyId: entry.storyId,
            loopId: loopStore.activeLoop?.id,
          });
        }
      }
      prevLogLength = entries.length;
    }
    // Reset when log clears
    if (entries.length === 0 && prevLogLength > 0) {
      prevLogLength = 0;
    }
  });
</script>

<!-- No visual output; purely reactive notification side-effects -->
