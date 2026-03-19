import { describe, it, expect } from 'vitest';
import { AgentTimelineEntry, getRoleInitial } from './agent-timeline-entry.js';

describe('getRoleInitial', () => {
  it('returns D for developer', () => expect(getRoleInitial('developer')).toBe('D'));
  it('returns R for reviewer', () => expect(getRoleInitial('reviewer')).toBe('R'));
  it('returns P for product-manager', () => expect(getRoleInitial('product-manager')).toBe('P'));
  it('returns ? for empty string', () => expect(getRoleInitial('')).toBe('?'));
});

describe('AgentTimelineEntry', () => {
  it('exports AgentTimelineEntry', () => expect(typeof AgentTimelineEntry).toBe('function'));
});
