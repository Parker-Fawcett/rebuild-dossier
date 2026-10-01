import { NextResponse } from 'next/server';

// Constant-200 baseline: exports every method the suites import, does nothing.
export async function DELETE() {
  return NextResponse.json({}, { status: 200 });
}
export async function GET() {
  return NextResponse.json({}, { status: 200 });
}
export async function PUT() {
  return NextResponse.json({}, { status: 200 });
}
