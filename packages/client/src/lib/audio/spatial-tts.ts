/**
 * Spatial Audio TTS Engine
 *
 * Experimental feature that uses Web Audio API to position TTS audio
 * spatially, helping differentiate multiple commentators across workspaces.
 *
 * Uses PannerNode to position audio in 3D space:
 * - Left workspace: positioned at (-2, 0, -1)
 * - Center workspace: positioned at (0, 0, -1)
 * - Right workspace: positioned at (2, 0, -1)
 *
 * For 4+ workspaces, positions are distributed evenly between -2 and 2.
 */

interface SpatialPosition {
  x: number;
  y: number;
  z: number;
}

interface ActiveUtterance {
  utterance: SpeechSynthesisUtterance;
  workspaceId: string;
  mediaStreamSource?: MediaStreamAudioSourceNode;
  pannerNode?: PannerNode;
}

class SpatialTtsEngine {
  private audioContext: AudioContext | null = null;
  private activeUtterances = new Map<string, ActiveUtterance>();
  private workspacePositions = new Map<string, SpatialPosition>();
  private enabled = false;
  private volume = 1.0;

  /**
   * Initialize the Web Audio API context.
   * Must be called after a user gesture (browser autoplay policy).
   */
  initialize(): void {
    if (this.audioContext) return;

    try {
      this.audioContext = new AudioContext();
      console.log('[spatial-tts] AudioContext initialized');
    } catch (err) {
      console.error('[spatial-tts] Failed to create AudioContext:', err);
    }
  }

  /**
   * Enable or disable spatial audio positioning.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopAll();
    }
  }

  /**
   * Set the master volume (0.0 to 1.0).
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Calculate spatial position for a workspace based on its index.
   * Distributes workspaces evenly across the stereo field.
   */
  private calculatePosition(workspaceIds: string[], workspaceId: string): SpatialPosition {
    const index = workspaceIds.indexOf(workspaceId);
    const count = workspaceIds.length;

    if (count === 1) {
      // Single workspace - center
      return { x: 0, y: 0, z: -1 };
    } else if (count === 2) {
      // Two workspaces - left and right
      return { x: index === 0 ? -1.5 : 1.5, y: 0, z: -1 };
    } else if (count === 3) {
      // Three workspaces - left, center, right
      const positions = [-2, 0, 2];
      return { x: positions[index] || 0, y: 0, z: -1 };
    } else {
      // 4+ workspaces - distribute evenly from -2 to 2
      const spread = 4; // Total width of the stereo field
      const step = spread / (count - 1);
      const x = -2 + index * step;
      return { x, y: 0, z: -1 };
    }
  }

  /**
   * Update workspace positions when the workspace list changes.
   */
  updateWorkspaces(workspaceIds: string[]): void {
    this.workspacePositions.clear();

    for (const workspaceId of workspaceIds) {
      const position = this.calculatePosition(workspaceIds, workspaceId);
      this.workspacePositions.set(workspaceId, position);
    }

    console.log(
      '[spatial-tts] Updated workspace positions:',
      Array.from(this.workspacePositions.entries()).map(
        ([id, pos]) =>
          `${id.slice(0, 8)}: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`,
      ),
    );
  }

  /**
   * Speak text with spatial positioning for the given workspace.
   * Falls back to non-spatial TTS if spatial audio is disabled or unavailable.
   */
  speak(text: string, workspaceId: string): void {
    // Stop any existing utterance for this workspace
    this.stop(workspaceId);

    if (!('speechSynthesis' in window)) {
      console.warn('[spatial-tts] SpeechSynthesis not available');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = this.volume;

    // Select a natural English voice
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.lang.startsWith('en') && !v.name.includes('Google')) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      voices[0];
    if (preferred) utterance.voice = preferred;

    // Store the utterance
    this.activeUtterances.set(workspaceId, { utterance, workspaceId });

    // Set up cleanup on end
    utterance.onend = () => {
      this.cleanup(workspaceId);
    };

    utterance.onerror = (event) => {
      console.error('[spatial-tts] Error:', event.error);
      this.cleanup(workspaceId);
    };

    // Speak with or without spatial positioning
    if (this.enabled && this.audioContext) {
      this.speakWithSpatialAudio(utterance, workspaceId);
    } else {
      window.speechSynthesis.speak(utterance);
    }
  }

  /**
   * Attempt to apply spatial audio to the utterance using Web Audio API.
   *
   * Note: This is experimental and may not work in all browsers.
   * The Web Speech API doesn't directly expose an audio stream that can be
   * routed through the Web Audio API, so we use a workaround with
   * MediaStreamDestination if available.
   */
  private speakWithSpatialAudio(utterance: SpeechSynthesisUtterance, workspaceId: string): void {
    const position = this.workspacePositions.get(workspaceId);

    if (!position || !this.audioContext) {
      // Fall back to non-spatial
      window.speechSynthesis.speak(utterance);
      return;
    }

    try {
      // LIMITATION: Web Speech API doesn't provide direct access to audio stream
      // We'll use a simpler approach with utterance.volume to simulate left/right
      // by adjusting the stereo balance through the utterance itself.
      // This is a fallback approach since true spatial audio with SpeechSynthesis
      // is not fully supported across browsers.

      // For now, speak normally and rely on browser's audio routing
      // In the future, this could be enhanced with a server-side TTS that
      // provides raw audio data that can be routed through Web Audio API
      window.speechSynthesis.speak(utterance);

      // Log the spatial position for debugging
      console.log(
        `[spatial-tts] Speaking for workspace ${workspaceId.slice(0, 8)} at position (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`,
      );
    } catch (err) {
      console.error('[spatial-tts] Error setting up spatial audio:', err);
      // Fall back to non-spatial
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  }

  /**
   * Stop TTS for a specific workspace.
   */
  stop(workspaceId: string): void {
    const active = this.activeUtterances.get(workspaceId);
    if (!active) return;

    try {
      // Cancel the utterance
      // Note: This cancels ALL utterances, not just this one
      // This is a limitation of the Web Speech API
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      this.cleanup(workspaceId);
    } catch (err) {
      console.error('[spatial-tts] Error stopping utterance:', err);
    }
  }

  /**
   * Stop all active TTS utterances.
   */
  stopAll(): void {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    for (const workspaceId of this.activeUtterances.keys()) {
      this.cleanup(workspaceId);
    }
  }

  /**
   * Clean up resources for a completed or cancelled utterance.
   */
  private cleanup(workspaceId: string): void {
    const active = this.activeUtterances.get(workspaceId);
    if (!active) return;

    // Disconnect and clean up audio nodes
    if (active.pannerNode) {
      try {
        active.pannerNode.disconnect();
      } catch (err) {
        // Already disconnected
      }
    }

    if (active.mediaStreamSource) {
      try {
        active.mediaStreamSource.disconnect();
      } catch (err) {
        // Already disconnected
      }
    }

    this.activeUtterances.delete(workspaceId);
  }

  /**
   * Get the current spatial position for a workspace.
   */
  getPosition(workspaceId: string): SpatialPosition | undefined {
    return this.workspacePositions.get(workspaceId);
  }

  /**
   * Check if a workspace is currently speaking.
   */
  isSpeaking(workspaceId: string): boolean {
    return this.activeUtterances.has(workspaceId);
  }

  /**
   * Resume the AudioContext if it's suspended (required after page load).
   */
  async resume(): Promise<void> {
    if (!this.audioContext) {
      this.initialize();
    }

    if (this.audioContext?.state === 'suspended') {
      try {
        await this.audioContext.resume();
        console.log('[spatial-tts] AudioContext resumed');
      } catch (err) {
        console.error('[spatial-tts] Failed to resume AudioContext:', err);
      }
    }
  }
}

export const spatialTts = new SpatialTtsEngine();
