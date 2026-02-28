import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import type { CreateTemplateInput, ListTemplateQuery, UpdateTemplateInput } from './template-service.types.js';
import { TemplateWriteService } from './template-write-service.js';

export class TemplateService {
  private readonly writeService: TemplateWriteService;

  constructor(private readonly pool: DatabasePool, eventService: EventService) {
    this.writeService = new TemplateWriteService({
      pool,
      eventService,
      getTemplateOrThrow: this.getTemplateOrThrow.bind(this),
      toTemplateResponse: this.toTemplateResponse.bind(this),
    });
  }

  private toTemplateResponse(row: Record<string, unknown>) {
    return { ...row, deleted_at: row.deleted_at ?? null };
  }

  private async getTemplateOrThrow(tenantId: string, templateId: string) {
    const result = await this.pool.query(`SELECT * FROM templates WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [
      tenantId,
      templateId,
    ]);
    if (!result.rowCount) throw new NotFoundError('Template not found');
    return result.rows[0] as Record<string, unknown>;
  }

  createTemplate(identity: ApiKeyIdentity, input: CreateTemplateInput) {
    return this.writeService.createTemplate(identity, input);
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
      `SELECT * FROM templates WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    const total = Number(totalRes.rows[0].total);
    return {
      data: dataRes.rows.map((row) => this.toTemplateResponse(row as Record<string, unknown>)),
      meta: { total, page: query.page, per_page: query.per_page, pages: Math.ceil(total / query.per_page) || 1 },
    };
  }

  async getTemplate(tenantId: string, templateId: string) {
    return this.toTemplateResponse(await this.getTemplateOrThrow(tenantId, templateId));
  }

  updateTemplate(identity: ApiKeyIdentity, templateId: string, patch: UpdateTemplateInput) {
    return this.writeService.updateTemplate(identity, templateId, patch);
  }

  softDeleteTemplate(identity: ApiKeyIdentity, templateId: string) {
    return this.writeService.softDeleteTemplate(identity, templateId);
  }
}
