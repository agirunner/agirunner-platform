import type { PlaybookService } from '../playbook-service.js';
import type { RoleDefinitionService } from '../role-definition-service.js';
import type { SpecialistSkillService } from '../specialist-skill-service.js';
import type { CommunityCatalogPersistence } from './community-catalog-persistence.js';
import type { CommunityCatalogSourceService } from './community-catalog-source.js';
import type {
  CommunityCatalogArtifactType,
  CommunityCatalogConflict,
  CommunityCatalogConflictAction,
  CommunityCatalogImportInput,
  CommunityCatalogImportPreview,
  CommunityCatalogLoadedPlaybook,
  CommunityCatalogLoadedSkill,
  CommunityCatalogLoadedSpecialist,
  CommunityCatalogSelection,
} from './community-catalog-types.js';

export class CommunityCatalogImportService {
  constructor(private readonly deps: {
    sourceService: Pick<CommunityCatalogSourceService, 'loadSelection'>;
    persistence: Pick<
      CommunityCatalogPersistence,
      'createImportBatch' | 'findLatestLinksByCatalogIds' | 'upsertImportLink'
    >;
    playbookService: Pick<PlaybookService, 'listPlaybooks' | 'createPlaybook' | 'replacePlaybook'>;
    specialistSkillService: Pick<SpecialistSkillService, 'listSkills' | 'createSkill' | 'updateSkill'>;
    roleDefinitionService: Pick<RoleDefinitionService, 'listRoles' | 'createRole' | 'updateRole'>;
  }) {}

  async previewImport(
    tenantId: string,
    input: { playbookIds: string[] },
  ): Promise<CommunityCatalogImportPreview> {
    const selection = await this.deps.sourceService.loadSelection(input.playbookIds);
    const conflicts = await this.buildConflicts(tenantId, selection);
    return {
      repository: selection.repository,
      ref: selection.ref,
      selectedPlaybooks: selection.packages.map((pkg) => ({
        id: pkg.playbook.id,
        name: pkg.playbook.name,
        version: pkg.playbook.version,
        category: pkg.playbook.category,
        stability: pkg.playbook.stability,
        summary: pkg.playbook.description,
        stageNames: readStageNames(pkg.playbook.definition),
      })),
      referencedSpecialists: uniqueSpecialists(selection).map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        stability: item.stability,
        summary: item.description,
      })),
      referencedSkills: uniqueSkills(selection).map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        stability: item.stability,
        summary: item.summary,
      })),
      referencedSpecialistCount: countUnique(selection.packages.flatMap((pkg) => pkg.specialists.map((item) => item.id))),
      referencedSkillCount: countUnique(selection.packages.flatMap((pkg) => pkg.skills.map((item) => item.id))),
      conflicts,
    };
  }

  async importPlaybooks(
    tenantId: string,
    input: CommunityCatalogImportInput,
  ) {
    const selection = await this.deps.sourceService.loadSelection(input.playbookIds);
    const conflicts = await this.buildConflicts(tenantId, selection);
    const conflictMap = new Map(conflicts.map((conflict) => [conflict.key, conflict]));
    const requestedDefault = input.defaultConflictResolution ?? 'create_new';
    const batch = await this.deps.persistence.createImportBatch(tenantId, {
      repository: selection.repository,
      ref: selection.ref,
      playbookIds: input.playbookIds,
    });

    const skillIdMap = new Map<string, string>();
    for (const skill of uniqueSkills(selection)) {
      const localId = await this.importSkill(
        tenantId,
        batch.id,
        selection,
        skill,
        resolveConflictAction(conflictMap.get(buildConflictKey('skill', skill.id)), requestedDefault, input.conflictResolutions),
      );
      skillIdMap.set(skill.id, localId);
    }

    const specialistIdMap = new Map<string, string>();
    for (const specialist of uniqueSpecialists(selection)) {
      const localId = await this.importSpecialist(
        tenantId,
        batch.id,
        selection,
        specialist,
        skillIdMap,
        resolveConflictAction(conflictMap.get(buildConflictKey('specialist', specialist.id)), requestedDefault, input.conflictResolutions),
      );
      specialistIdMap.set(specialist.id, localId);
    }

    const importedPlaybooks = [];
    for (const pkg of selection.packages) {
      const action = resolveConflictAction(
        conflictMap.get(buildConflictKey('playbook', pkg.playbook.id)),
        requestedDefault,
        input.conflictResolutions,
      );
      const localPlaybook = await this.importPlaybook(
        tenantId,
        batch.id,
        selection,
        pkg.playbook,
        action,
      );
      importedPlaybooks.push({
        catalogId: pkg.playbook.id,
        localEntityId: String(localPlaybook.id),
        localSlug: String(localPlaybook.slug),
      });
    }

    return {
      importBatchId: batch.id,
      importedPlaybooks,
    };
  }

  private async buildConflicts(tenantId: string, selection: CommunityCatalogSelection): Promise<CommunityCatalogConflict[]> {
    const [playbooks, skills, roles] = await Promise.all([
      this.deps.playbookService.listPlaybooks(tenantId),
      this.deps.specialistSkillService.listSkills(tenantId),
      this.deps.roleDefinitionService.listRoles(tenantId),
    ]);

    const [playbookLinks, skillLinks, specialistLinks] = await Promise.all([
      this.deps.persistence.findLatestLinksByCatalogIds(tenantId, 'playbook', selection.packages.map((pkg) => pkg.playbook.id)),
      this.deps.persistence.findLatestLinksByCatalogIds(tenantId, 'skill', uniqueSkills(selection).map((item) => item.id)),
      this.deps.persistence.findLatestLinksByCatalogIds(tenantId, 'specialist', uniqueSpecialists(selection).map((item) => item.id)),
    ]);

    const conflicts: CommunityCatalogConflict[] = [];

    for (const playbook of selection.packages.map((pkg) => pkg.playbook)) {
      const linked = playbookLinks.find((entry) => entry.catalogId === playbook.id);
      const fallback = playbooks.find((entry) => String(entry.slug) === playbook.slug);
      const match = linked
        ? { id: linked.localEntityId, name: playbook.name, slug: playbook.slug, matchKind: 'catalog_link' as const }
        : fallback
          ? { id: String(fallback.id), name: String(fallback.name), slug: String(fallback.slug), matchKind: 'slug' as const }
          : null;
      if (match) {
        conflicts.push({
          key: buildConflictKey('playbook', playbook.id),
          artifactType: 'playbook',
          catalogId: playbook.id,
          catalogName: playbook.name,
          availableActions: ['create_new', 'override_existing'],
          localMatch: match,
        });
      }
    }

    for (const skill of uniqueSkills(selection)) {
      const linked = skillLinks.find((entry) => entry.catalogId === skill.id);
      const fallback = skills.find(
        (entry) => String(entry.slug) === skill.id || String(entry.name).toLowerCase() === skill.name.toLowerCase(),
      );
      const match = linked
        ? { id: linked.localEntityId, name: skill.name, slug: skill.id, matchKind: 'catalog_link' as const }
        : fallback
          ? { id: String(fallback.id), name: String(fallback.name), slug: String(fallback.slug), matchKind: String(fallback.slug) === skill.id ? 'slug' as const : 'name' as const }
          : null;
      if (match) {
        conflicts.push({
          key: buildConflictKey('skill', skill.id),
          artifactType: 'skill',
          catalogId: skill.id,
          catalogName: skill.name,
          availableActions: ['create_new', 'override_existing'],
          localMatch: match,
        });
      }
    }

    for (const specialist of uniqueSpecialists(selection)) {
      const linked = specialistLinks.find((entry) => entry.catalogId === specialist.id);
      const fallback = roles.find((entry) => String(entry.name).toLowerCase() === specialist.name.toLowerCase());
      const match = linked
        ? { id: linked.localEntityId, name: specialist.name, matchKind: 'catalog_link' as const }
        : fallback
          ? { id: String(fallback.id), name: String(fallback.name), matchKind: 'name' as const }
          : null;
      if (match) {
        conflicts.push({
          key: buildConflictKey('specialist', specialist.id),
          artifactType: 'specialist',
          catalogId: specialist.id,
          catalogName: specialist.name,
          availableActions: ['override_existing'],
          localMatch: match,
        });
      }
    }

    return conflicts;
  }

  private async importSkill(
    tenantId: string,
    batchId: string,
    selection: CommunityCatalogSelection,
    skill: CommunityCatalogLoadedSkill,
    action: CommunityCatalogConflictAction,
  ): Promise<string> {
    const existingSkills = await this.deps.specialistSkillService.listSkills(tenantId);
    const current = existingSkills.find(
      (entry) => String(entry.slug) === skill.id || String(entry.name).toLowerCase() === skill.name.toLowerCase(),
    );

    let localId: string;
    if (current && action === 'override_existing') {
      const updated = await this.deps.specialistSkillService.updateSkill(tenantId, String(current.id), {
        name: skill.name,
        slug: skill.id,
        summary: skill.summary,
        content: skill.content,
      });
      localId = String(updated.id);
    } else {
      const created = await this.deps.specialistSkillService.createSkill(tenantId, {
        name: skill.name,
        slug: current ? buildUniqueSlug(skill.id, existingSkills.map((entry) => String(entry.slug))) : skill.id,
        summary: skill.summary,
        content: skill.content,
      });
      localId = String(created.id);
    }

    await this.deps.persistence.upsertImportLink(tenantId, {
      importBatchId: batchId,
      artifactType: 'skill',
      catalogId: skill.id,
      catalogName: skill.name,
      catalogVersion: null,
      catalogPath: skill.path,
      sourceRepository: selection.repository,
      sourceRef: selection.ref,
      localEntityId: localId,
    });
    return localId;
  }

  private async importSpecialist(
    tenantId: string,
    batchId: string,
    selection: CommunityCatalogSelection,
    specialist: CommunityCatalogLoadedSpecialist,
    skillIdMap: Map<string, string>,
    action: CommunityCatalogConflictAction,
  ): Promise<string> {
    const existingRoles = await this.deps.roleDefinitionService.listRoles(tenantId);
    const current = existingRoles.find((entry) => String(entry.name).toLowerCase() === specialist.name.toLowerCase());
    const allowedTools = Array.isArray(specialist.allowedTools)
      ? specialist.allowedTools
      : selection.toolProfiles[specialist.allowedTools] ?? [];
    const payload = {
      name: specialist.name,
      description: specialist.description,
      systemPrompt: specialist.systemPrompt,
      allowedTools,
      skillIds: specialist.skillIds.map((skillId) => skillIdMap.get(skillId)).filter(isDefined),
    };

    let localId: string;
    if (current && action === 'override_existing') {
      const updated = await this.deps.roleDefinitionService.updateRole(tenantId, String(current.id), payload);
      localId = String(updated.id);
    } else {
      const created = await this.deps.roleDefinitionService.createRole(tenantId, payload);
      localId = String(created.id);
    }

    await this.deps.persistence.upsertImportLink(tenantId, {
      importBatchId: batchId,
      artifactType: 'specialist',
      catalogId: specialist.id,
      catalogName: specialist.name,
      catalogVersion: null,
      catalogPath: specialist.path,
      sourceRepository: selection.repository,
      sourceRef: selection.ref,
      localEntityId: localId,
    });
    return localId;
  }

  private async importPlaybook(
    tenantId: string,
    batchId: string,
    selection: CommunityCatalogSelection,
    playbook: CommunityCatalogLoadedPlaybook,
    action: CommunityCatalogConflictAction,
  ) {
    const existingPlaybooks = await this.deps.playbookService.listPlaybooks(tenantId);
    const current = existingPlaybooks.find((entry) => String(entry.slug) === playbook.slug);
    const payload = {
      name: playbook.name,
      slug:
        current && action === 'create_new'
          ? buildUniqueSlug(playbook.slug, existingPlaybooks.map((entry) => String(entry.slug)))
          : playbook.slug,
      description: playbook.description,
      outcome: playbook.outcome,
      lifecycle: playbook.lifecycle,
      definition: playbook.definition,
    };

    const local =
      current && action === 'override_existing'
        ? await this.deps.playbookService.replacePlaybook(tenantId, String(current.id), payload)
        : await this.deps.playbookService.createPlaybook(tenantId, payload);

    await this.deps.persistence.upsertImportLink(tenantId, {
      importBatchId: batchId,
      artifactType: 'playbook',
      catalogId: playbook.id,
      catalogName: playbook.name,
      catalogVersion: playbook.version,
      catalogPath: playbook.path,
      sourceRepository: selection.repository,
      sourceRef: selection.ref,
      localEntityId: String(local.id),
    });
    return local;
  }
}

function uniqueSkills(selection: CommunityCatalogSelection): CommunityCatalogLoadedSkill[] {
  return uniqueBy(selection.packages.flatMap((pkg) => pkg.skills), (item) => item.id);
}

function uniqueSpecialists(selection: CommunityCatalogSelection): CommunityCatalogLoadedSpecialist[] {
  return uniqueBy(selection.packages.flatMap((pkg) => pkg.specialists), (item) => item.id);
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function countUnique(values: string[]): number {
  return new Set(values).size;
}

function readStageNames(definition: Record<string, unknown>): string[] {
  const stages = definition.stages;
  if (!Array.isArray(stages)) {
    return [];
  }
  return stages
    .map((stage) => (stage && typeof stage === 'object' ? (stage as { name?: unknown }).name : undefined))
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function resolveConflictAction(
  conflict: CommunityCatalogConflict | undefined,
  defaultAction: CommunityCatalogConflictAction,
  overrides: Record<string, CommunityCatalogConflictAction> | undefined,
): CommunityCatalogConflictAction {
  if (!conflict) {
    return 'create_new';
  }
  const requested = overrides?.[conflict.key] ?? defaultAction;
  return conflict.availableActions.includes(requested)
    ? requested
    : conflict.availableActions[0]!;
}

function buildConflictKey(artifactType: CommunityCatalogArtifactType, catalogId: string): string {
  return `${artifactType}:${catalogId}`;
}

function buildUniqueSlug(base: string, existing: string[]): string {
  const normalized = base.trim().toLowerCase();
  if (!existing.includes(normalized)) {
    return normalized;
  }
  let index = 2;
  while (existing.includes(`${normalized}-${index}`)) {
    index += 1;
  }
  return `${normalized}-${index}`;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
