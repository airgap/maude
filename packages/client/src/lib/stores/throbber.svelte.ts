/**
 * Shared throbber phrase store — rotates status text while streaming.
 *
 * The phrase is managed centrally so both the StreamingMessage (focused)
 * and StatusBar (defocused) can display it without duplicating timers.
 */
import { pickPhrase } from '$lib/config/throbberPhrases';

const PHRASE_INTERVAL_MS = 4000;

let phrase = $state('Thinking…');
let intervalId: ReturnType<typeof setInterval> | null = null;
let currentTheme: string | null = null;

function start(theme: string) {
  stop();
  currentTheme = theme;
  phrase = pickPhrase(theme, undefined);
  intervalId = setInterval(() => {
    phrase = pickPhrase(theme, phrase);
  }, PHRASE_INTERVAL_MS);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  currentTheme = null;
  phrase = 'Thinking…';
}

export const throbberStore = {
  get phrase() {
    return phrase;
  },
  start,
  stop,
};
