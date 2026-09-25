import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { PUT } from '../../src/app/api/portfolios/[id]/items/[itemId]/route.js';

describe("PUT /api/portfolios/:id/items/:itemId", () => {
  it('responds without crashing (from-repo contract)', async () => {
    const request = new NextRequest('http://localhost:3000/api/portfolios/test-value-123/items/test-value-123', { method: 'PUT' });
    const res = await PUT(request, { params: { id: 'test-value-123', itemId: 'test-value-123' } });
    expect(res.status).toBeLessThan(500);
  });
});
