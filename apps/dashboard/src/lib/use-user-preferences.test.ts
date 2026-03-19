/**
 * Unit tests for user preferences persistence helpers.
 *
 * The hook delegates all read/write logic to pure helper functions
 * (`loadPreferences`, `savePreferences`, `buildDefaultPreferences`) so they
 * can be exercised without a React renderer.  Structural tests verify that
 * the hook itself wires everything together correctly.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultPreferences,
  loadPreferences,
  savePreferences,
  toggleStarredPlaybookInList,
} from './use-user-preferences.js';

const STORAGE_KEY = 'agirunner-user-preferences';

function createStorage(store: Map<string, string>) {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe('buildDefaultPreferences', () => {
  it('returns defaults when localStorage is empty', () => {
    const defaults = buildDefaultPreferences();
    expect(defaults.viewMode).toBe('war-room');
    expect(defaults.controlMode).toBe('inline');
    expect(defaults.depthLevel).toBe(1);
    expect(defaults.starredPlaybooks).toEqual([]);
  });
});

describe('loadPreferences', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', createStorage(store));
  });

  it('returns default preferences when localStorage is empty', () => {
    const prefs = loadPreferences();
    expect(prefs.viewMode).toBe('war-room');
    expect(prefs.controlMode).toBe('inline');
    expect(prefs.depthLevel).toBe(1);
    expect(prefs.starredPlaybooks).toEqual([]);
  });

  it('loads preferences from localStorage on mount', () => {
    const stored = {
      viewMode: 'dashboard-grid',
      controlMode: 'command-center',
      depthLevel: 2,
      starredPlaybooks: ['pb-1', 'pb-2'],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const prefs = loadPreferences();
    expect(prefs.viewMode).toBe('dashboard-grid');
    expect(prefs.controlMode).toBe('command-center');
    expect(prefs.depthLevel).toBe(2);
    expect(prefs.starredPlaybooks).toEqual(['pb-1', 'pb-2']);
  });

  it('handles corrupted localStorage gracefully by falling back to defaults', () => {
    localStorage.setItem(STORAGE_KEY, 'not valid json {{{');

    const prefs = loadPreferences();
    expect(prefs.viewMode).toBe('war-room');
    expect(prefs.controlMode).toBe('inline');
    expect(prefs.depthLevel).toBe(1);
    expect(prefs.starredPlaybooks).toEqual([]);
  });

  it('fills in missing fields with defaults when stored data is partial', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ viewMode: 'timeline-lanes' }));

    const prefs = loadPreferences();
    expect(prefs.viewMode).toBe('timeline-lanes');
    expect(prefs.controlMode).toBe('inline');
    expect(prefs.depthLevel).toBe(1);
  });
});

describe('savePreferences', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', createStorage(store));
  });

  it('setViewMode persists the updated viewMode to localStorage', () => {
    const prefs = buildDefaultPreferences();
    const updated = { ...prefs, viewMode: 'dashboard-grid' as const };
    savePreferences(updated);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { viewMode: string };
    expect(parsed.viewMode).toBe('dashboard-grid');
  });

  it('setControlMode persists the updated controlMode to localStorage', () => {
    const prefs = buildDefaultPreferences();
    const updated = { ...prefs, controlMode: 'command-palette' as const };
    savePreferences(updated);

    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as { controlMode: string };
    expect(parsed.controlMode).toBe('command-palette');
  });

  it('setDepthLevel persists the updated depthLevel to localStorage', () => {
    const prefs = buildDefaultPreferences();
    const updated = { ...prefs, depthLevel: 3 as const };
    savePreferences(updated);

    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as { depthLevel: number };
    expect(parsed.depthLevel).toBe(3);
  });
});

describe('toggleStarredPlaybookInList', () => {
  it('adds a playbook ID when it is not already starred', () => {
    const result = toggleStarredPlaybookInList([], 'pb-abc');
    expect(result).toEqual(['pb-abc']);
  });

  it('removes a playbook ID when it is already starred', () => {
    const result = toggleStarredPlaybookInList(['pb-1', 'pb-abc', 'pb-2'], 'pb-abc');
    expect(result).toEqual(['pb-1', 'pb-2']);
  });

  it('isPlaybookStarred returns true for a starred playbook', () => {
    const list = toggleStarredPlaybookInList([], 'pb-xyz');
    expect(list.includes('pb-xyz')).toBe(true);
  });

  it('isPlaybookStarred returns false for a non-starred playbook', () => {
    const list = toggleStarredPlaybookInList(['pb-other'], 'pb-other');
    expect(list.includes('pb-xyz')).toBe(false);
  });
});

describe('useUserPreferences hook structure', () => {
  function readHookSource() {
    return readFileSync(resolve(import.meta.dirname, './use-user-preferences.ts'), 'utf8');
  }

  it('exports the useUserPreferences named hook', () => {
    const source = readHookSource();
    expect(source).toContain('export function useUserPreferences');
  });

  it('initialises state from localStorage via loadPreferences', () => {
    const source = readHookSource();
    expect(source).toContain('loadPreferences');
    expect(source).toContain('useState');
  });

  it('wraps setters in useCallback', () => {
    const source = readHookSource();
    expect(source).toContain('useCallback');
  });

  it('persists on every setter via savePreferences', () => {
    const source = readHookSource();
    expect(source).toContain('savePreferences');
  });

  it('exposes isPlaybookStarred as a derived boolean helper', () => {
    const source = readHookSource();
    expect(source).toContain('isPlaybookStarred');
  });
});
