import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { createLoggedService } from '../logging/execution/create-logged-service.js';
import { LogService } from '../logging/execution/log-service.js';
import { CommunityCatalogImportService } from '../services/community-catalog/community-catalog-import-service.js';
import { CommunityCatalogOriginService } from '../services/community-catalog/community-catalog-origin-service.js';
import { CommunityCatalogPersistence } from '../services/community-catalog/community-catalog-persistence.js';
import { CommunityCatalogPreviewService } from '../services/community-catalog/community-catalog-preview-service.js';
import { CommunityCatalogRefResolver } from '../services/community-catalog/community-catalog-ref-resolver.js';
import { CommunityCatalogSourceService } from '../services/community-catalog/community-catalog-source.js';
import { PlaybookService } from '../services/playbook/playbook-service.js';
import { RoleDefinitionService } from '../services/role-definition/role-definition-service.js';
import { SpecialistSkillService } from '../services/specialist/specialist-skill-service.js';
import type { ContainerManagerVersionReader } from '../services/system-version/container-manager-version-reader.js';

interface CommunityCatalogBootstrapConfig {
  COMMUNITY_CATALOG_LOCAL_ROOT?: string;
  COMMUNITY_CATALOG_RAW_BASE_URL: string;
  COMMUNITY_CATALOG_REF?: string;
  COMMUNITY_CATALOG_REPOSITORY: string;
}

interface RegisterCommunityCatalogServicesInput {
  app: FastifyInstance;
  config: CommunityCatalogBootstrapConfig;
  containerManagerVersionReader: Pick<ContainerManagerVersionReader, 'getSummary'>;
  logService: LogService;
  playbookService: PlaybookService;
  pool: Pool;
  roleDefinitionService: RoleDefinitionService;
  specialistSkillService: SpecialistSkillService;
}

export function registerCommunityCatalogServices(
  input: RegisterCommunityCatalogServicesInput,
): void {
  const refResolver = new CommunityCatalogRefResolver({
    configuredRef: input.config.COMMUNITY_CATALOG_REF,
    versionReader: input.containerManagerVersionReader,
  });
  const sourceService = new CommunityCatalogSourceService({
    localRoot: input.config.COMMUNITY_CATALOG_LOCAL_ROOT,
    repository: input.config.COMMUNITY_CATALOG_REPOSITORY,
    rawBaseUrl: input.config.COMMUNITY_CATALOG_RAW_BASE_URL,
    resolveRef: () => refResolver.resolveRef(),
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
