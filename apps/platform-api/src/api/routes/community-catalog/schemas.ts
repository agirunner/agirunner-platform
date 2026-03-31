import { z } from 'zod';

export const communityCatalogImportPreviewSchema = z.object({
  playbook_ids: z.array(z.string().min(1)).min(1),
});

export const communityCatalogImportSchema = z.object({
  playbook_ids: z.array(z.string().min(1)).min(1),
  default_conflict_resolution: z.enum(['create_new', 'override_existing']).optional(),
  conflict_resolutions: z.record(z.enum(['create_new', 'override_existing'])).optional(),
});

export function parseOrThrow<T>(schema: z.ZodSchema<T>, value: unknown): T {
  return schema.parse(value);
}
