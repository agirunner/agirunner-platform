import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { validateTemplateSchema } from '../orchestration/pipeline-engine.js';
import { EventService } from './event-service.js';
import type { CreateTemplateInput, UpdateTemplateInput } from './template-service.types.js';

interface TemplateWriteDependencies {
  pool: DatabasePool;
  eventService: EventService;
  getTemplateOrThrow: (tenantId: string, templateId: string) => Promise<Record<string, unknown>>;
  toTemplateResponse: (row: Record<string, unknown>) => Record<string, unknown>;
}

export class TemplateWriteService {
  constructor(private readonly deps: TemplateWriteDependencies) {}

  async createTemplate(identity: ApiKeyIdentity, input: CreateTemplateInput) {
    const schema = validateTemplateSchema(input.schema);

    const existing = await this.deps.pool.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version
       FROM templates
       WHERE tenant_id = $1 AND slug = $2`,
      [identity.tenantId, input.slug],
    );

    const nextVersion = Number(existing.rows[0].max_version) + 1;
    const result = await this.deps.pool.query(
      `INSERT INTO templates (tenant_id, name, slug, description, version, is_built_in, is_published, schema)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)
       RETURNING *`,
      [identity.tenantId, input.name, input.slug, input.description ?? null, nextVersion, input.is_published ?? false, schema],
    );

    const template = result.rows[0] as Record<string, unknown>;
    await this.deps.eventService.emit({
      tenantId: identity.tenantId,
      type: 'template.created',
      entityType: 'template',
      entityId: template.id as string,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { slug: template.slug, version: template.version },
    });

    return this.deps.toTemplateResponse(template);
  }

  async updateTemplate(identity: ApiKeyIdentity, templateId: string, patch: UpdateTemplateInput) {
    const current = await this.deps.getTemplateOrThrow(identity.tenantId, templateId);
    const nextSlug = patch.slug ?? (current.slug as string);
    const nextSchema = patch.schema ? validateTemplateSchema(patch.schema) : current.schema;

    const versionRes = await this.deps.pool.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version FROM templates WHERE tenant_id = $1 AND slug = $2`,
      [identity.tenantId, nextSlug],
    );

    const nextVersion = Number(versionRes.rows[0].max_version) + 1;
    const created = await this.deps.pool.query(
      `INSERT INTO templates (tenant_id, name, slug, description, version, is_built_in, is_published, schema)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        identity.tenantId,
        patch.name ?? current.name,
        nextSlug,
        patch.description ?? current.description,
        nextVersion,
        current.is_built_in,
        patch.is_published ?? current.is_published,
        nextSchema,
      ],
    );

    const template = created.rows[0] as Record<string, unknown>;
    await this.deps.eventService.emit({
      tenantId: identity.tenantId,
      type: 'template.updated',
      entityType: 'template',
      entityId: template.id as string,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        slug: template.slug,
        version: template.version,
        previous_template_id: templateId,
        previous_version: current.version,
      },
    });

    return this.deps.toTemplateResponse(template);
  }

  async softDeleteTemplate(identity: ApiKeyIdentity, templateId: string) {
    const activePipelines = await this.deps.pool.query(
      `SELECT id FROM pipelines
       WHERE tenant_id = $1 AND template_id = $2 AND state IN ('pending','active','paused')
       LIMIT 1`,
      [identity.tenantId, templateId],
    );
    if (activePipelines.rowCount) throw new ConflictError('Cannot delete template while active pipelines exist');

    const result = await this.deps.pool.query(
      `UPDATE templates
       SET deleted_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [identity.tenantId, templateId],
    );

    if (!result.rowCount) throw new NotFoundError('Template not found');

    const template = result.rows[0] as Record<string, unknown>;
    await this.deps.eventService.emit({
      tenantId: identity.tenantId,
      type: 'template.deleted',
      entityType: 'template',
      entityId: template.id as string,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { slug: template.slug, version: template.version },
    });

    return this.deps.toTemplateResponse(template);
  }
}
