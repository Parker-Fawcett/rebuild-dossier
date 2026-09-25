import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../src/app/api/health/route.js';

describe("GET /api/health", () => {
  it('responds without crashing (from-repo contract)', async () => {
    const request = new NextRequest('http://localhost:3000/api/health', { method: 'GET' });
    const res = await GET(request, { params: {} });
    expect(res.status).toBeLessThan(500);
  });
});
