import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE } from '../../src/app/api/listings/[id]/route.js';

describe("DELETE /api/listings/:id", () => {
  it('responds without crashing (from-repo contract)', async () => {
    const request = new NextRequest('http://localhost:3000/api/listings/test-value-123', { method: 'DELETE' });
    const res = await DELETE(request, { params: { id: 'test-value-123' } });
    expect(res.status).toBeLessThan(500);
  });
});
