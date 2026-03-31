import { describe, expect, it } from 'vitest';
import { TaskWriteService, buildTaskWriteService } from './task-write-service-test-support.js';

describe('task-write-service test support', () => {
  it('loads the task write service harness', () => {
    expect(TaskWriteService).toBeTypeOf('function');
    expect(buildTaskWriteService).toBeTypeOf('function');
  });
});

export * from './task-write-service-test-support.js';
