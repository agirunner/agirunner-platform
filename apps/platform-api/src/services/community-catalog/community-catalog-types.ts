export type CommunityCatalogStability = 'stable' | 'experimental';
export type CommunityCatalogArtifactType = 'playbook' | 'specialist' | 'skill';
export type CommunityCatalogConflictAction = 'create_new' | 'override_existing';

export interface CommunityCatalogPlaybookManifestEntry {
  id: string;
  name: string;
  author: string;
  category: string;
  stability: CommunityCatalogStability;
  version: string;
  summary: string;
  specialist_ids: string[];
  path: string;
}

export interface CommunityCatalogSpecialistManifestEntry {
  id: string;
  name: string;
  category: string;
  stability: CommunityCatalogStability;
  summary: string;
  skill_ids: string[];
  path: string;
}

export interface CommunityCatalogSkillManifestEntry {
  id: string;
  name: string;
  category: string;
  stability: CommunityCatalogStability;
  summary: string;
  path: string;
}

export interface CommunityCatalogPlaybookPackage {
  playbook: CommunityCatalogLoadedPlaybook;
  specialists: CommunityCatalogLoadedSpecialist[];
  skills: CommunityCatalogLoadedSkill[];
}

export interface CommunityCatalogLoadedPlaybook {
  id: string;
  path: string;
  readmePath: string;
  readme: string;
  name: string;
  author: string;
  slug: string;
  version: string;
  category: string;
  stability: CommunityCatalogStability;
  description: string;
  outcome: string;
  lifecycle: 'planned' | 'ongoing';
  specialistIds: string[];
  definition: Record<string, unknown>;
}

export interface CommunityCatalogLoadedSpecialist {
  id: string;
  path: string;
  name: string;
  category: string;
  stability: CommunityCatalogStability;
  description: string;
  allowedTools: string[] | string;
  skillIds: string[];
  systemPrompt: string;
}

export interface CommunityCatalogLoadedSkill {
  id: string;
  path: string;
  name: string;
  category: string;
  stability: CommunityCatalogStability;
  summary: string;
  content: string;
}

export interface CommunityCatalogSelection {
  repository: string;
  ref: string;
  toolProfiles: Record<string, string[]>;
  packages: CommunityCatalogPlaybookPackage[];
}

export interface CommunityCatalogImportPreviewInput {
  playbookIds: string[];
}

export interface CommunityCatalogImportInput extends CommunityCatalogImportPreviewInput {
  defaultConflictResolution?: CommunityCatalogConflictAction;
  conflictResolutions?: Record<string, CommunityCatalogConflictAction>;
}

export interface CommunityCatalogConflict {
  key: string;
  artifactType: CommunityCatalogArtifactType;
  catalogId: string;
  catalogName: string;
  availableActions: readonly CommunityCatalogConflictAction[];
  localMatch: {
    id: string;
    name: string;
    slug?: string;
    matchKind: 'catalog_link' | 'slug' | 'name';
  };
}

export interface CommunityCatalogImportPreview {
  repository: string;
  ref: string;
  selectedPlaybooks: Array<{
    id: string;
    name: string;
    version: string;
    category: string;
    stability: CommunityCatalogStability;
    summary: string;
    stageNames: string[];
  }>;
  referencedSpecialists: Array<{
    id: string;
    name: string;
    category: string;
    stability: CommunityCatalogStability;
    summary: string;
  }>;
  referencedSkills: Array<{
    id: string;
    name: string;
    category: string;
    stability: CommunityCatalogStability;
    summary: string;
  }>;
  referencedSpecialistCount: number;
  referencedSkillCount: number;
  conflicts: CommunityCatalogConflict[];
}

export interface CommunityCatalogImportResult {
  importBatchId: string;
  importedPlaybooks: Array<{
    catalogId: string;
    localEntityId: string;
    localSlug: string;
  }>;
}

export interface CommunityCatalogOriginRecord {
  catalogId: string;
  catalogName: string;
  catalogVersion: string | null;
}

export interface CommunityCatalogImportLinkRecord extends CommunityCatalogOriginRecord {
  artifactType: CommunityCatalogArtifactType;
  localEntityId: string;
  matchKind?: 'catalog_link';
}
