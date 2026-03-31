import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
import {
  dashboardApi,
  type DashboardDeleteImpactSummary,
  type DashboardPlaybookDeleteImpact,
  type DashboardPlaybookRecord,
} from '../../lib/api.js';
import { useUnsavedChanges } from '../../lib/use-unsaved-changes.js';
import {
  buildPlaybookDefinition,
  hydratePlaybookAuthoringDraft,
  reconcileValidationIssues,
  type PlaybookAuthoringDraft,
} from '../playbooks/authoring/playbook-authoring-support.js';
import {
  buildPlaybookRevisionChain,
  buildPlaybookRevisionDiff,
} from './playbook-detail-support.js';

export type PlaybookLifecycle = 'planned' | 'ongoing';

export const DEFAULT_LIFECYCLE: PlaybookLifecycle = 'ongoing';

export const lifecycleOptions = [
  {
    value: 'ongoing',
    label: 'Ongoing',
    description:
      'Keeps one standing workflow open so new work can continue flowing into it over time.',
  },
  {
    value: 'planned',
    label: 'Planned',
    description:
      'Launches a bounded workflow with a clear start, finish, and stage progression.',
  },
] as const;

interface PlaybookBasicsValidation {
  fieldErrors: {
    name?: string;
    outcome?: string;
  };
  isValid: boolean;
}

export function usePlaybookDetailPageController() {
  const params = useParams<{ id: string }>();
  const playbookId = params.id ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [outcome, setOutcome] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [lifecycle, setLifecycle] = useState<PlaybookLifecycle>(DEFAULT_LIFECYCLE);
  const [draft, setDraft] = useState<PlaybookAuthoringDraft>(() =>
    hydratePlaybookAuthoringDraft(DEFAULT_LIFECYCLE, {}),
  );
  const [authoringValidationIssues, setAuthoringValidationIssues] = useState<string[]>([]);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadedPlaybookId, setLoadedPlaybookId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [comparedRevisionId, setComparedRevisionId] = useState('');

  const playbookQuery = useQuery({
    queryKey: ['playbook', playbookId],
    queryFn: () => dashboardApi.getPlaybook(playbookId),
    enabled: playbookId.length > 0,
  });
  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });
  const playbookDeleteImpactQuery = useQuery({
    queryKey: ['playbook-delete-impact', playbookId],
    queryFn: () => dashboardApi.getPlaybookDeleteImpact(playbookId),
    enabled: playbookId.length > 0 && (deleteOpen || permanentDeleteOpen),
  });

  useUnsavedChanges(isDirty);

  function loadPlaybook(playbook: DashboardPlaybookRecord): void {
    const nextLifecycle = playbook.lifecycle ?? DEFAULT_LIFECYCLE;
    setName(playbook.name);
    setSlug(playbook.slug);
    setOutcome(playbook.outcome);
    setIsActive(playbook.is_active !== false);
    setLifecycle(nextLifecycle);
    setDraft(hydratePlaybookAuthoringDraft(nextLifecycle, playbook.definition));
    setAuthoringValidationIssues([]);
    setLoadedPlaybookId(playbook.id);
    setIsDirty(false);
    setHasAttemptedSave(false);
  }

  useEffect(() => {
    const playbook = playbookQuery.data;
    if (!playbook || loadedPlaybookId === playbook.id) {
      return;
    }
    loadPlaybook(playbook);
    setDefinitionError(null);
    setMessage(null);
  }, [loadedPlaybookId, playbookQuery.data]);

  const revisions = useMemo(() => {
    const playbook = playbookQuery.data;
    const allPlaybooks = playbooksQuery.data?.data ?? [];
    if (!playbook) {
      return [];
    }
    return buildPlaybookRevisionChain(allPlaybooks, playbook);
  }, [playbookQuery.data, playbooksQuery.data?.data]);

  useEffect(() => {
    if (revisions.length === 0) {
      return;
    }
    const fallbackRevisionId =
      revisions.find((revision) => revision.id !== playbookId)?.id ?? revisions[0]?.id ?? '';
    setComparedRevisionId((current) =>
      current && revisions.some((revision) => revision.id === current)
        ? current
        : fallbackRevisionId,
    );
  }, [playbookId, revisions]);

  const comparedRevision = useMemo(
    () => revisions.find((revision) => revision.id === comparedRevisionId) ?? null,
    [comparedRevisionId, revisions],
  );

  const revisionDiff = useMemo(() => {
    const playbook = playbookQuery.data;
    if (!playbook || !comparedRevision) {
      return [];
    }
    return buildPlaybookRevisionDiff(playbook, comparedRevision);
  }, [comparedRevision, playbookQuery.data]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const authoringIssue = authoringValidationIssues[0];
      if (authoringIssue) {
        throw new Error(authoringIssue);
      }
      const definition = buildPlaybookDefinition(lifecycle, draft);
      if (definition.ok === false) {
        throw new Error(definition.error);
      }
      const savedPlaybook = await dashboardApi.updatePlaybook(playbookId, {
        name: name.trim(),
        slug: slug.trim() || undefined,
        outcome: outcome.trim(),
        lifecycle,
        definition: definition.value,
      });
      if (!isActive) {
        return dashboardApi.archivePlaybook(savedPlaybook.id);
      }
      return savedPlaybook;
    },
    onSuccess: (playbook) => {
      loadPlaybook(playbook);
      setDefinitionError(null);
      setMessage(`Playbook saved as v${playbook.version}.`);
      void playbooksQuery.refetch();
      void navigate(`/design/playbooks/${playbook.id}`, { replace: true });
    },
    onError: (error) => {
      setMessage(null);
      setDefinitionError(error instanceof Error ? error.message : 'Failed to save playbook.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => dashboardApi.deletePlaybook(playbookId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      await navigate('/design/playbooks');
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: () => dashboardApi.deletePlaybookPermanently(playbookId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      await navigate('/design/playbooks');
    },
  });

  const basicValidation = useMemo(
    () => validatePlaybookBasicsDraft({ name, outcome }),
    [name, outcome],
  );
  const canSave = useMemo(
    () => Boolean(playbookId) && !updateMutation.isPending,
    [playbookId, updateMutation.isPending],
  );
  const isSaveValid = basicValidation.isValid && authoringValidationIssues.length === 0;
  const saveFormFeedbackMessage = resolveFormFeedbackMessage({
    serverError: definitionError,
    showValidation: hasAttemptedSave,
    isValid: isSaveValid,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  const playbook = playbookQuery.data ?? null;
  const deleteImpact = playbookDeleteImpactQuery.data ?? null;
  const revisionDeleteBlocked = isPlaybookRevisionDeleteBlocked(deleteImpact);
  const revisionImpact = deleteImpact?.revision ?? null;
  const familyImpact = deleteImpact?.family ?? null;

  function handleSave(): void {
    if (!isSaveValid) {
      setHasAttemptedSave(true);
      return;
    }
    updateMutation.mutate();
  }

  function handleNameChange(nextValue: string): void {
    setName(nextValue);
    setIsDirty(true);
  }

  function handleSlugChange(nextValue: string): void {
    setSlug(nextValue);
    setIsDirty(true);
  }

  function handleOutcomeChange(nextValue: string): void {
    setOutcome(nextValue);
    setIsDirty(true);
  }

  function handleLifecycleChange(nextValue: PlaybookLifecycle): void {
    setLifecycle(nextValue);
    setIsDirty(true);
  }

  function handleActiveChange(nextValue: boolean): void {
    setIsActive(nextValue);
    setIsDirty(true);
  }

  function handleDraftChange(nextDraft: PlaybookAuthoringDraft): void {
    setDraft(nextDraft);
    setIsDirty(true);
  }

  function handleClearMessages(): void {
    setDefinitionError(null);
    setMessage(null);
  }

  function handleAuthoringValidationChange(nextIssues: string[]): void {
    setAuthoringValidationIssues((currentIssues) =>
      reconcileValidationIssues(currentIssues, nextIssues),
    );
  }

  function openDeleteDialog(): void {
    deleteMutation.reset();
    setDeleteOpen(true);
  }

  function openPermanentDeleteDialog(): void {
    permanentDeleteMutation.reset();
    setPermanentDeleteOpen(true);
  }

  return {
    basicValidation,
    canSave,
    comparedRevisionId,
    dangerOpen,
    deleteImpact,
    deleteMutation,
    deleteOpen,
    draft,
    familyImpact,
    handleActiveChange,
    handleAuthoringValidationChange,
    handleClearMessages,
    handleDraftChange,
    handleLifecycleChange,
    handleNameChange,
    handleOutcomeChange,
    handleSave,
    handleSlugChange,
    hasAttemptedSave,
    isActive,
    lifecycle,
    message,
    name,
    openDeleteDialog,
    openPermanentDeleteDialog,
    outcome,
    permanentDeleteMutation,
    permanentDeleteOpen,
    playbook,
    playbookDeleteImpactQuery,
    playbookQuery,
    playbookId,
    revisionDeleteBlocked,
    revisionDiff,
    revisionImpact,
    revisions,
    saveFormFeedbackMessage,
    setComparedRevisionId,
    setDangerOpen,
    setDeleteOpen,
    setPermanentDeleteOpen,
    slug,
    updateMutation,
  };
}

export function describePlaybookLifecycle(lifecycle: PlaybookLifecycle): string {
  return lifecycle === 'planned' ? 'Planned' : 'Ongoing';
}

export function formatPlaybookDeleteError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error ?? '')).trim();
  const normalized = message.replace(/^HTTP\s+\d+:\s*/i, '').trim();
  return normalized || 'Failed to delete playbook.';
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'unknown time';
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function isPlaybookRevisionDeleteBlocked(impact: DashboardPlaybookDeleteImpact | null): boolean {
  return (impact?.revision.workflows ?? 0) > 0;
}

function validatePlaybookBasicsDraft(input: {
  name: string;
  outcome: string;
}): PlaybookBasicsValidation {
  const fieldErrors: PlaybookBasicsValidation['fieldErrors'] = {};

  if (!input.name.trim()) {
    fieldErrors.name = 'Enter a playbook name.';
  }

  if (!input.outcome.trim()) {
    fieldErrors.outcome = 'Describe the workflow outcome this playbook owns.';
  }

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
  };
}

export type PlaybookDeleteImpactSummaryWithRevisions = DashboardDeleteImpactSummary & {
  revisions?: number;
};
