import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-delivery-history.tsx'), 'utf8');
}

describe('project delivery history source', () => {
  it('renders overview packets, responsive run cards, and direct operator actions', () => {
    const source = readSource();

    expect(source).toContain('Delivery overview');
    expect(source).toContain('buildProjectDeliveryOverview(entries)');
    expect(source).toContain('buildProjectDeliveryPacket(entry)');
    expect(source).toContain('Open board');
    expect(source).toContain('Open inspector');
    expect(source).toContain('sm:grid-cols-2 xl:grid-cols-5');
    expect(source).toContain('sm:grid-cols-2 xl:grid-cols-4');
    expect(source).toContain('Judge active run pressure, gate load, and reported spend');
  });
});
