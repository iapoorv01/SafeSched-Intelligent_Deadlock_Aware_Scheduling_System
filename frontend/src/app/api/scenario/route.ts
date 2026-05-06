import { NextRequest, NextResponse } from 'next/server';

// In-memory scenario store (replace with persistent storage as needed)
let currentScenario: any = null;

export async function GET() {
  // Return the current scenario (or null)
  return NextResponse.json(currentScenario);
}

export async function POST(req: NextRequest) {
  // Save a new scenario
  const scenario = await req.json();
  currentScenario = scenario;
  return NextResponse.json({ success: true });
}

export async function DELETE() {
  // Reset the scenario
  currentScenario = null;
  return NextResponse.json({ success: true });
}
