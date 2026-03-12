import { describe, expect, it, vi } from 'vitest';
import { RegistryClient } from '../client.js';
import { RegistryApiError } from '../errors.js';

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('RegistryClient', () => {
  const BASE = 'https://api.test';

  it('searchListings sends correct query params', async () => {
    const fetchMock = mockFetch(200, { items: [], page: 1, per_page: 20, total: 0 });
    const client = new RegistryClient({ baseUrl: BASE, fetch: fetchMock });

    const result = await client.searchListings({ q: 'coder', kind: 'employee', page: 2 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/market/search?'),
      expect.objectContaining({ method: 'GET' }),
    );
    const calledUrl = (fetchMock as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('q=coder');
    expect(calledUrl).toContain('kind=employee');
    expect(calledUrl).toContain('page=2');
    expect(result.total).toBe(0);
  });

  it('getListingDetail fetches by ID', async () => {
    const detail = { listing_id: 'abc', title: 'Test' };
    const fetchMock = mockFetch(200, detail);
    const client = new RegistryClient({ baseUrl: BASE, fetch: fetchMock });

    const result = await client.getListingDetail('abc');
    expect(result.listing_id).toBe('abc');
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/v1/market/listings/abc`, expect.any(Object));
  });

  it('includes auth header when token provided', async () => {
    const fetchMock = mockFetch(200, { items: [] });
    const client = new RegistryClient({ baseUrl: BASE, authToken: 'tok123', fetch: fetchMock });

    await client.getMyLibrary();
    const headers = (fetchMock as any).mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer tok123');
  });

  it('throws RegistryApiError on non-2xx', async () => {
    const fetchMock = mockFetch(404, {
      error: { code: 'NOT_FOUND', message: 'Listing not found' },
    });
    const client = new RegistryClient({ baseUrl: BASE, fetch: fetchMock });

    await expect(client.getListingDetail('missing')).rejects.toThrow(RegistryApiError);
    await expect(client.getListingDetail('missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('createPublishDraft sends POST with body', async () => {
    const draft = { draft_id: 'd1', status: 'draft' };
    const fetchMock = mockFetch(201, draft);
    const client = new RegistryClient({ baseUrl: BASE, authToken: 'tok', fetch: fetchMock });

    await client.createPublishDraft({ kind: 'employee', title: 'My Agent' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/v1/publish/drafts`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"kind":"employee"'),
      }),
    );
  });
});
