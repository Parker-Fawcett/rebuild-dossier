import { NextResponse } from 'next/server';

// Constant-200 baseline: exports every method the suites import, does nothing.
export async function POST() {
  return NextResponse.json({}, { status: 200 });
}
