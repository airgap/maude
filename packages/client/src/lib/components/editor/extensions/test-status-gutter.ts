/**
 * CM6 gutter extension that shows test pass/fail/skip markers next to test
 * functions. Reads from testResultsStore and renders ✓/✗/○ icons.
 */

import { gutter, GutterMarker, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { StateField, StateEffect, RangeSet, type Range, type Extension } from '@codemirror/state';
import { testResultsStore, type TestGutterMarker } from '$lib/stores/test-results.svelte';
import { fileUriField } from './file-uri-field';
import type { TestStatus } from '@e/shared';

// ── StateEffect to push markers into CM6 ──

const setTestMarkers = StateEffect.define<TestGutterMarker[]>();

// ── GutterMarker subclasses ──

class TestPassMarker extends GutterMarker {
  constructor(
    private testName: string,
    private duration?: number,
  ) {
    super();
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-test-marker cm-test-pass';
    el.textContent = '\u2713';
    el.title = `PASS: ${this.testName}${this.duration != null ? ` (${this.duration}ms)` : ''}`;
    el.setAttribute('aria-label', `Test passed: ${this.testName}`);
    return el;
  }
}

class TestFailMarker extends GutterMarker {
  constructor(
    private testName: string,
    private errorMessage?: string,
  ) {
    super();
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-test-marker cm-test-fail';
    el.textContent = '\u2717';
    el.title = `FAIL: ${this.testName}${this.errorMessage ? `\n${this.errorMessage.slice(0, 200)}` : ''}`;
    el.setAttribute('aria-label', `Test failed: ${this.testName}`);
    return el;
  }
}

class TestSkipMarker extends GutterMarker {
  constructor(private testName: string) {
    super();
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-test-marker cm-test-skip';
    el.textContent = '\u25CB';
    el.title = `SKIP: ${this.testName}`;
    el.setAttribute('aria-label', `Test skipped: ${this.testName}`);
    return el;
  }
}

function markerForStatus(m: TestGutterMarker): GutterMarker {
  switch (m.status) {
    case 'passed':
      return new TestPassMarker(m.testName, m.duration);
    case 'failed':
      return new TestFailMarker(m.testName, m.errorMessage);
    case 'skipped':
    case 'pending':
      return new TestSkipMarker(m.testName);
  }
}

// ── StateField for gutter marker positions ──

const testMarkerField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(markers, tr) {
    // Remap positions when the document changes
    markers = markers.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setTestMarkers)) {
        const newRanges: Range<GutterMarker>[] = [];
        const doc = tr.state.doc;

        for (const m of effect.value) {
          if (m.line >= 1 && m.line <= doc.lines) {
            const lineStart = doc.line(m.line).from;
            newRanges.push(markerForStatus(m).range(lineStart));
          }
        }

        // RangeSet requires sorted ranges
        newRanges.sort((a, b) => a.from - b.from);
        markers = RangeSet.of(newRanges);
      }
    }

    return markers;
  },
});

// ── Gutter column ──

const testGutter = gutter({
  class: 'cm-test-gutter',
  markers: (view) => view.state.field(testMarkerField),
});

// ── ViewPlugin that syncs store → CM6 state ──

const testStoreSync = ViewPlugin.define((view) => {
  let lastVersion = -1;

  function getFilePath(): string {
    const uri = view.state.field(fileUriField, false) ?? '';
    return uri.replace(/^file:\/\//, '');
  }

  function syncMarkers() {
    const currentVersion = testResultsStore.version;
    if (currentVersion === lastVersion) return;
    lastVersion = currentVersion;

    const filePath = getFilePath();
    if (!filePath) return;

    const markers = testResultsStore.getMarkersForFile(filePath);
    view.dispatch({ effects: setTestMarkers.of(markers) });
  }

  // Initial sync
  syncMarkers();

  // Poll every 2s to pick up new test results
  const interval = setInterval(syncMarkers, 2000);

  return {
    update(_update: ViewUpdate) {
      // Also sync when the document changes (file switch)
      syncMarkers();
    },
    destroy() {
      clearInterval(interval);
    },
  };
});

// ── Public extension factory ──

/**
 * Create the test status gutter extension bundle.
 * Always enabled — shows markers only when test results exist for the file.
 */
export function testStatusGutterExtension(): Extension[] {
  return [testMarkerField, testGutter, testStoreSync];
}
