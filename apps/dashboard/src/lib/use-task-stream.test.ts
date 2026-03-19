/**
 * Unit tests for task stream SSE hook helpers.
 *
 * Tests cover pure functions only — no React testing library available.
 * Hook lifecycle is validated through exported helpers.
 */
import { describe, expect, it } from 'vitest';

import { appendWithCap, parseStreamEvent } from './use-task-stream.js';

describe('parseStreamEvent', () => {
  it('parses a token event correctly', () => {
    const result = parseStreamEvent('token', '{"text":"Hello"}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('token');
    expect(result?.data).toEqual({ text: 'Hello' });
  });

  it('parses a tool_call event correctly', () => {
    const result = parseStreamEvent('tool_call', '{"name":"shell_exec","input":{"cmd":"ls"}}');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('tool_call');
    expect(result?.data).toEqual({ name: 'shell_exec', input: { cmd: 'ls' } });
  });

  it('returns null for invalid JSON', () => {
    const result = parseStreamEvent('token', '{not valid json}');
    expect(result).toBeNull();
  });

  it('extracts agentId from data field', () => {
    const result = parseStreamEvent('token', '{"text":"hi","agentId":"agent-42"}');
    expect(result?.agentId).toBe('agent-42');
  });

  it('extracts role from data field', () => {
    const result = parseStreamEvent('thinking', '{"content":"reasoning...","role":"assistant"}');
    expect(result?.role).toBe('assistant');
  });

  it('extracts turn from data field', () => {
    const result = parseStreamEvent('turn_end', '{"turn":3}');
    expect(result?.turn).toBe(3);
  });

  it('sets agentId, role, turn to undefined when absent from data', () => {
    const result = parseStreamEvent('task_end', '{"reason":"complete"}');
    expect(result?.agentId).toBeUndefined();
    expect(result?.role).toBeUndefined();
    expect(result?.turn).toBeUndefined();
  });
});

describe('appendWithCap', () => {
  const makeEvent = (index: number) =>
    parseStreamEvent('token', `{"text":"token-${index}"}`)!;

  it('adds an event to an empty array', () => {
    const result = appendWithCap([], makeEvent(1), 500);
    expect(result).toHaveLength(1);
    expect(result[0].data).toEqual({ text: 'token-1' });
  });

  it('appends without dropping when below capacity', () => {
    const existing = [makeEvent(1), makeEvent(2)];
    const result = appendWithCap(existing, makeEvent(3), 500);
    expect(result).toHaveLength(3);
  });

  it('drops the oldest event when at capacity', () => {
    const existing = [makeEvent(1), makeEvent(2), makeEvent(3)];
    const result = appendWithCap(existing, makeEvent(4), 3);
    expect(result).toHaveLength(3);
    expect(result[0].data).toEqual({ text: 'token-2' });
    expect(result[2].data).toEqual({ text: 'token-4' });
  });

  it('respects a custom maxSize parameter', () => {
    const existing = [makeEvent(1), makeEvent(2)];
    const result = appendWithCap(existing, makeEvent(3), 2);
    expect(result).toHaveLength(2);
    expect(result[0].data).toEqual({ text: 'token-2' });
    expect(result[1].data).toEqual({ text: 'token-3' });
  });
});
