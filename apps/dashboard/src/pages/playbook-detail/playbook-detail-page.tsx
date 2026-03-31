import { FormFeedbackMessage } from '../../components/forms/form-feedback.js';
import { PlaybookAuthoringForm } from '../playbook-shared/authoring/playbook-authoring-form.js';

import {
  PlaybookDeleteDialogs,
  PlaybookDangerZone,
} from './playbook-detail-page.delete-dialogs.js';
import {
  PlaybookDetailBasicsCard,
  PlaybookDetailHero,
} from './playbook-detail-page.basics.js';
import { usePlaybookDetailPageController } from './playbook-detail-page.controller.js';
import { PlaybookRevisionHistoryCard } from './playbook-detail-sections.js';

export function PlaybookDetailPage(): JSX.Element {
  const {
    basicValidation,
    canSave,
    comparedRevisionId,
    dangerOpen,
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
  } = usePlaybookDetailPageController();

  if (playbookQuery.isLoading) {
    return <div className="p-6 text-sm text-muted">Loading playbook...</div>;
  }

  if (playbookQuery.error || !playbook) {
    return (
      <div className="p-6 text-sm text-red-600 dark:text-red-400">
        Failed to load playbook.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PlaybookDetailHero
        canSave={canSave}
        isActive={isActive}
        message={message}
        onSave={handleSave}
        playbook={playbook}
      />

      <FormFeedbackMessage message={saveFormFeedbackMessage} />

      <PlaybookDetailBasicsCard
        basicValidation={basicValidation}
        hasAttemptedSave={hasAttemptedSave}
        isActive={isActive}
        lifecycle={lifecycle}
        name={name}
        onActiveChange={handleActiveChange}
        onLifecycleChange={handleLifecycleChange}
        onNameChange={handleNameChange}
        onOutcomeChange={handleOutcomeChange}
        onSlugChange={handleSlugChange}
        outcome={outcome}
        slug={slug}
      />

      <PlaybookAuthoringForm
        draft={draft}
        showValidationErrors={hasAttemptedSave}
        onChange={handleDraftChange}
        onClearError={handleClearMessages}
        onValidationChange={handleAuthoringValidationChange}
      />

      <details
        id="playbook-revision-history"
        className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm"
      >
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Revision History</h2>
              <p className="text-sm text-muted">
                Compare every saved playbook setting against an earlier revision.
              </p>
            </div>
          </div>
        </summary>
        <div className="mt-4">
          <PlaybookRevisionHistoryCard
            currentPlaybook={playbook}
            revisions={revisions.length > 0 ? revisions : [playbook]}
            comparedRevisionId={comparedRevisionId || playbook.id}
            diffRows={revisionDiff}
            onComparedRevisionChange={setComparedRevisionId}
          />
        </div>
      </details>

      <PlaybookDangerZone
        dangerOpen={dangerOpen}
        isDeletePending={deleteMutation.isPending}
        isPermanentDeletePending={permanentDeleteMutation.isPending}
        onOpenDeleteDialog={openDeleteDialog}
        onOpenPermanentDeleteDialog={openPermanentDeleteDialog}
        onToggleDanger={() => setDangerOpen((current) => !current)}
      />

      <PlaybookDeleteDialogs
        deleteError={deleteMutation.error}
        deleteOpen={deleteOpen}
        familyImpact={familyImpact}
        isDeleteImpactLoading={playbookDeleteImpactQuery.isLoading}
        isDeletePending={deleteMutation.isPending}
        isPermanentDeletePending={permanentDeleteMutation.isPending}
        isRevisionDeleteBlocked={revisionDeleteBlocked}
        onDeleteOpenChange={setDeleteOpen}
        onDeletePermanently={() => permanentDeleteMutation.mutate()}
        onDeleteRevision={() => deleteMutation.mutate()}
        onPermanentDeleteOpenChange={setPermanentDeleteOpen}
        permanentDeleteError={permanentDeleteMutation.error}
        permanentDeleteOpen={permanentDeleteOpen}
        playbookDeleteImpactError={playbookDeleteImpactQuery.error}
        playbookName={playbook.name}
        playbookVersion={playbook.version}
        revisionImpact={revisionImpact}
      />
    </div>
  );
}
