import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPagination,
  paginateListItems,
} from '../../components/list-pagination.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Button } from '../../components/ui/button.js';
import { IconActionButton } from '../../components/ui/icon-action-button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { toast } from '../../lib/toast.js';
import type { DashboardSpecialistSkillRecord } from '../../lib/api.js';
import {
  createSpecialistSkill,
  deleteSpecialistSkill,
  fetchSpecialistSkills,
  updateSpecialistSkill,
} from './skills-page.api.js';
import {
  createSkillFormState,
  SkillsPageDialog,
  type SkillFormState,
  validateSkillForm,
} from './skills-page.dialog.js';

interface DialogState {
  mode: 'create' | 'edit';
  skill: DashboardSpecialistSkillRecord | null;
}

export function SkillsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [form, setForm] = useState<SkillFormState>(createSkillFormState());
  const [deletingSkill, setDeletingSkill] = useState<DashboardSpecialistSkillRecord | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);
  const skillsQuery = useQuery({
    queryKey: ['specialist-skills'],
    queryFn: fetchSpecialistSkills,
  });
  const validation = useMemo(() => validateSkillForm(form), [form]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!dialogState) {
        throw new Error('Open the skill dialog before saving.');
      }
      if (!validation.isValid) {
        throw new Error('Complete the required skill fields before saving.');
      }
      const payload = buildSkillPayload(form);
      if (dialogState.mode === 'create') {
        return createSpecialistSkill(payload);
      }
      return updateSpecialistSkill(dialogState.skill?.id ?? '', payload);
    },
    onSuccess: async (skill) => {
      await queryClient.invalidateQueries({ queryKey: ['specialist-skills'] });
      setDialogState(null);
      setForm(createSkillFormState());
      toast.success(
        dialogState?.mode === 'edit'
          ? `Updated skill ${skill.name}.`
          : `Created skill ${skill.name}.`,
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save skill.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deletingSkill) {
        throw new Error('Choose a skill to delete.');
      }
      await deleteSpecialistSkill(deletingSkill.id);
    },
    onSuccess: async () => {
      const deletedSkillName = deletingSkill?.name ?? 'skill';
      await queryClient.invalidateQueries({ queryKey: ['specialist-skills'] });
      setDeletingSkill(null);
      toast.success(`Deleted skill ${deletedSkillName}.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete skill.');
    },
  });

  const skills = useMemo(
    () => [...(skillsQuery.data ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [skillsQuery.data],
  );
  const pagination = paginateListItems(skills, page, pageSize);

  if (skillsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (skillsQuery.error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load specialist skills: {String(skillsQuery.error)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader
        navHref="/design/specialists/skills"
        description="Manage reusable skill content shared across specialists."
        actions={
          <Button
            onClick={() => {
              setDialogState({ mode: 'create', skill: null });
              setForm(createSkillFormState());
            }}
          >
            <Plus className="h-4 w-4" />
            Create Skill
          </Button>
        }
      />

      <DashboardSectionCard
        title="Shared skills"
        description="Create, revise, and delete shared skills before assigning them to specialists."
        bodyClassName="space-y-0 p-0"
      >
        {skills.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-muted">
            <BrainCircuit className="h-12 w-12 text-muted" />
            <p className="font-medium text-foreground">No shared skills defined</p>
            <p className="text-sm">Create the first reusable skill for specialist assignments.</p>
            <Button
              onClick={() => {
                setDialogState({ mode: 'create', skill: null });
                setForm(createSkillFormState());
              }}
            >
              <Plus className="h-4 w-4" />
              Create Skill
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto px-6 pb-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Skill</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="w-[160px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination.items.map((skill) => (
                    <TableRow key={skill.id}>
                      <TableCell className="font-medium text-foreground">{skill.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted">{skill.slug}</TableCell>
                      <TableCell>{skill.summary || 'No summary provided.'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <IconActionButton
                            label={`Edit ${skill.name}`}
                            onClick={() => {
                              setDialogState({ mode: 'edit', skill });
                              setForm(createSkillFormState(skill));
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </IconActionButton>
                          <IconActionButton label={`Delete ${skill.name}`} onClick={() => setDeletingSkill(skill)}>
                            <Trash2 className="h-4 w-4" />
                          </IconActionButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ListPagination
              page={pagination.page}
              pageSize={pageSize}
              totalItems={pagination.totalItems}
              totalPages={pagination.totalPages}
              start={pagination.start}
              end={pagination.end}
              itemLabel="skills"
              onPageChange={setPage}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setPage(1);
              }}
            />
          </>
        )}
      </DashboardSectionCard>

      <SkillsPageDialog
        open={dialogState !== null}
        title={dialogState?.mode === 'edit' ? 'Edit Skill' : 'Create Skill'}
        submitLabel={dialogState?.mode === 'edit' ? 'Save Skill' : 'Create Skill'}
        form={form}
        validation={validation}
        isPending={saveMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setDialogState(null);
            setForm(createSkillFormState());
          }
        }}
        onFormChange={setForm}
        onSubmit={() => saveMutation.mutate()}
      />

      <Dialog
        open={deletingSkill !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeletingSkill(null);
          }
        }}
      >
        <DialogContent showCloseButton={!deleteMutation.isPending}>
          <DialogHeader>
            <DialogTitle>Delete Skill</DialogTitle>
            <DialogDescription>
              Delete this shared skill and remove its specialist assignments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted">
              This removes{' '}
              <span className="font-medium text-foreground">{deletingSkill?.name}</span> from the
              shared library and from any specialists currently using it.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={deleteMutation.isPending}
                onClick={() => setDeletingSkill(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                Delete Skill
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildSkillPayload(form: SkillFormState) {
  return {
    name: form.name.trim(),
    summary: form.summary.trim() || undefined,
    content: form.content.trim(),
  };
}
