import { describe, expect, it, vi } from 'vitest';

const { logSafetynetTriggeredMock } = vi.hoisted(() => ({
  logSafetynetTriggeredMock: vi.fn(),
}));

vi.mock('../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: logSafetynetTriggeredMock,
}));

import {
  mergeAssessmentSubjectLinkage,
  SUBJECT_LINKAGE_INFERENCE_SAFETYNET,
} from '../../src/services/assessment-subject-service.js';

describe('mergeAssessmentSubjectLinkage', () => {
  it('does not log a safetynet when only subject revision is defaulted', () => {
    const merged = mergeAssessmentSubjectLinkage(
      {
        subjectTaskId: 'task-delivery-1',
        subjectWorkItemId: null,
        subjectHandoffId: null,
        subjectRevision: 3,
      },
      {
        subjectTaskId: 'task-delivery-1',
        subjectWorkItemId: null,
        subjectHandoffId: null,
        subjectRevision: null,
      },
    );

    expect(merged).toEqual({
      subjectTaskId: 'task-delivery-1',
      subjectWorkItemId: null,
      subjectHandoffId: null,
      subjectRevision: 3,
    });
    expect(logSafetynetTriggeredMock).not.toHaveBeenCalled();
  });

  it('logs a safetynet when subject identity is inferred from fallback context', () => {
    const merged = mergeAssessmentSubjectLinkage(
      {
        subjectTaskId: 'task-delivery-1',
        subjectWorkItemId: 'work-item-1',
        subjectHandoffId: 'handoff-1',
        subjectRevision: 3,
      },
      {
        subjectTaskId: null,
        subjectWorkItemId: null,
        subjectHandoffId: null,
        subjectRevision: null,
      },
    );

    expect(merged).toEqual({
      subjectTaskId: 'task-delivery-1',
      subjectWorkItemId: 'work-item-1',
      subjectHandoffId: 'handoff-1',
      subjectRevision: 3,
    });
    expect(logSafetynetTriggeredMock).toHaveBeenCalledWith(
      SUBJECT_LINKAGE_INFERENCE_SAFETYNET,
      'assessment subject linkage inferred from fallback context',
    );
  });
});
