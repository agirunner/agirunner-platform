import { useMemo, useState } from 'react';

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type { DashboardSpecialistSkillRecord } from '../../lib/api.js';
import type { RoleDefinition, RoleFormState } from './role-definitions-page.support.js';

export function RoleSkillsSection(props: {
  form: RoleFormState;
  setForm(next: RoleFormState): void;
  role?: RoleDefinition | null;
  skills: DashboardSpecialistSkillRecord[];
}) {
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const assignedSkills = useMemo(
    () => buildAssignedSkills(props.skills, props.role, props.form.skillIds),
    [props.form.skillIds, props.role, props.skills],
  );
  const addableSkills = props.skills.filter(
    (skill) => !skill.is_archived && !props.form.skillIds.includes(skill.id),
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Skills</CardTitle>
          <Badge variant="outline">{props.form.skillIds.length}</Badge>
        </div>
        <CardDescription>
          Select shared skills to add to this specialist.
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
          </div>

          <div className="space-y-3">
            {assignedSkills.length === 0 ? (
              <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
                No skills assigned. Manage shared skill content from the Skills page, then assign it
                here.
              </div>
            ) : (
              assignedSkills.map((skill, index) => (
                <div
                  key={skill.id}
                  className="rounded-lg border border-border/70 bg-muted/10 px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{skill.name}</p>
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
      </CardContent>
    </Card>
  );
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
      return [
        {
          id: skill.id,
          name: skill.name,
          summary: skill.summary,
        },
      ];
    }

    const referenced = referencedMap.get(skillId);
    if (!referenced) {
      return [];
    }

    return [
      {
        id: referenced.id,
        name: referenced.name,
        summary: referenced.summary ?? null,
      },
    ];
  });
}

function moveItem(values: string[], fromIndex: number, toIndex: number): string[] {
  const next = [...values];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
