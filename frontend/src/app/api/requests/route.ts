import { store, addEvent } from '../store';

type RequestBody = {
  pid: string;
  resourceIdx: number;
  amount: number;
  priority?: number;
};

export async function GET() {
  return { queue: store.requestQueue };
}

export async function POST(body: RequestBody) {
  const { pid, resourceIdx, amount, priority = 0 } = body;

  if (!pid || resourceIdx === undefined || amount <= 0) {
    throw new Error('Invalid request: pid, resourceIdx, and amount > 0 required.');
  }

  const proc = store.processes.find(p => p.pid === pid);
  if (!proc) throw new Error(`Process ${pid} not found`);
  if (proc.status === 'TERMINATED') throw new Error(`Process ${pid} is terminated`);

  const r = store.resources[resourceIdx];
  if (!r) throw new Error(`Resource index ${resourceIdx} not found`);

  // Validate against max demand
  const currentAlloc = proc.allocation[resourceIdx] ?? 0;
  const maxDemand = proc.max[resourceIdx] ?? 0;
  if (currentAlloc + amount > maxDemand) {
    throw new Error(`Request exceeds max demand for ${pid} on ${r.label}`);
  }

  const entry = {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    pid,
    resourceIdx,
    amount,
    enqueuedAt: store.simulation.tick,
    priority,
  };

  store.requestQueue.push(entry);
  proc.status = 'WAITING';

  addEvent('REQUEST', 'info', `Request queued: ${pid} wants ${amount} of ${r.label}`, {
    pid, resource: r.id, amount, priority,
  });

  return { queue: store.requestQueue };
}

export async function DELETE() {
  store.requestQueue = [];
  addEvent('SYSTEM', 'info', 'Request queue cleared.');
  return { queue: [] };
}
