import { NextResponse } from 'next/server';

// Example analytics data (replace with real simulation metrics as needed)
const analytics = {
  steps: 12,
  grants: 8,
  denials: 2,
  deadlocks: 1,
  recoveries: 1,
  checkpoints: 3,
};

export async function GET() {
  // Return current analytics/metrics
  return NextResponse.json(analytics);
}
