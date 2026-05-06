import { store, applyTick, resetStore, addEvent, type SchedulerPolicy } from '../store';

export async function GET() {
  const sim = store.simulation;
  if (sim.isPlaying) {
    const now = Date.now();
    const elapsed = Math.max(0, now - sim.lastTickAt);
    const ticks = Math.floor(elapsed / 1000);
    if (ticks > 0) {
      for (let i = 0; i < ticks; i++) applyTick();
      sim.lastTickAt = now;
    }
  }
  return {
    tick: sim.tick,
    isPlaying: sim.isPlaying,
    policy: sim.policy,
    rrQuantum: sim.rrQuantum,
    currentPid: sim.currentPid,
    deadlockedPids: sim.deadlockedPids,
    wfgCycles: sim.wfgCycles,
    bankersResult: sim.bankersResult,
    processes: store.processes,
    resources: store.resources,
  };
}

export async function POST(body: {
  action?: 'play' | 'pause' | 'step' | 'reset';
  policy?: SchedulerPolicy;
  rrQuantum?: number;
}) {
  const sim = store.simulation;
  const { action, policy, rrQuantum } = body;

  if (policy) {
    sim.policy = policy;
    addEvent('SYSTEM', 'info', `Scheduler policy changed to ${policy}`);
  }
  if (rrQuantum && rrQuantum > 0) {
    sim.rrQuantum = rrQuantum;
    addEvent('SYSTEM', 'info', `RR quantum set to ${rrQuantum}`);
  }

  switch (action) {
    case 'play':
      sim.isPlaying = true;
      sim.lastTickAt = Date.now();
      addEvent('SYSTEM', 'info', 'Simulation started.');
      break;
    case 'pause':
      sim.isPlaying = false;
      addEvent('SYSTEM', 'info', 'Simulation paused.');
      break;
    case 'step':
      applyTick();
      sim.lastTickAt = Date.now();
      break;
    case 'reset':
      resetStore();
      break;
    default:
      if (!policy && !rrQuantum) throw new Error('Invalid action');
  }

  return {
    tick: sim.tick,
    isPlaying: sim.isPlaying,
    policy: sim.policy,
    rrQuantum: sim.rrQuantum,
    currentPid: sim.currentPid,
    deadlockedPids: sim.deadlockedPids,
    wfgCycles: sim.wfgCycles,
    bankersResult: sim.bankersResult,
    processes: store.processes,
    resources: store.resources,
  };
}
