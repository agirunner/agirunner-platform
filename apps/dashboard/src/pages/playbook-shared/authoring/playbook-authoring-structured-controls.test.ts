import { describe, expect, it } from 'vitest';

import {
  resolveSelectWithCustomMode,
  resolveSelectWithCustomSelection,
  resolveSelectWithCustomValue,
} from './playbook-authoring-structured-controls.js';

describe('playbook authoring structured controls', () => {
  it('keeps custom mode active when switching from a preset option to a custom value', () => {
    expect(
      resolveSelectWithCustomSelection({
        currentValue: '30m',
        optionValues: ['15m', '30m', '45m'],
        nextSelection: '__custom__',
      }),
    ).toEqual({
      nextValue: '',
      isCustomMode: true,
    });
  });

  it('derives custom mode from persisted non-preset values', () => {
    expect(
      resolveSelectWithCustomMode({
        currentValue: '52m',
        optionValues: ['15m', '30m', '45m'],
      }),
    ).toBe(true);
    expect(
      resolveSelectWithCustomMode({
        currentValue: '30m',
        optionValues: ['15m', '30m', '45m'],
      }),
    ).toBe(false);
  });

  it('renders custom mode as the selected option until the user chooses a preset or unset', () => {
    expect(
      resolveSelectWithCustomValue({
        currentValue: '',
        isKnownValue: false,
        isCustomMode: true,
      }),
    ).toBe('__custom__');
    expect(
      resolveSelectWithCustomValue({
        currentValue: '',
        isKnownValue: false,
        isCustomMode: false,
      }),
    ).toBe('__unset__');
  });
});
