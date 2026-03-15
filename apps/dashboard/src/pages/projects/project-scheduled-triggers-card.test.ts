import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-scheduled-triggers-card.tsx'), 'utf8');
}

describe('project scheduled triggers card source', () => {
  it('keeps the schedule surface focused on the live list and editor instead of duplicate posture summaries', () => {
    const source = readSource();
    expect(source).not.toContain('buildScheduledTriggerOverview');
    expect(source).not.toContain('Automation posture is healthy');
    expect(source).not.toContain('Automation attention is needed');
    expect(source).not.toContain('Best next step:');
    expect(source).toContain('Current schedules');
    expect(source).toContain('Add schedule');
    expect(source).toContain("const [isExpanded, setExpanded] = useState(false)");
    expect(source).toContain('Open schedules');
    expect(source).toContain('Hide schedules');
  });
});
