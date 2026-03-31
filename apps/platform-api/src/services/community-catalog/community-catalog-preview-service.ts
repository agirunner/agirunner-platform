import type { CommunityCatalogImportPreview } from './community-catalog-types.js';
import { CommunityCatalogImportService } from './community-catalog-import-service.js';

export class CommunityCatalogPreviewService {
  constructor(
    private readonly importService: Pick<CommunityCatalogImportService, 'previewImport'>,
  ) {}

  previewImport(
    tenantId: string,
    input: { playbookIds: string[] },
  ): Promise<CommunityCatalogImportPreview> {
    return this.importService.previewImport(tenantId, input);
  }
}
