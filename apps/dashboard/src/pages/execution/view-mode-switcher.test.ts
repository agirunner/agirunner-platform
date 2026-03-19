import { describe, it, expect } from 'vitest';
import { ViewModeSwitcher } from './view-mode-switcher';

describe('ViewModeSwitcher', () => {
  it('exports ViewModeSwitcher as a function', () => {
    expect(typeof ViewModeSwitcher).toBe('function');
  });
});
