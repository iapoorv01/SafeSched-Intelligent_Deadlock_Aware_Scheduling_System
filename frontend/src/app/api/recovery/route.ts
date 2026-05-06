import { store, computeVictimCosts, addEvent, snapshotCheckpoint, runBankers } from '../store';

export async function GET() {
  const victims = computeVictimCosts();
  return {
    deadlockedPids: store.simulation.deadlockedPids,
    wfgCycles: store.simulation.wfgCycles,
    suggestedVictim: victims[0]?.pid ?? null,
    victims,
    checkpoints: store.checkpoints.slice(0, 5).map(cp => ({
      id: cp.id,
      tick: cp.tick,
      description: cp.description,
      ts: cp.ts,
    })),
  };
}

export async function POST(body: { action?: 'apply' | 'rollback' | 'restore'; victim?: string; checkpointId?: string }) {
  const { action, victim, checkpointId } = body;

  if (action === 'apply' && victim) {
    const proc = store.processes.find(p => p.pid === victim);
    if (!proc) throw new Error(`Process ${victim} not found`);

    snapshotCheckpoint(`Pre-preemption of ${victim} at tick ${store.simulation.tick}`);

    // Release all resources held by victim
    for (let j = 0; j < proc.allocation.length; j++) {
      store.resources[j].available += proc.allocation[j];
      proc.allocation[j] = 0;
    }
    proc.need = [...proc.max];
    proc.status = 'WAITING';
    proc.rollbackCount += 1;

    // Remove victim's pending requests
    store.requestQueue = store.requestQueue.filter(r => r.pid !== victim);

    // Re-run deadlock detection
    const { buildWFG, detectCycles } = await import('../store');
    const wfg = buildWFG();
    const cycles = detectCycles(wfg);
    store.simulation.wfgCycles = cycles;
    store.simulation.deadlockedPids = [...new Set(cycles.flat())];
    store.simulation.bankersResult = runBankers();
    store.simulation.lastRecoveryTick = store.simulation.tick;
    store.analytics.recoveriesApplied += 1;

    addEvent('RECOVERY', 'warn', `Recovery: preempted ${victim}, resources released`, { victim, tick: store.simulation.tick });
    return { success: true, deadlockedPids: store.simulation.deadlockedPids };
  }

  if (action === 'rollback') {
    // Rollback to most recent checkpoint
    const cp = store.checkpoints[0];
    if (!cp) throw new Error('No checkpoint available for rollback');

    store.processes = JSON.parse(JSON.stringify(cp.processes));
    store.resources = JSON.parse(JSON.stringify(cp.resources));
    store.requestQueue = JSON.parse(JSON.stringify(cp.requestQueue));
    store.simulation.tick = cp.tick;
    store.simulation.deadlockedPids = [];
    store.simulation.wfgCycles = [];
    store.simulation.bankersResult = runBankers();
    store.analytics.recoveriesApplied += 1;

    addEvent('ROLLBACK', 'warn', `Rolled back to checkpoint: ${cp.description} (tick ${cp.tick})`);
    return { success: true, restoredTick: cp.tick };
  }

  if (action === 'restore' && checkpointId) {
    const cp = store.checkpoints.find(c => c.id === checkpointId);
    if (!cp) throw new Error(`Checkpoint ${checkpointId} not found`);

    store.processes = JSON.parse(JSON.stringify(cp.processes));
    store.resources = JSON.parse(JSON.stringify(cp.resources));
    store.requestQueue = JSON.parse(JSON.stringify(cp.requestQueue));
    store.simulation.tick = cp.tick;
    store.simulation.deadlockedPids = [];
    store.simulation.wfgCycles = [];
    store.simulation.bankersResult = runBankers();
    store.analytics.recoveriesApplied += 1;

    addEvent('ROLLBACK', 'warn', `Restored checkpoint: ${cp.description} (tick ${cp.tick})`);
    return { success: true, restoredTick: cp.tick };
  }

  throw new Error('Invalid recovery action');
}
