import { NextResponse } from 'next/server';

// Example static RAG/WFG graph data (replace with real simulation state as needed)
const graphData = {
  nodes: [
    { id: 'P1', label: 'P1', type: 'process', x: 120, y: 200, active: true },
    { id: 'P2', label: 'P2', type: 'process', x: 320, y: 100 },
    { id: 'P3', label: 'P3', type: 'process', x: 320, y: 300, deadlocked: true },
    { id: 'R1', label: 'R1', type: 'resource', x: 520, y: 200 },
  ],
  edges: [
    { source: 'P1', target: 'R1', type: 'request' },
    { source: 'R1', target: 'P3', type: 'allocation' },
    { source: 'P2', target: 'R1', type: 'request' },
  ],
};

export async function GET() {
  // Return current graph data
  return NextResponse.json(graphData);
}
