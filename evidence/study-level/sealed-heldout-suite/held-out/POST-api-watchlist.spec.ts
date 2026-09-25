import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../src/app/api/watchlist/route.js';

describe("POST /api/watchlist", () => {
  it('responds without crashing (from-repo contract)', async () => {
    const request = new NextRequest('http://localhost:3000/api/watchlist', { method: 'POST' });
    const res = await POST(request, { params: {} });
    expect(res.status).toBeLessThan(500);
  });
});
