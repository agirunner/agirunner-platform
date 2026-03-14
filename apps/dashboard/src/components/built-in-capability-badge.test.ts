/**
 * Unit tests for BuiltInCapabilityBadge and classifyTaskCapability.
 *
 * FR-751 — Dashboard communicates capability boundaries.
 * FR-750 — Built-in worker capabilities limited to LLM API.
 */

import { describe, expect, it } from 'vitest';

import { classifyTaskCapability } from './built-in-capability-badge.js';

// ---------------------------------------------------------------------------
// FR-751: capability classification for task detail view
// ---------------------------------------------------------------------------

describe('FR-751 / FR-750: classifyTaskCapability', () => {
  it('returns unknown when no capabilities_required field is present', () => {
    const result = classifyTaskCapability({});
    expect(result).toBe('unknown');
  });

  it('returns unknown when capabilities_required is an empty array', () => {
    const result = classifyTaskCapability({ capabilities_required: [] });
    expect(result).toBe('unknown');
  });

  it('returns can-handle for coding only tasks', () => {
    const result = classifyTaskCapability({ capabilities_required: ['coding'] });
    expect(result).toBe('can-handle');
  });

  it('returns can-handle for coding and testing tasks', () => {
    const result = classifyTaskCapability({ capabilities_required: ['coding', 'testing'] });
    expect(result).toBe('can-handle');
  });

  it('returns can-handle for all built-in generic capabilities', () => {
    const capabilities = ['coding', 'code-review', 'architecture', 'testing', 'security-review', 'documentation', 'requirements', 'research', 'project-management', 'data-analysis'];
    for (const capability of capabilities) {
      const result = classifyTaskCapability({ capabilities_required: [capability] });
      expect(result).toBe('can-handle');
    }
  });

  it('returns cannot-handle when docker-exec is required', () => {
    const result = classifyTaskCapability({ capabilities_required: ['docker-exec'] });
    expect(result).toBe('cannot-handle');
  });

  it('returns cannot-handle when bare-metal-exec is required', () => {
    const result = classifyTaskCapability({ capabilities_required: ['bare-metal-exec'] });
    expect(result).toBe('cannot-handle');
  });

  it('returns cannot-handle when an unknown/custom capability is required', () => {
    // Custom capabilities that are not in the supported set — cannot guarantee handling.
    const result = classifyTaskCapability({ capabilities_required: ['custom-llm-provider'] });
    expect(result).toBe('cannot-handle');
  });

  it('returns cannot-handle when mix includes a prohibited capability', () => {
    // Even if coding is present, docker-exec makes it ineligible.
    const result = classifyTaskCapability({ capabilities_required: ['coding', 'docker-exec'] });
    expect(result).toBe('cannot-handle');
  });

  it('falls back to capabilities field when capabilities_required is absent', () => {
    const result = classifyTaskCapability({ capabilities: ['coding', 'testing'] });
    expect(result).toBe('can-handle');
  });

  it('handles non-string entries in capabilities_required gracefully', () => {
    // Mixed array with non-string entries — only string values are considered.
    const result = classifyTaskCapability({ capabilities_required: [42, null, 'coding'] });
    expect(result).toBe('can-handle');
  });
});
