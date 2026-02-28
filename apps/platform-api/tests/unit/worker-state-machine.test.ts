import { describe, expect, it } from 'vitest';

import { assertValidWorkerTransition } from '../../src/orchestration/worker-state-machine.js';

describe('worker state machine', () => {
  it('allows online -> busy transition', () => {
    expect(() => assertValidWorkerTransition('w1', 'online', 'busy')).not.toThrow();
  });

  it('rejects offline -> busy transition', () => {
    expect(() => assertValidWorkerTransition('w1', 'offline', 'busy')).toThrow(/Invalid worker transition/);
  });
});
