import { describe, it, expect } from 'vitest';
import { ViewModeSwitcher } from './view-mode-switcher.js';
import type { ViewMode } from './execution-canvas-support.js';

describe('ViewModeSwitcher', () => {
  it('exports ViewModeSwitcher as a function', () => {
    expect(typeof ViewModeSwitcher).toBe('function');
  });

  it('ViewMode includes war-room', () => {
    const mode: ViewMode = 'war-room';
    expect(mode).toBe('war-room');
  });

  it('ViewMode includes dashboard-grid', () => {
    const mode: ViewMode = 'dashboard-grid';
    expect(mode).toBe('dashboard-grid');
  });

  it('ViewMode includes timeline-lanes', () => {
    const mode: ViewMode = 'timeline-lanes';
    expect(mode).toBe('timeline-lanes');
  });
});
