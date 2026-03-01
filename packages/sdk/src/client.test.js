import { describe, expect, it, vi } from 'vitest';
import { PlatformApiClient } from './client.js';
describe('PlatformApiClient', () => {
    it('returns null when claim endpoint responds with 204', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(undefined, {
            status: 204,
        }));
        const client = new PlatformApiClient({
            baseUrl: 'http://localhost:8080',
            accessToken: 'jwt-token',
            fetcher,
        });
        const task = await client.claimTask({
            agent_id: 'agent-id',
            capabilities: [],
        });
        expect(task).toBeNull();
    });
    it('includes auth header for authenticated requests', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: {
                id: 'task-1',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        const client = new PlatformApiClient({
            baseUrl: 'http://localhost:8080',
            accessToken: 'jwt-token',
            fetcher,
        });
        await client.getTask('task-1');
        const [, options] = vi.mocked(fetcher).mock.calls[0];
        const headers = options?.headers;
        expect(headers.Authorization).toBe('Bearer jwt-token');
    });
    it.each([401, 403, 404, 500])('throws PlatformApiError for HTTP %s responses', async (statusCode) => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'failure' }), {
            status: statusCode,
            headers: { 'Content-Type': 'application/json' },
        }));
        const client = new PlatformApiClient({
            baseUrl: 'http://localhost:8080',
            accessToken: 'jwt-token',
            fetcher,
        });
        await expect(client.getTask('task-1')).rejects.toMatchObject({
            name: 'PlatformApiError',
            status: statusCode,
        });
    });
    it('paginates through all pages using helper', async () => {
        const client = new PlatformApiClient({
            baseUrl: 'http://localhost:8080',
            accessToken: 'jwt-token',
            fetcher: vi.fn(),
        });
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({
            data: [{ id: 'a' }, { id: 'b' }],
            pagination: { page: 1, per_page: 2, total: 3, total_pages: 2 },
        })
            .mockResolvedValueOnce({
            data: [{ id: 'c' }],
            pagination: { page: 2, per_page: 2, total: 3, total_pages: 2 },
        });
        const rows = await client.paginate(fetchPage, { perPage: 2 });
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(fetchPage).toHaveBeenNthCalledWith(1, { page: 1, per_page: 2 });
        expect(fetchPage).toHaveBeenNthCalledWith(2, { page: 2, per_page: 2 });
        expect(rows).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    });
});
