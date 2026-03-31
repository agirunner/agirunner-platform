import { describe, expect, it } from 'vitest';

import { assertValidWorkerTransition } from '../../../src/orchestration/worker-state-machine.js';

describe('worker state machine', () => {
  it('allows online -> busy transition', () => {
    expect(() => assertValidWorkerTransition('w1', 'online', 'busy')).not.toThrow();
  });

  it('rejects offline -> busy transition', () => {
    expect(() => assertValidWorkerTransition('w1', 'offline', 'busy')).toThrow(/Invalid worker transition/);
  });

  it('allows online -> disconnected transition', () => {
    expect(() => assertValidWorkerTransition('w1', 'online', 'disconnected')).not.toThrow();
  });

  it('allows busy -> disconnected transition', () => {
    expect(() => assertValidWorkerTransition('w1', 'busy', 'disconnected')).not.toThrow();
  });

  it('allows disconnected -> online transition (worker reconnects)', () => {
    expect(() => assertValidWorkerTransition('w1', 'disconnected', 'online')).not.toThrow();
  });

  it('allows disconnected -> offline transition (grace period expired)', () => {
    expect(() => assertValidWorkerTransition('w1', 'disconnected', 'offline')).not.toThrow();
  });

  it('rejects disconnected -> busy transition', () => {
    expect(() => assertValidWorkerTransition('w1', 'disconnected', 'busy')).toThrow(/Invalid worker transition/);
  });
});
