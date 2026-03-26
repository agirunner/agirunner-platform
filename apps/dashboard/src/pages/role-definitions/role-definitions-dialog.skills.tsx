import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import { toast } from '../../lib/toast.js';
import type { DashboardSpecialistSkillRecord } from '../../lib/api.js';
import {
  archiveSpecialistSkill,
  createSpecialistSkill,
  restoreSpecialistSkill,
  updateSpecialistSkill,
} from './role-definitions-page.api.js';
import type {
  RoleDefinition,
  RoleFormState,
} from './role-definitions-page.support.js';

interface SkillEditorState {
  mode: 'create' | 'edit';
  skillId: string | null;
  name: string;
  summary: string;
  content: string;
}

export function RoleSkillsSection(props: {
  form: RoleFormState;
  setForm(next: RoleFormState): void;
  role?: RoleDefinition | null;
  skills: DashboardSpecialistSkillRecord[];
}) {
  const queryClient = useQueryClient();
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [editorState, setEditorState] = useState<SkillEditorState | null>(null);
  const assignedSkills = useMemo(
    () => buildAssignedSkills(props.skills, props.role, props.form.skillIds),
    [props.form.skillIds, props.role, props.skills],
  );
  const addableSkills = props.skills.filter(
    (skill) => !skill.is_archived && !props.form.skillIds.includes(skill.id),
  );

  const createMutation = useMutation({
    mutationFn: async (draft: SkillEditorState) =>
      createSpecialistSkill({
        name: draft.name.trim(),
        summary: draft.summary.trim() || undefined,
        content: draft.content.trim(),
      }),
    onSuccess: async (skill) => {
      await queryClient.invalidateQueries({ queryKey: ['specialist-skills'] });
      props.setForm({
        ...props.form,
        skillIds: [...props.form.skillIds, skill.id],
      });
      setEditorState(null);
      toast.success(`Created skill ${skill.name}.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create skill.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (draft: SkillEditorState) =>
      updateSpecialistSkill(draft.skillId ?? '', {
        name: draft.name.trim(),
        summary: draft.summary.trim() || null,
        content: draft.content.trim(),
      }),
    onSuccess: async (skill) => {
      await queryClient.invalidateQueries({ queryKey: ['specialist-skills'] });
      setEditorState(null);
      toast.success(`Updated skill ${skill.name}.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update skill.');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (skill: DashboardSpecialistSkillRecord) => archiveSpecialistSkill(skill.id),
    onSuccess: async (skill) => {
      await queryClient.invalidateQueries({ queryKey: ['specialist-skills'] });
      toast.success(`Archived skill ${skill.name}.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to archive skill.');
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (skill: DashboardSpecialistSkillRecord) => restoreSpecialistSkill(skill.id),
    onSuccess: async (skill) => {
      await queryClient.invalidateQueries({ queryKey: ['specialist-skills'] });
      toast.success(`Restored skill ${skill.name}.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to restore skill.');
    },
  });

  const isSkillMutationPending =
    createMutation.isPending
    || updateMutation.isPending
    || archiveMutation.isPending
    || restoreMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Skills</CardTitle>
          <Badge variant="outline">{props.form.skillIds.length}</Badge>
        </div>
        <CardDescription>
          Assign ordered specialist skills and maintain the shared skill library inline from this specialist editor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-[16rem] flex-1 gap-2 text-sm">
              <span className="font-medium">Select a skill</span>
              <Select value={selectedSkillId} onValueChange={setSelectedSkillId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a skill" />
                </SelectTrigger>
                <SelectContent>
                  {addableSkills.map((skill) => (
                    <SelectItem key={skill.id} value={skill.id}>
                      {skill.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={!selectedSkillId}
              onClick={() => {
                props.setForm({
                  ...props.form,
                  skillIds: [...props.form.skillIds, selectedSkillId],
                });
                setSelectedSkillId('');
              }}
            >
              Add skill
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditorState(createEditorState(null))}
            >
              Create skill
            </Button>
          </div>

          <div className="space-y-3">
            {assignedSkills.length === 0 ? (
              <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
                No skills assigned.
              </div>
            ) : (
              assignedSkills.map((skill, index) => (
                <div
                  key={skill.id}
                  className="rounded-lg border border-border/70 bg-muted/10 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{skill.name}</p>
                        {skill.isArchived ? <Badge variant="outline">Archived</Badge> : null}
                      </div>
                      <p className="text-sm text-muted">
                        {skill.summary || 'No summary provided.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={index === 0}
                        onClick={() =>
                          props.setForm({
                            ...props.form,
                            skillIds: moveItem(props.form.skillIds, index, index - 1),
                          })
                        }
                      >
                        Move up
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={index === props.form.skillIds.length - 1}
                        onClick={() =>
                          props.setForm({
                            ...props.form,
                            skillIds: moveItem(props.form.skillIds, index, index + 1),
                          })
                        }
                      >
                        Move down
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          props.setForm({
                            ...props.form,
                            skillIds: props.form.skillIds.filter((skillId) => skillId !== skill.id),
                          })
                        }
                      >
                        Remove skill
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-foreground">Skill library</p>
              <p className="text-sm text-muted">
                Manage reusable skill content without leaving this specialist dialog.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {props.skills.map((skill) => (
              <div
                key={skill.id}
                className="rounded-lg border border-border/70 bg-surface px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{skill.name}</p>
                      {skill.is_archived ? <Badge variant="outline">Archived</Badge> : null}
                    </div>
                    <p className="text-sm text-muted">{skill.summary || 'No summary provided.'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditorState(createEditorState(skill))}
                    >
                      Edit skill
                    </Button>
                    {skill.is_archived ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isSkillMutationPending}
                        onClick={() => restoreMutation.mutate(skill)}
                      >
                        Restore skill
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isSkillMutationPending}
                        onClick={() => archiveMutation.mutate(skill)}
                      >
                        Archive skill
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </CardContent>

      <SkillEditorDialog
        state={editorState}
        isPending={createMutation.isPending || updateMutation.isPending}
        onOpenChange={(open) => !open && setEditorState(null)}
        onChange={(next) => setEditorState(next)}
        onSubmit={() => {
          if (!editorState) {
            return;
          }
          if (editorState.mode === 'create') {
            createMutation.mutate(editorState);
            return;
          }
          updateMutation.mutate(editorState);
        }}
      />
    </Card>
  );
}

function SkillEditorDialog(props: {
  state: SkillEditorState | null;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onChange(next: SkillEditorState): void;
  onSubmit(): void;
}) {
  return (
    <Dialog open={props.state !== null} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {props.state?.mode === 'edit' ? 'Edit skill' : 'Create skill'}
          </DialogTitle>
          <DialogDescription>
            Skills are reusable prompt modules assigned to specialists in explicit order.
          </DialogDescription>
        </DialogHeader>
        {props.state ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              props.onSubmit();
            }}
          >
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Name</span>
              <Input
                value={props.state.name}
                onChange={(event) =>
                  props.onChange({ ...props.state, name: event.target.value })
                }
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Summary</span>
              <Input
                value={props.state.summary}
                onChange={(event) =>
                  props.onChange({ ...props.state, summary: event.target.value })
                }
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Content</span>
              <Textarea
                value={props.state.content}
                rows={10}
                onChange={(event) =>
                  props.onChange({ ...props.state, content: event.target.value })
                }
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={props.isPending}>
                {props.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {props.state.mode === 'edit' ? 'Save skill' : 'Create skill'}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function createEditorState(skill: DashboardSpecialistSkillRecord | null): SkillEditorState {
  return {
    mode: skill ? 'edit' : 'create',
    skillId: skill?.id ?? null,
    name: skill?.name ?? '',
    summary: skill?.summary ?? '',
    content: skill?.content ?? '',
  };
}

function buildAssignedSkills(
  skills: DashboardSpecialistSkillRecord[],
  role: RoleDefinition | null | undefined,
  skillIds: string[],
) {
  const skillMap = new Map(skills.map((skill) => [skill.id, skill] as const));
  const referencedMap = new Map((role?.skills ?? []).map((skill) => [skill.id, skill] as const));

  return skillIds.flatMap((skillId) => {
    const skill = skillMap.get(skillId);
    if (skill) {
      return [{
        id: skill.id,
        name: skill.name,
        summary: skill.summary,
        isArchived: skill.is_archived,
      }];
    }
    const referenced = referencedMap.get(skillId);
    if (!referenced) {
      return [];
    }
    return [{
      id: referenced.id,
      name: referenced.name,
      summary: referenced.summary ?? null,
      isArchived: referenced.is_archived === true,
    }];
  });
}

function moveItem(values: string[], fromIndex: number, toIndex: number): string[] {
  const next = [...values];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
