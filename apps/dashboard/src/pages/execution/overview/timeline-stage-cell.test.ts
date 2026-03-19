import { describe, it, expect } from 'vitest';
import { getStageCellStyles, TimelineStageCell } from './timeline-stage-cell';

describe('getStageCellStyles', () => {
  it('returns green tint for completed', () => {
    const styles = getStageCellStyles('completed');
    expect(styles.background).toContain('34,197,94');
  });

  it('returns accent border for active', () => {
    const styles = getStageCellStyles('active');
    expect(styles.border).toContain('accent-primary');
  });

  it('returns warning border for waiting', () => {
    const styles = getStageCellStyles('waiting');
    expect(styles.border).toContain('status-warning');
  });

  it('returns error border for failed', () => {
    const styles = getStageCellStyles('failed');
    expect(styles.border).toContain('status-error');
  });

  it('returns default border for pending', () => {
    const styles = getStageCellStyles('pending');
    expect(styles.border).toContain('border-default');
  });
});

describe('TimelineStageCell', () => {
  it('exports TimelineStageCell', () => expect(typeof TimelineStageCell).toBe('function'));
});
