import { useEffect, useState, type ReactNode } from 'react';

import {
  type DashboardWorkflowBoardColumn,
  type DashboardWorkflowStageRecord,
} from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { StructuredEntryDraft } from '../workspace-detail/workspace-detail-support.js';
import {
  normalizeWorkItemPriority,
  validateWorkItemMetadataEntries,
  WORK_ITEM_PRIORITY_OPTIONS,
  type WorkItemPriority,
} from './workflow-work-item-form-support.js';
import { WorkItemMetadataEditor } from './workflow-work-item-metadata-editor.js';
import type { DashboardGroupedWorkItemRecord } from './workflow-work-item-detail-support.js';

const sectionFrameClass = 'rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm';
const mutedBodyClass = 'text-sm leading-6 text-muted';
const fieldStackClass = 'grid gap-2';
const errorTextClass = 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700';
const responsiveTabTriggerClass = 'h-auto whitespace-normal px-3 py-2 text-center leading-5';

interface WorkItemOperatorSectionProps {
  isMilestone: boolean;
  columns: DashboardWorkflowBoardColumn[];
  stages: DashboardWorkflowStageRecord[];
  ownerRoleOptions: string[];
  parentMilestones: DashboardGroupedWorkItemRecord[];
  stageName: string;
  columnId: string;
  ownerRole: string;
  parentWorkItemId: string;
  acceptanceCriteria: string;
  notes: string;
  priority: WorkItemPriority;
  metadataDrafts: StructuredEntryDraft[];
  lockedMetadataDraftIds: string[];
  metadataValidation: ReturnType<typeof validateWorkItemMetadataEntries>;
  childTitle: string;
  childGoal: string;
  childAcceptanceCriteria: string;
  childNotes: string;
  childPriority: WorkItemPriority;
  childMetadataDrafts: StructuredEntryDraft[];
  childMetadataValidation: ReturnType<typeof validateWorkItemMetadataEntries>;
  onStageNameChange(value: string): void;
  onColumnIdChange(value: string): void;
  onOwnerRoleChange(value: string): void;
  onParentWorkItemIdChange(value: string): void;
  onAcceptanceCriteriaChange(value: string): void;
  onNotesChange(value: string): void;
  onPriorityChange(value: WorkItemPriority): void;
  onMetadataDraftsChange(value: StructuredEntryDraft[]): void;
  onChildTitleChange(value: string): void;
  onChildGoalChange(value: string): void;
  onChildAcceptanceCriteriaChange(value: string): void;
  onChildNotesChange(value: string): void;
  onChildPriorityChange(value: WorkItemPriority): void;
  onChildMetadataDraftsChange(value: StructuredEntryDraft[]): void;
  onSave(): void;
  onCreateChild(): void;
  isSaving: boolean;
  isCreatingChild: boolean;
  hasChanges: boolean;
  canSave: boolean;
  canCreateChild: boolean;
  message: string | null;
  error: string | null;
}

export function WorkItemOperatorSection(props: WorkItemOperatorSectionProps): JSX.Element {
  const selectedPriority = WORK_ITEM_PRIORITY_OPTIONS.find(
    (option) => option.value === props.priority,
  );
  const selectedChildPriority = WORK_ITEM_PRIORITY_OPTIONS.find(
    (option) => option.value === props.childPriority,
  );
  const [activeControlSurface, setActiveControlSurface] = useState<
    'brief' | 'routing' | 'decompose'
  >(props.isMilestone ? 'brief' : 'routing');

  useEffect(() => {
    setActiveControlSurface(props.isMilestone ? 'brief' : 'routing');
  }, [props.isMilestone]);

  return (
    <section
      className="grid gap-4 rounded-xl border border-border/70 bg-gradient-to-br from-border/10 via-surface to-surface p-4 shadow-sm"
      data-testid="work-item-operator-controls"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid gap-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Operator flow controls
          </div>
          <strong className="text-base">Operator Flow Controls</strong>
        </div>
        {props.isMilestone ? (
          <Badge variant="outline">Milestone operator mode</Badge>
        ) : (
          <Badge variant="outline">Child/top-level operator mode</Badge>
        )}
      </div>
      <p className={mutedBodyClass}>
        Adjust board placement, stage ownership, and milestone nesting without leaving the work-item
        operator view.
      </p>
      <Tabs
        value={activeControlSurface}
        onValueChange={(value) =>
          setActiveControlSurface(value as 'brief' | 'routing' | 'decompose')
        }
        className="grid gap-4"
      >
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-xl border border-border/70 bg-background/80 p-1 md:grid-cols-3">
          <TabsTrigger value="brief" className={responsiveTabTriggerClass}>
            Brief &amp; metadata
          </TabsTrigger>
          <TabsTrigger value="routing" className={responsiveTabTriggerClass}>
            Routing &amp; ownership
          </TabsTrigger>
          <TabsTrigger
            value="decompose"
            className={responsiveTabTriggerClass}
            disabled={!props.isMilestone}
          >
            Milestone plan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="brief" className="mt-0 grid gap-4">
          <OperatorSectionCard
            eyebrow="Work-item brief"
            title="Brief and operator notes"
            description="Keep the selected work-item packet current with explicit priority, acceptance criteria, and operator notes."
          >
            <div className="grid gap-4">
              <label className={fieldStackClass}>
                <span className="text-sm font-medium text-foreground">Priority</span>
                <Select
                  value={props.priority}
                  onValueChange={(value) =>
                    props.onPriorityChange(normalizeWorkItemPriority(value))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_ITEM_PRIORITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted">{selectedPriority?.description}</p>
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className={fieldStackClass}>
                  <span className="text-sm font-medium text-foreground">Acceptance criteria</span>
                  <Textarea
                    value={props.acceptanceCriteria}
                    onChange={(event) => props.onAcceptanceCriteriaChange(event.target.value)}
                    className="min-h-[124px]"
                    placeholder="List the conditions that define done for this work item."
                  />
                </label>
                <label className={fieldStackClass}>
                  <span className="text-sm font-medium text-foreground">Notes</span>
                  <Textarea
                    value={props.notes}
                    onChange={(event) => props.onNotesChange(event.target.value)}
                    className="min-h-[124px]"
                    placeholder="Capture operator context, watchouts, or board-specific follow-up."
                  />
                </label>
              </div>
            </div>
          </OperatorSectionCard>
          <OperatorSectionCard
            eyebrow="Structured metadata"
            title="Metadata patch"
            description="Update typed metadata entries with structured controls. Existing keys can be edited here, but key removal is not supported in this operator flow."
          >
            <WorkItemMetadataEditor
              title="Work-item metadata"
              description="Use typed key and value rows instead of raw JSON so metadata stays accessible in the operator surface."
              drafts={props.metadataDrafts}
              validation={props.metadataValidation}
              addLabel="Add Metadata Entry"
              lockedDraftIds={props.lockedMetadataDraftIds}
              onChange={props.onMetadataDraftsChange}
            />
          </OperatorSectionCard>
        </TabsContent>

        <TabsContent value="routing" className="mt-0 grid gap-4">
          <OperatorSectionCard
            eyebrow="Board placement"
            title="Stage and board routing"
            description="Keep the work item in the correct stage and visible board column while execution is in flight."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className={fieldStackClass}>
                <span className="text-sm font-medium text-foreground">Stage</span>
                <Select value={props.stageName} onValueChange={props.onStageNameChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.stages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.name}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className={fieldStackClass}>
                <span className="text-sm font-medium text-foreground">Board column</span>
                <Select value={props.columnId} onValueChange={props.onColumnIdChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.columns.map((column) => (
                      <SelectItem key={column.id} value={column.id}>
                        {column.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </OperatorSectionCard>

          <OperatorSectionCard
            eyebrow="Ownership and linkage"
            title={props.isMilestone ? 'Milestone ownership' : 'Ownership and milestone linkage'}
            description={
              props.isMilestone
                ? 'Milestones stay top-level and coordinate child delivery rather than nesting under another parent.'
                : 'Adjust responsibility and milestone grouping without leaving the selected work-item flow.'
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              {!props.isMilestone ? (
                <label className={fieldStackClass}>
                  <span className="text-sm font-medium text-foreground">
                    Reparent under milestone
                  </span>
                  <Select
                    value={props.parentWorkItemId || '__none__'}
                    onValueChange={(value) =>
                      props.onParentWorkItemIdChange(value === '__none__' ? '' : value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Top-level work item" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Top-level work item</SelectItem>
                      {props.parentMilestones.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ) : (
                <div className="rounded-lg border border-border/70 bg-border/10 p-4 text-sm leading-6 text-muted">
                  Parent milestones stay top-level. Move or reparent child work items instead of
                  nesting milestones.
                </div>
              )}
              <label className={fieldStackClass}>
                <span className="text-sm font-medium text-foreground">
                  {props.isMilestone ? 'Owner role' : 'Owner role override'}
                </span>
                <Select
                  value={props.ownerRole || '__unassigned__'}
                  onValueChange={(value) =>
                    props.onOwnerRoleChange(value === '__unassigned__' ? '' : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select owner role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {props.ownerRoleOptions.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted">
                  {props.ownerRoleOptions.length > 0
                    ? 'Choose from roles already active on this board run instead of typing a free-form override.'
                    : 'No known board roles are available yet. Configure roles on the playbook or through active model assignments first.'}
                </p>
              </label>
            </div>
          </OperatorSectionCard>
        </TabsContent>

        {props.isMilestone ? (
          <TabsContent value="decompose" className="mt-0 grid gap-4">
            <OperatorSectionCard
              eyebrow="Milestone decomposition"
              title="Create child work item"
              description="Break this milestone into child deliverables so operators can track each downstream work item separately."
            >
              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={fieldStackClass}>
                    <span className="text-sm font-medium text-foreground">Title</span>
                    <Input
                      value={props.childTitle}
                      onChange={(event) => props.onChildTitleChange(event.target.value)}
                      placeholder="e.g. Implement auth service"
                    />
                  </label>
                  <label className={fieldStackClass}>
                    <span className="text-sm font-medium text-foreground">Priority</span>
                    <Select
                      value={props.childPriority}
                      onValueChange={(value) =>
                        props.onChildPriorityChange(normalizeWorkItemPriority(value))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select priority" />
                      </SelectTrigger>
                      <SelectContent>
                        {WORK_ITEM_PRIORITY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs leading-5 text-muted">
                      {selectedChildPriority?.description}
                    </p>
                  </label>
                </div>
                <label className={fieldStackClass}>
                  <span className="text-sm font-medium text-foreground">Goal</span>
                  <Textarea
                    value={props.childGoal}
                    onChange={(event) => props.onChildGoalChange(event.target.value)}
                    className="min-h-[96px]"
                    placeholder="Describe the child deliverable."
                  />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={fieldStackClass}>
                    <span className="text-sm font-medium text-foreground">
                      Child acceptance criteria
                    </span>
                    <Textarea
                      value={props.childAcceptanceCriteria}
                      onChange={(event) =>
                        props.onChildAcceptanceCriteriaChange(event.target.value)
                      }
                      className="min-h-[124px]"
                      placeholder="List the acceptance criteria this child work item must satisfy."
                    />
                  </label>
                  <label className={fieldStackClass}>
                    <span className="text-sm font-medium text-foreground">Child notes</span>
                    <Textarea
                      value={props.childNotes}
                      onChange={(event) => props.onChildNotesChange(event.target.value)}
                      className="min-h-[124px]"
                      placeholder="Capture operator guidance or notes for the child item."
                    />
                  </label>
                </div>
                <WorkItemMetadataEditor
                  title="Child metadata"
                  description="Attach supported typed metadata to the child work item without writing raw JSON."
                  drafts={props.childMetadataDrafts}
                  validation={props.childMetadataValidation}
                  addLabel="Add Child Metadata Entry"
                  onChange={props.onChildMetadataDraftsChange}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={props.onCreateChild}
                    disabled={!props.canCreateChild || props.isCreatingChild}
                  >
                    {props.isCreatingChild ? 'Creating…' : 'Create Child Work Item'}
                  </Button>
                </div>
              </div>
            </OperatorSectionCard>
          </TabsContent>
        ) : null}
      </Tabs>
      {props.error ? <p className={errorTextClass}>{props.error}</p> : null}
      {props.message ? (
        <p className="rounded-lg border border-border/70 bg-surface px-4 py-3 text-sm text-muted">
          {props.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface/70 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant={props.hasChanges ? 'warning' : 'outline'}>
            {props.hasChanges ? 'Unsaved operator changes' : 'No pending control changes'}
          </Badge>
          {props.isMilestone ? (
            <Badge variant="secondary">Milestone flow</Badge>
          ) : (
            <Badge variant="secondary">Work-item flow</Badge>
          )}
        </div>
        <Button
          onClick={props.onSave}
          disabled={!props.hasChanges || props.isSaving || !props.canSave}
        >
          {props.isSaving ? 'Saving…' : 'Save Operator Changes'}
        </Button>
      </div>
    </section>
  );
}

function OperatorSectionCard(props: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={cn(sectionFrameClass, 'grid gap-4')}>
      <div className="grid gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {props.eyebrow}
        </div>
        <strong className="text-base">{props.title}</strong>
        <p className={mutedBodyClass}>{props.description}</p>
      </div>
      {props.children}
    </div>
  );
}
