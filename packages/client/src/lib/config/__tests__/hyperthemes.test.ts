import { describe, test, expect } from 'vitest';
import { HYPERTHEMES, findHypertheme, getDefaultHypertheme } from '../hyperthemes';
import type { HyperthemeConfig } from '../hyperthemes';

describe('HYPERTHEMES', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(HYPERTHEMES)).toBe(true);
    expect(HYPERTHEMES.length).toBeGreaterThan(0);
  });

  test('all entries have required properties', () => {
    for (const ht of HYPERTHEMES) {
      expect(ht.id).toBeTruthy();
      expect(ht.label).toBeTruthy();
      expect(ht.description).toBeTruthy();
      expect(ht.icon).toBeTruthy();
      expect(ht.cssVars).toBeDefined();
      expect(typeof ht.cssVars).toBe('object');
      expect(ht.suggestedMonoFont).toBeTruthy();
      expect(ht.suggestedSansFont).toBeTruthy();
    }
  });

  test('all ids are unique', () => {
    const ids = HYPERTHEMES.map((ht) => ht.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('tech is the first entry', () => {
    expect(HYPERTHEMES[0].id).toBe('tech');
  });

  test('tech has no colorOverrides', () => {
    const tech = HYPERTHEMES.find((ht) => ht.id === 'tech');
    expect(tech).toBeDefined();
    expect(tech!.colorOverrides).toBeUndefined();
  });

  test('non-tech themes have colorOverrides', () => {
    const nonTech = HYPERTHEMES.filter((ht) => ht.id !== 'tech');
    for (const ht of nonTech) {
      expect(ht.colorOverrides).toBeDefined();
      expect(Object.keys(ht.colorOverrides!).length).toBeGreaterThan(0);
    }
  });

  test('contains known theme ids', () => {
    const ids = HYPERTHEMES.map((ht) => ht.id);
    expect(ids).toContain('tech');
    expect(ids).toContain('arcane');
    expect(ids).toContain('ethereal');
    expect(ids).toContain('study');
    expect(ids).toContain('astral');
    expect(ids).toContain('astral-midnight');
    expect(ids).toContain('goth');
  });

  test('all cssVars keys start with --ht-', () => {
    for (const ht of HYPERTHEMES) {
      for (const key of Object.keys(ht.cssVars)) {
        expect(key.startsWith('--ht-')).toBe(true);
      }
    }
  });

  test('all themes share the same set of cssVars keys', () => {
    const firstKeys = Object.keys(HYPERTHEMES[0].cssVars).sort();
    for (const ht of HYPERTHEMES.slice(1)) {
      const keys = Object.keys(ht.cssVars).sort();
      expect(keys).toEqual(firstKeys);
    }
  });

  test('colorOverrides keys start with -- (CSS custom property)', () => {
    for (const ht of HYPERTHEMES) {
      if (ht.colorOverrides) {
        for (const key of Object.keys(ht.colorOverrides)) {
          expect(key.startsWith('--')).toBe(true);
        }
      }
    }
  });
});

describe('findHypertheme', () => {
  test('finds tech theme', () => {
    const theme = findHypertheme('tech');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('tech');
    expect(theme!.label).toBe('Tech');
  });

  test('finds arcane theme', () => {
    const theme = findHypertheme('arcane');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('arcane');
  });

  test('finds ethereal theme', () => {
    const theme = findHypertheme('ethereal');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('ethereal');
  });

  test('finds study theme', () => {
    const theme = findHypertheme('study');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('study');
  });

  test('finds astral theme', () => {
    const theme = findHypertheme('astral');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('astral');
  });

  test('finds astral-midnight theme', () => {
    const theme = findHypertheme('astral-midnight');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('astral-midnight');
  });

  test('finds goth theme', () => {
    const theme = findHypertheme('goth');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('goth');
  });

  test('returns undefined for non-existent id', () => {
    expect(findHypertheme('nonexistent')).toBeUndefined();
  });

  test('returns undefined for empty string', () => {
    expect(findHypertheme('')).toBeUndefined();
  });
});

describe('getDefaultHypertheme', () => {
  test('returns the tech theme', () => {
    const defaultTheme = getDefaultHypertheme();
    expect(defaultTheme.id).toBe('tech');
    expect(defaultTheme.label).toBe('Tech');
  });

  test('returns a complete HyperthemeConfig', () => {
    const defaultTheme = getDefaultHypertheme();
    expect(defaultTheme.id).toBeTruthy();
    expect(defaultTheme.label).toBeTruthy();
    expect(defaultTheme.description).toBeTruthy();
    expect(defaultTheme.icon).toBeTruthy();
    expect(defaultTheme.cssVars).toBeDefined();
    expect(defaultTheme.suggestedMonoFont).toBeTruthy();
    expect(defaultTheme.suggestedSansFont).toBeTruthy();
  });

  test('default theme has no colorOverrides', () => {
    const defaultTheme = getDefaultHypertheme();
    expect(defaultTheme.colorOverrides).toBeUndefined();
  });

  test('returns the same object as HYPERTHEMES[0]', () => {
    expect(getDefaultHypertheme()).toBe(HYPERTHEMES[0]);
  });
});
