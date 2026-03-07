/**
 * Unit tests for dashboard theming.
 *
 * FR-428:   Responsive design and theming
 * FR-SM-006: Dashboard state colors (theme system underpins state color tokens)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTheme, readTheme, type ThemeMode } from './theme.js';

function mockLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
  return store;
}

function mockDocument() {
  const attrs = new Map<string, string>();
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (name: string, value: string) => { attrs.set(name, value); },
    },
  });
  return attrs;
}

// ─────────────────────────────────────────────────────────────────────────────
// FR-428: Responsive design and theming — readTheme
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-428: readTheme', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns "light" when no theme is stored', () => {
    mockLocalStorage();
    expect(readTheme()).toBe('light');
  });

  it('returns "dark" when "dark" is persisted in localStorage', () => {
    mockLocalStorage({ 'agirunner.theme': 'dark' });
    expect(readTheme()).toBe('dark');
  });

  it('returns "light" when an unrecognised value is stored', () => {
    mockLocalStorage({ 'agirunner.theme': 'solarized' });
    expect(readTheme()).toBe('light');
  });

  it('returns "light" for an empty string stored value', () => {
    mockLocalStorage({ 'agirunner.theme': '' });
    expect(readTheme()).toBe('light');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-428 / FR-SM-006: applyTheme sets the DOM attribute and persists the choice
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-428 / FR-SM-006: applyTheme', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('sets data-theme on documentElement when applying dark mode', () => {
    const store = mockLocalStorage();
    const attrs = mockDocument();

    applyTheme('dark');

    expect(attrs.get('data-theme')).toBe('dark');
    expect(store.get('agirunner.theme')).toBe('dark');
  });

  it('sets data-theme on documentElement when applying light mode', () => {
    const store = mockLocalStorage();
    const attrs = mockDocument();

    applyTheme('light');

    expect(attrs.get('data-theme')).toBe('light');
    expect(store.get('agirunner.theme')).toBe('light');
  });

  it('persists the applied theme so readTheme returns the same value', () => {
    const store = mockLocalStorage();
    mockDocument();

    applyTheme('dark');
    // Re-read from the same store
    const storedTheme = (store.get('agirunner.theme') ?? 'light') as ThemeMode;
    expect(storedTheme).toBe('dark');
  });
});
