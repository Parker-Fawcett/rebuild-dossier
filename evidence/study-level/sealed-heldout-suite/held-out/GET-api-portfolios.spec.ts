import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../src/app/api/portfolios/route.js';

describe("GET /api/portfolios", () => {
  it('responds without crashing (from-repo contract)', async () => {
    const request = new NextRequest('http://localhost:3000/api/portfolios', { method: 'GET' });
    const res = await GET(request, { params: {} });
    expect(res.status).toBeLessThan(500);
  });
});
