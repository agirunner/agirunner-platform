export type DashboardCommunityCatalogStability = 'stable' | 'experimental';
export type DashboardCommunityCatalogConflictAction = 'create_new' | 'override_existing';
export type DashboardCommunityCatalogArtifactType = 'playbook' | 'specialist' | 'skill';

export interface DashboardCommunityCatalogPlaybookRecord {
  id: string;
  name: string;
  category: string;
  stability: DashboardCommunityCatalogStability;
  version: string;
  summary: string;
  specialist_ids: string[];
  path: string;
}

export interface DashboardCommunityCatalogLoadedPlaybook {
  id: string;
  path: string;
  readmePath: string;
  readme: string;
  name: string;
  slug: string;
  version: string;
  category: string;
  stability: DashboardCommunityCatalogStability;
  description: string;
  outcome: string;
  lifecycle: 'planned' | 'ongoing';
  specialistIds: string[];
  definition: Record<string, unknown>;
}

export interface DashboardCommunityCatalogLoadedSpecialist {
  id: string;
  path: string;
  name: string;
  category: string;
  stability: DashboardCommunityCatalogStability;
  description: string;
  allowedTools: string[] | string;
  skillIds: string[];
  systemPrompt: string;
}

export interface DashboardCommunityCatalogLoadedSkill {
  id: string;
  path: string;
  name: string;
  category: string;
  stability: DashboardCommunityCatalogStability;
  summary: string;
  content: string;
}

export interface DashboardCommunityCatalogPlaybookDetail {
  playbook: DashboardCommunityCatalogLoadedPlaybook;
  specialists: DashboardCommunityCatalogLoadedSpecialist[];
  skills: DashboardCommunityCatalogLoadedSkill[];
}

export interface DashboardCommunityCatalogConflict {
  key: string;
  artifactType: DashboardCommunityCatalogArtifactType;
  catalogId: string;
  catalogName: string;
  availableActions: readonly DashboardCommunityCatalogConflictAction[];
  localMatch: {
    id: string;
    name: string;
    slug?: string;
    matchKind: 'catalog_link' | 'slug' | 'name';
  };
}

export interface DashboardCommunityCatalogImportPreview {
  repository: string;
  ref: string;
  selectedPlaybooks: Array<{
    id: string;
    name: string;
    version: string;
    category: string;
    stability: DashboardCommunityCatalogStability;
    summary: string;
    stageNames: string[];
  }>;
  referencedSpecialists: Array<{
    id: string;
    name: string;
    category: string;
    stability: DashboardCommunityCatalogStability;
    summary: string;
  }>;
  referencedSkills: Array<{
    id: string;
    name: string;
    category: string;
    stability: DashboardCommunityCatalogStability;
    summary: string;
  }>;
  referencedSpecialistCount: number;
  referencedSkillCount: number;
  conflicts: DashboardCommunityCatalogConflict[];
}

export interface DashboardCommunityCatalogImportResult {
  importBatchId: string;
  importedPlaybooks: Array<{
    catalogId: string;
    localEntityId: string;
    localSlug: string;
  }>;
}

export interface DashboardCommunityCatalogPlaybookOrigin {
  catalogId: string;
  catalogName: string;
  catalogVersion: string | null;
}
