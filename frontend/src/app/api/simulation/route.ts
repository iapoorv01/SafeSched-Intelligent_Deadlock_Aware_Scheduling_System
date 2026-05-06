import { NextRequest, NextResponse } from 'next/server';

// In-memory simulation state for demo (replace with persistent or backend logic as needed)
let simulationStep = 0;
let isPlaying = false;

export async function GET() {
  // Return current simulation state
  return NextResponse.json({ step: simulationStep, isPlaying });
}

export async function POST(req: NextRequest) {
  const { action } = await req.json();
  switch (action) {
    case 'play':
      isPlaying = true;
      break;
    case 'pause':
      isPlaying = false;
      break;
    case 'step':
      simulationStep += 1;
      break;
    case 'reset':
      simulationStep = 0;
      isPlaying = false;
      break;
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
  return NextResponse.json({ step: simulationStep, isPlaying });
}
