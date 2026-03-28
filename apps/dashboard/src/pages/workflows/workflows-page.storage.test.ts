import { describe, expect, it } from 'vitest';

import {
  readStoredWorkflowRailWidth,
  readStoredWorkflowWorkbenchFraction,
  writeStoredWorkflowRailWidth,
  writeStoredWorkflowWorkbenchFraction,
} from './workflows-page.storage.js';

describe('workflows page storage', () => {
  const storage = createStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  it('persists and restores the rail width preference', () => {
    storage.clear();

    writeStoredWorkflowRailWidth(412);
    expect(readStoredWorkflowRailWidth()).toBe(412);

    writeStoredWorkflowRailWidth(null);
    expect(readStoredWorkflowRailWidth()).toBeNull();
  });

  it('persists and restores the board/workbench split preference', () => {
    storage.clear();

    writeStoredWorkflowWorkbenchFraction(0.58);
    expect(readStoredWorkflowWorkbenchFraction()).toBe(0.58);

    writeStoredWorkflowWorkbenchFraction(null);
    expect(readStoredWorkflowWorkbenchFraction()).toBeNull();
  });
});

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}
