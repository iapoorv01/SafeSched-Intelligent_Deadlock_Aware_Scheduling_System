import { store, mulberry32, addEvent, resetStore, applyTick } from '../store';

export async function GET() {
  return {
    seed: store.replaySeed,
    replayLog: store.replayLog.slice(0, 100),
  };
}

export async function POST(body: { seed?: number; steps?: number }) {
  const seed = Number.isFinite(body.seed) ? Number(body.seed) : 42;
  const steps = Math.min(Number.isFinite(body.steps) ? Number(body.steps) : 15, 50);

  // Reset to clean state
  resetStore();
  store.replaySeed = seed;
  store.simulation.isPlaying = false;

  const rng = mulberry32(seed);

  // Seed the request queue with deterministic requests
  const pids = store.processes.map(p => p.pid);
  const numR = store.resources.length;

  for (let i = 0; i < steps; i++) {
    const pid = pids[Math.floor(rng() * pids.length)];
    const resourceIdx = Math.floor(rng() * numR);
    const amount = Math.floor(rng() * 3) + 1;
    const priority = Math.floor(rng() * 5);

    store.requestQueue.push({
      id: `replay-${i}`,
      pid,
      resourceIdx,
      amount,
      enqueuedAt: i,
      priority,
    });
  }

  // Run ticks
  for (let i = 0; i < steps; i++) {
    applyTick();
  }

  // Freeze the event log as replay log
  store.replayLog = [...store.eventLog];

  addEvent('SYSTEM', 'info', `Deterministic replay loaded: seed=${seed}, steps=${steps}`);

  return {
    seed,
    steps: store.simulation.tick,
    replayLog: store.replayLog.slice(0, 100),
    processes: store.processes,
    resources: store.resources,
    deadlockedPids: store.simulation.deadlockedPids,
    bankersResult: store.simulation.bankersResult,
  };
}
