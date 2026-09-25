import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../src/app/api/portfolios/[id]/items/route.js';

describe("POST /api/portfolios/:id/items", () => {
  it('responds without crashing (from-repo contract)', async () => {
    const request = new NextRequest('http://localhost:3000/api/portfolios/test-value-123/items', { method: 'POST' });
    const res = await POST(request, { params: { id: 'test-value-123' } });
    expect(res.status).toBeLessThan(500);
  });
});
