export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
  includeAuth?: boolean;
  allowNoContent?: boolean;
}

export interface ClientTransport {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  withQuery(path: string, query: Query): string;
}
