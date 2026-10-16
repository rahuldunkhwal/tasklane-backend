import { describe, expect, it } from 'vitest';
import { client } from './helpers.js';

// Smoke test for the harness itself: the app boots and talks to the in-memory MongoDB.
describe('GET /api/health', () => {
  it('reports the API and the database as up', async () => {
    const res = await client().get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('answers unknown routes with the JSON 404 envelope, not HTML', async () => {
    const res = await client().get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
