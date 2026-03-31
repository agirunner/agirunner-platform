import type { CommunityCatalogPersistence } from './community-catalog-persistence.js';
import type { CommunityCatalogOriginRecord } from './community-catalog-types.js';

export class CommunityCatalogOriginService {
  constructor(
    private readonly persistence: Pick<CommunityCatalogPersistence, 'getPlaybookOrigin'>,
  ) {}

  getPlaybookOrigin(tenantId: string, playbookId: string): Promise<CommunityCatalogOriginRecord | null> {
    return this.persistence.getPlaybookOrigin(tenantId, playbookId);
  }
}
