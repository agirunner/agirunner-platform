import { describe, it, expect } from 'vitest';
import { ContextualLink, detectLinkType } from './contextual-link.js';

describe('detectLinkType', () => {
  it('detects file paths', () => expect(detectLinkType('src/auth/password.ts')).toBe('file'));
  it('detects memory keys', () => expect(detectLinkType('memory:auth_approach')).toBe('memory'));
  it('detects artifact refs', () => expect(detectLinkType('artifact:design-doc.md')).toBe('artifact'));
  it('returns unknown for plain text', () => expect(detectLinkType('hello world')).toBe('unknown'));
});

describe('ContextualLink', () => {
  it('exports ContextualLink', () => expect(typeof ContextualLink).toBe('function'));
});
