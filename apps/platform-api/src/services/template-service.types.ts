export interface CreateTemplateInput {
  name: string;
  slug: string;
  description?: string;
  schema: unknown;
  is_published?: boolean;
}

export interface UpdateTemplateInput {
  name?: string;
  slug?: string;
  description?: string;
  schema?: unknown;
  is_published?: boolean;
}

export interface ListTemplateQuery {
  q?: string;
  slug?: string;
  is_built_in?: boolean;
  latest_only?: boolean;
  page: number;
  per_page: number;
}
