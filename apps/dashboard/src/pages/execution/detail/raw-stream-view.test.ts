import { describe, it, expect } from 'vitest';
import { getEventColor, shouldCollapse, countLines, RawStreamView } from './raw-stream-view.js';

describe('getEventColor', () => {
  it('returns accent for thinking', () => expect(getEventColor('thinking')).toBe('var(--color-accent-primary)'));
  it('returns warning for tool_call', () => expect(getEventColor('tool_call')).toBe('var(--color-status-warning)'));
  it('returns success for tool_result', () => expect(getEventColor('tool_result')).toBe('var(--color-status-success)'));
  it('returns text-primary for token', () => expect(getEventColor('token')).toBe('var(--color-text-primary)'));
  it('returns text-muted for unknown', () => expect(getEventColor('unknown')).toBe('var(--color-text-muted)'));
});

describe('shouldCollapse', () => {
  it('collapses tool_result over 50 lines', () => {
    const text = Array(51).fill('line').join('\n');
    expect(shouldCollapse(text, 'tool_result')).toBe(true);
  });
  it('does not collapse tool_result under 50 lines', () => {
    const text = Array(10).fill('line').join('\n');
    expect(shouldCollapse(text, 'tool_result')).toBe(false);
  });
  it('collapses thinking over 20 lines', () => {
    const text = Array(21).fill('line').join('\n');
    expect(shouldCollapse(text, 'thinking')).toBe(true);
  });
  it('does not collapse token type', () => {
    const text = Array(100).fill('line').join('\n');
    expect(shouldCollapse(text, 'token')).toBe(false);
  });
});

describe('countLines', () => {
  it('counts newlines', () => expect(countLines('a\nb\nc')).toBe(3));
  it('returns 1 for no newlines', () => expect(countLines('hello')).toBe(1));
  it('returns 0 for empty string', () => expect(countLines('')).toBe(0));
});

describe('RawStreamView', () => {
  it('exports RawStreamView', () => expect(typeof RawStreamView).toBe('function'));
});
