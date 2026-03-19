import { describe, expect, it } from 'vitest';

import {
  canAdvance,
  getStepIndex,
  getStepLabel,
  initialWizardState,
  WIZARD_STEPS,
} from './launch-wizard-support.js';

describe('LaunchWizardSupport', () => {
  it('initialWizardState returns defaults', () => {
    const state = initialWizardState();
    expect(state.playbookId).toBeNull();
    expect(state.workspaceId).toBeNull();
    expect(state.watchLive).toBe(true);
  });

  it('initialWizardState has expected token budget', () => {
    const state = initialWizardState();
    expect(typeof state.tokenBudget).toBe('number');
    expect(state.tokenBudget).toBeGreaterThan(0);
  });

  it('getStepIndex returns correct indices', () => {
    expect(getStepIndex('playbook')).toBe(0);
    expect(getStepIndex('workspace')).toBe(1);
    expect(getStepIndex('parameters')).toBe(2);
    expect(getStepIndex('launch')).toBe(3);
  });

  it('WIZARD_STEPS has 4 steps', () => {
    expect(WIZARD_STEPS).toHaveLength(4);
  });

  it('getStepLabel returns non-empty label for each step', () => {
    for (const step of WIZARD_STEPS) {
      expect(getStepLabel(step).length).toBeGreaterThan(0);
    }
  });

  it('canAdvance requires playbookId for playbook step', () => {
    const state = initialWizardState();
    expect(canAdvance('playbook', state)).toBe(false);
    expect(canAdvance('playbook', { ...state, playbookId: 'abc' })).toBe(true);
  });

  it('canAdvance requires workspaceId for workspace step', () => {
    const state = initialWizardState();
    expect(canAdvance('workspace', state)).toBe(false);
    expect(canAdvance('workspace', { ...state, workspaceId: 'ws-1' })).toBe(true);
  });

  it('canAdvance always allows advance from parameters step', () => {
    const state = initialWizardState();
    expect(canAdvance('parameters', state)).toBe(true);
  });

  it('canAdvance returns false for launch step', () => {
    const state = initialWizardState();
    expect(canAdvance('launch', state)).toBe(false);
  });
});

import { LaunchWizard } from './launch-wizard.js';

describe('LaunchWizard', () => {
  it('exports LaunchWizard', () => expect(typeof LaunchWizard).toBe('function'));
});
