import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { createLoggedService } from '../logging/execution/create-logged-service.js';
import { LogService } from '../logging/execution/log-service.js';
import { CommunityCatalogImportService } from '../services/community-catalog/community-catalog-import-service.js';
import { CommunityCatalogOriginService } from '../services/community-catalog/community-catalog-origin-service.js';
import { CommunityCatalogPersistence } from '../services/community-catalog/community-catalog-persistence.js';
import { CommunityCatalogPreviewService } from '../services/community-catalog/community-catalog-preview-service.js';
import { CommunityCatalogSourceService } from '../services/community-catalog/community-catalog-source.js';
import { PlaybookService } from '../services/playbook/playbook-service.js';
import { RoleDefinitionService } from '../services/role-definition/role-definition-service.js';
import { SpecialistSkillService } from '../services/specialist/specialist-skill-service.js';

interface CommunityCatalogBootstrapConfig {
  COMMUNITY_CATALOG_RAW_BASE_URL: string;
  COMMUNITY_CATALOG_REF: string;
  COMMUNITY_CATALOG_REPOSITORY: string;
}

interface RegisterCommunityCatalogServicesInput {
  app: FastifyInstance;
  config: CommunityCatalogBootstrapConfig;
  logService: LogService;
  playbookService: PlaybookService;
  pool: Pool;
  roleDefinitionService: RoleDefinitionService;
  specialistSkillService: SpecialistSkillService;
}

export function registerCommunityCatalogServices(
  input: RegisterCommunityCatalogServicesInput,
): void {
  const sourceService = new CommunityCatalogSourceService({
    repository: input.config.COMMUNITY_CATALOG_REPOSITORY,
    ref: input.config.COMMUNITY_CATALOG_REF,
    rawBaseUrl: input.config.COMMUNITY_CATALOG_RAW_BASE_URL,
  });
  const persistence = new CommunityCatalogPersistence(input.pool);
  const importService = new CommunityCatalogImportService({
    sourceService,
    persistence,
    playbookService: input.playbookService,
    specialistSkillService: input.specialistSkillService,
    roleDefinitionService: input.roleDefinitionService,
  });
  const previewService = new CommunityCatalogPreviewService(importService);
  const originService = new CommunityCatalogOriginService(persistence);

  input.app.decorate(
    'communityCatalogSourceService',
    createLoggedService(sourceService, 'CommunityCatalogSourceService', input.logService),
  );
  input.app.decorate(
    'communityCatalogPreviewService',
    createLoggedService(previewService, 'CommunityCatalogPreviewService', input.logService),
  );
  input.app.decorate(
    'communityCatalogImportService',
    createLoggedService(importService, 'CommunityCatalogImportService', input.logService),
  );
  input.app.decorate(
    'communityCatalogOriginService',
    createLoggedService(originService, 'CommunityCatalogOriginService', input.logService),
  );
}
