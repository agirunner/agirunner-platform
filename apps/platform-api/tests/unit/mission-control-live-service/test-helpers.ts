import { vi } from 'vitest';

export function createSequencedPool(responses: Array<{ rows: unknown[]; rowCount: number }>) {
  return {
    query: vi.fn(async () => responses.shift() ?? { rows: [], rowCount: 0 }),
  };
}
