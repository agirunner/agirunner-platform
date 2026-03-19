import { describe, it, expect, vi } from 'vitest';
import { fuzzyMatch, buildActionRegistry } from './command-palette-support.js';

describe('fuzzyMatch', () => {
  it('matches substring', () => {
    expect(fuzzyMatch('auth', 'Auth Redesign').matches).toBe(true);
  });

  it('is case insensitive', () => {
    expect(fuzzyMatch('AUTH', 'auth redesign').matches).toBe(true);
  });

  it('rejects non-matching', () => {
    expect(fuzzyMatch('xyz', 'auth redesign').matches).toBe(false);
  });

  it('scores exact match higher than partial', () => {
    const exact = fuzzyMatch('auth', 'auth');
    const partial = fuzzyMatch('auth', 'authentication');
    expect(exact.score).toBeGreaterThan(partial.score);
  });

  it('returns score 0 for non-matching', () => {
    expect(fuzzyMatch('xyz', 'auth redesign').score).toBe(0);
  });

  it('returns positive score for matching', () => {
    expect(fuzzyMatch('auth', 'Auth Redesign').score).toBeGreaterThan(0);
  });

  it('handles empty query', () => {
    const result = fuzzyMatch('', 'Auth Redesign');
    expect(result.matches).toBe(true);
  });
});

describe('buildActionRegistry', () => {
  it('includes navigate actions for each workflow', () => {
    const actions = buildActionRegistry(
      [{ id: '1', name: 'Auth', state: 'active' }, { id: '2', name: 'API', state: 'active' }],
      () => {},
      () => {},
      () => {},
    );
    const navigateActions = actions.filter(a => a.category === 'navigate');
    expect(navigateActions).toHaveLength(2);
  });

  it('includes create action', () => {
    const actions = buildActionRegistry([], () => {}, () => {}, () => {});
    expect(actions.some(a => a.category === 'create')).toBe(true);
  });

  it('includes mutate actions for active workflows', () => {
    const actions = buildActionRegistry(
      [{ id: '1', name: 'Auth', state: 'active' }],
      () => {},
      () => {},
      () => {},
    );
    const mutateActions = actions.filter(a => a.category === 'mutate');
    expect(mutateActions.length).toBeGreaterThan(0);
  });

  it('includes mutate actions for gate-waiting workflows', () => {
    const actions = buildActionRegistry(
      [{ id: '1', name: 'Auth', state: 'active', gateWaiting: true }],
      () => {},
      () => {},
      () => {},
    );
    const mutateActions = actions.filter(a => a.category === 'mutate');
    expect(mutateActions.length).toBeGreaterThan(0);
  });

  it('assigns workflowName to workflow actions', () => {
    const actions = buildActionRegistry(
      [{ id: '1', name: 'My Workflow', state: 'active' }],
      () => {},
      () => {},
      () => {},
    );
    const workflowActions = actions.filter(a => a.workflowName === 'My Workflow');
    expect(workflowActions.length).toBeGreaterThan(0);
  });

  it('calls onNavigate when navigate action fires', () => {
    const onNavigate = vi.fn();
    const actions = buildActionRegistry(
      [{ id: 'wf-1', name: 'Auth', state: 'active' }],
      onNavigate,
      () => {},
      () => {},
    );
    const navigate = actions.find(a => a.category === 'navigate');
    navigate?.action();
    expect(onNavigate).toHaveBeenCalledWith('wf-1');
  });

  it('calls onCreate when create action fires', () => {
    const onCreate = vi.fn();
    const actions = buildActionRegistry([], () => {}, () => {}, onCreate);
    const create = actions.find(a => a.category === 'create');
    create?.action();
    expect(onCreate).toHaveBeenCalled();
  });
});
