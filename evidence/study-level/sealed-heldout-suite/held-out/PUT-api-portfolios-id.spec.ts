import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { PUT } from '../../src/app/api/portfolios/[id]/route.js';

describe("PUT /api/portfolios/:id", () => {
  it('responds without crashing (from-repo contract)', async () => {
    const request = new NextRequest('http://localhost:3000/api/portfolios/test-value-123', { method: 'PUT' });
    const res = await PUT(request, { params: { id: 'test-value-123' } });
    expect(res.status).toBeLessThan(500);
  });
});
