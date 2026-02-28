import type { Pool } from 'pg';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { validateTemplateSchema } from '../orchestration/pipeline-engine.js';
import { EventService } from './event-service.js';

interface CreateTemplateInput {
  name: string;
  slug: string;
  description?: string;
  schema: unknown;
  is_published?: boolean;
}

interface UpdateTemplateInput {
  name?: string;
  slug?: string;
  description?: string;
  schema?: unknown;
  is_published?: boolean;
}

interface ListTemplateQuery {
  q?: string;
  slug?: string;
  is_built_in?: boolean;
  page: number;
  per_page: number;
}

export class TemplateService {
  constructor(
    private readonly pool: Pool,
    private readonly eventService: EventService,
  ) {}

  private toTemplateResponse(row: Record<string, unknown>) {
    return {
      ...row,
      deleted_at: row.deleted_at ?? null,
    };
  }

  async createTemplate(identity: ApiKeyIdentity, input: CreateTemplateInput) {
    const schema = validateTemplateSchema(input.schema);

    const existing = await this.pool.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version
       FROM templates
       WHERE tenant_id = $1 AND slug = $2`,
      [identity.tenantId, input.slug],
    );

    const nextVersion = Number(existing.rows[0].max_version) + 1;

    const result = await this.pool.query(
      `INSERT INTO templates (tenant_id, name, slug, description, version, is_built_in, is_published, schema)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)
       RETURNING *`,
      [
        identity.tenantId,
        input.name,
        input.slug,
        input.description ?? null,
        nextVersion,
        input.is_published ?? false,
        schema,
      ],
    );

    const template = result.rows[0];

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'template.created',
      entityType: 'template',
      entityId: template.id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { slug: template.slug, version: template.version },
    });

    return this.toTemplateResponse(template);
  }

  async listTemplates(tenantId: string, query: ListTemplateQuery) {
    const where: string[] = ['tenant_id = $1', 'deleted_at IS NULL'];
    const values: unknown[] = [tenantId];

    if (query.slug) {
      values.push(query.slug);
      where.push(`slug = $${values.length}`);
    }
    if (query.q) {
      values.push(`%${query.q}%`);
      where.push(`(name ILIKE $${values.length} OR slug ILIKE $${values.length})`);
    }
    if (query.is_built_in !== undefined) {
      values.push(query.is_built_in);
      where.push(`is_built_in = $${values.length}`);
    }

    const offset = (query.page - 1) * query.per_page;
    const whereClause = where.join(' AND ');

    const totalRes = await this.pool.query(`SELECT COUNT(*)::int AS total FROM templates WHERE ${whereClause}`, values);
    values.push(query.per_page, offset);

    const dataRes = await this.pool.query(
      `SELECT * FROM templates
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    const total = Number(totalRes.rows[0].total);
    return {
      data: dataRes.rows.map((row) => this.toTemplateResponse(row)),
      meta: {
        total,
        page: query.page,
        per_page: query.per_page,
        pages: Math.ceil(total / query.per_page) || 1,
      },
    };
  }

  async getTemplate(tenantId: string, templateId: string) {
    const result = await this.pool.query(
      `SELECT * FROM templates WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, templateId],
    );

    if (!result.rowCount) {
      throw new NotFoundError('Template not found');
    }

    return this.toTemplateResponse(result.rows[0]);
  }

  async updateTemplate(identity: ApiKeyIdentity, templateId: string, patch: UpdateTemplateInput) {
    const existing = await this.pool.query(
      `SELECT * FROM templates WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [identity.tenantId, templateId],
    );

    if (!existing.rowCount) {
      throw new NotFoundError('Template not found');
    }

    const current = existing.rows[0];
    const nextSlug = patch.slug ?? (current.slug as string);
    const nextSchema = patch.schema ? validateTemplateSchema(patch.schema) : current.schema;

    const versionRes = await this.pool.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version
       FROM templates
       WHERE tenant_id = $1 AND slug = $2`,
      [identity.tenantId, nextSlug],
    );

    const nextVersion = Number(versionRes.rows[0].max_version) + 1;

    const created = await this.pool.query(
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

    const template = created.rows[0];
    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'template.updated',
      entityType: 'template',
      entityId: template.id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        slug: template.slug,
        version: template.version,
        previous_template_id: templateId,
        previous_version: current.version,
      },
    });

    return this.toTemplateResponse(template);
  }

  async softDeleteTemplate(identity: ApiKeyIdentity, templateId: string) {
    const activePipelines = await this.pool.query(
      `SELECT id FROM pipelines
       WHERE tenant_id = $1 AND template_id = $2 AND state IN ('pending','active','paused')
       LIMIT 1`,
      [identity.tenantId, templateId],
    );

    if (activePipelines.rowCount) {
      throw new ConflictError('Cannot delete template while active pipelines exist');
    }

    const result = await this.pool.query(
      `UPDATE templates
       SET deleted_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [identity.tenantId, templateId],
    );

    if (!result.rowCount) {
      throw new NotFoundError('Template not found');
    }

    const template = result.rows[0];
    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'template.deleted',
      entityType: 'template',
      entityId: template.id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { slug: template.slug, version: template.version },
    });

    return this.toTemplateResponse(template);
  }
}
