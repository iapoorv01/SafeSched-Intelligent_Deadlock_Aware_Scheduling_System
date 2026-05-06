// ============================================================
// SafeSched — In-Memory API Store (Industry-Grade Engine)
// ============================================================

export type SchedulerPolicy = 'FCFS' | 'RR' | 'PRIORITY' | 'PRIORITY_AGING';

export type ProcessRecord = {
  pid: string;
  allocation: number[];
  max: number[];
  need: number[];
  status: 'RUNNING' | 'WAITING' | 'BLOCKED' | 'TERMINATED';
  priority: number;
  age: number;
  waitTicks: number;
  rollbackCount: number;
  criticality: number;
};

export type ResourceRecord = {
  id: string;
  label: string;
  total: number;
  available: number;
  type: 'CPU' | 'MEMORY' | 'IO' | 'NETWORK' | 'GENERIC';
};

export type RequestEntry = {
  id: string;
  pid: string;
  resourceIdx: number;
  amount: number;
  enqueuedAt: number;
  priority: number;
};

export type EventSnapshot = {
  id: string;
  tick: number;
  ts: number;
  level: 'info' | 'warn' | 'error';
  type: 'REQUEST' | 'GRANT' | 'DENY' | 'RELEASE' | 'DEADLOCK' | 'RECOVERY' | 'CHECKPOINT' | 'ROLLBACK' | 'SYSTEM';
  message: string;
  details?: Record<string, unknown>;
};

export type WFGCycle = string[];

export type BankersStep = {
  pid: string;
  workBefore: number[];
  need: number[];
  allocation: number[];
  workAfter: number[];
};

export type BankersResult = {
  safe: boolean;
  safeSequence: string[];
  steps: BankersStep[];
};

export type RecoveryVictim = {
  pid: string;
  cost: number;
  costBreakdown: Record<string, number>;
  impact: 'low' | 'medium' | 'high';
};

export type CheckpointRecord = {
  id: string;
  tick: number;
  ts: number;
  description: string;
  processes: ProcessRecord[];
  resources: ResourceRecord[];
  requestQueue: RequestEntry[];
};

export type SimulationState = {
  tick: number;
  isPlaying: boolean;
  lastTickAt: number;
  policy: SchedulerPolicy;
  rrQuantum: number;
  rrCounter: number;
  currentPid: string | null;
  deadlockedPids: string[];
  wfgCycles: WFGCycle[];
  bankersResult: BankersResult | null;
  lastRecoveryTick: number;
};

export type AnalyticsState = {
  ticks: number;
  grants: number;
  denials: number;
  deadlocksDetected: number;
  recoveriesApplied: number;
  checkpointsCreated: number;
  avgWaitTicks: number;
  throughput: number;
  terminatedCount: number;
};

// ---- Seed-based PRNG (Mulberry32) ----
export function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Default scenario factory ----
function makeDefaultProcesses(numR: number): ProcessRecord[] {
  const data: Array<[string, number[], number[], 'RUNNING' | 'WAITING' | 'BLOCKED' | 'TERMINATED', number, number]> = [
    ['P0', [0, 1], [7, 5], 'RUNNING',  2, 1],
    ['P1', [2, 0], [3, 2], 'WAITING',  1, 0],
    ['P2', [3, 0], [9, 0], 'WAITING',  0, 2],
    ['P3', [2, 1], [2, 2], 'BLOCKED',  3, 1],
    ['P4', [0, 0], [4, 3], 'WAITING',  1, 0],
  ];
  return data.map(([pid, alloc, max, status, priority, criticality]) => ({
    pid,
    allocation: alloc.slice(0, numR),
    max: max.slice(0, numR),
    need: max.slice(0, numR).map((m, i) => m - alloc[i]),
    status,
    priority,
    age: 0,
    waitTicks: 0,
    rollbackCount: 0,
    criticality,
  }));
}

function makeDefaultResources(): ResourceRecord[] {
  return [
    { id: 'R0', label: 'CPU',    total: 10, available: 3, type: 'CPU' },
    { id: 'R1', label: 'Memory', total: 7,  available: 3, type: 'MEMORY' },
  ];
}

// ---- Store ----
export type InMemoryStore = {
  simulation: SimulationState;
  analytics: AnalyticsState;
  processes: ProcessRecord[];
  resources: ResourceRecord[];
  requestQueue: RequestEntry[];
  eventLog: EventSnapshot[];
  checkpoints: CheckpointRecord[];
  replaySeed: number | null;
  replayLog: EventSnapshot[];
};

export const store: InMemoryStore = {
  simulation: {
    tick: 0,
    isPlaying: false,
    lastTickAt: Date.now(),
    policy: 'FCFS',
    rrQuantum: 3,
    rrCounter: 0,
    currentPid: 'P0',
    deadlockedPids: [],
    wfgCycles: [],
    bankersResult: null,
    lastRecoveryTick: -1,
  },
  analytics: {
    ticks: 0,
    grants: 0,
    denials: 0,
    deadlocksDetected: 0,
    recoveriesApplied: 0,
    checkpointsCreated: 0,
    avgWaitTicks: 0,
    throughput: 0,
    terminatedCount: 0,
  },
  processes: makeDefaultProcesses(2),
  resources: makeDefaultResources(),
  requestQueue: [],
  eventLog: [],
  checkpoints: [],
  replaySeed: null,
  replayLog: [],
};

// ---- Helpers ----
export function addEvent(
  type: EventSnapshot['type'],
  level: EventSnapshot['level'],
  message: string,
  details?: Record<string, unknown>
): void {
  const ev: EventSnapshot = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tick: store.simulation.tick,
    ts: Date.now(),
    level,
    type,
    message,
    details,
  };
  store.eventLog.unshift(ev);
  if (store.eventLog.length > 500) store.eventLog.length = 500;
}

export function snapshotCheckpoint(description: string): void {
  const cp: CheckpointRecord = {
    id: `cp-${Date.now()}`,
    tick: store.simulation.tick,
    ts: Date.now(),
    description,
    processes: JSON.parse(JSON.stringify(store.processes)),
    resources: JSON.parse(JSON.stringify(store.resources)),
    requestQueue: JSON.parse(JSON.stringify(store.requestQueue)),
  };
  store.checkpoints.unshift(cp);
  if (store.checkpoints.length > 20) store.checkpoints.length = 20;
  store.analytics.checkpointsCreated += 1;
  addEvent('CHECKPOINT', 'info', `Checkpoint: ${description} (tick ${store.simulation.tick})`);
}

// ---- Banker's Algorithm ----
export function runBankers(): BankersResult {
  const procs = store.processes.filter(p => p.status !== 'TERMINATED');
  const work = store.resources.map(r => r.available);
  const finish: boolean[] = procs.map(() => false);
  const safeSeq: string[] = [];
  const steps: BankersStep[] = [];

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < procs.length; i++) {
      if (finish[i]) continue;
      const canRun = procs[i].need.every((n, j) => n <= (work[j] ?? 0));
      if (canRun) {
        steps.push({
          pid: procs[i].pid,
          workBefore: [...work],
          need: [...procs[i].need],
          allocation: [...procs[i].allocation],
          workAfter: work.map((w, j) => w + procs[i].allocation[j]),
        });
        for (let j = 0; j < work.length; j++) work[j] += procs[i].allocation[j];
        finish[i] = true;
        safeSeq.push(procs[i].pid);
        changed = true;
      }
    }
  }

  const safe = finish.every(Boolean);
  return { safe, safeSequence: safe ? safeSeq : [], steps };
}

// ---- Wait-For Graph + Cycle Detection ----
export function buildWFG(): Record<string, string[]> {
  const wfg: Record<string, string[]> = {};
  for (const p of store.processes) wfg[p.pid] = [];

  for (const req of store.requestQueue) {
    const r = req.resourceIdx;
    if (r >= store.resources.length) continue;
    if (req.amount > store.resources[r].available) {
      for (const p of store.processes) {
        if (p.pid !== req.pid && p.allocation[r] > 0) {
          if (!wfg[req.pid]) wfg[req.pid] = [];
          if (!wfg[req.pid].includes(p.pid)) wfg[req.pid].push(p.pid);
        }
      }
    }
  }
  return wfg;
}

export function detectCycles(wfg: Record<string, string[]>): WFGCycle[] {
  const cycles: WFGCycle[] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recStack.add(node);
    for (const neighbor of wfg[node] ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path, neighbor]);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        const cycle = cycleStart >= 0 ? path.slice(cycleStart) : [...path, neighbor];
        const key = [...cycle].sort().join(',');
        if (!cycles.some(c => [...c].sort().join(',') === key)) {
          cycles.push(cycle);
        }
      }
    }
    recStack.delete(node);
  }

  for (const node of Object.keys(wfg)) {
    if (!visited.has(node)) dfs(node, [node]);
  }
  return cycles;
}

// ---- Resource Allocation Graph ----
export function buildRAG() {
  const nodes: Array<{ id: string; label: string; type: 'process' | 'resource'; status?: string; deadlocked?: boolean }> = [];
  const edges: Array<{ source: string; target: string; type: 'allocation' | 'request' }> = [];
  const deadSet = new Set(store.simulation.deadlockedPids);

  for (const p of store.processes) {
    nodes.push({ id: p.pid, label: p.pid, type: 'process', status: p.status, deadlocked: deadSet.has(p.pid) });
  }
  for (const r of store.resources) {
    nodes.push({ id: r.id, label: r.label, type: 'resource' });
  }
  for (const p of store.processes) {
    for (let j = 0; j < p.allocation.length; j++) {
      if (p.allocation[j] > 0) {
        edges.push({ source: store.resources[j]?.id ?? `R${j}`, target: p.pid, type: 'allocation' });
      }
    }
  }
  for (const req of store.requestQueue) {
    const rId = store.resources[req.resourceIdx]?.id ?? `R${req.resourceIdx}`;
    edges.push({ source: req.pid, target: rId, type: 'request' });
  }
  return { nodes, edges };
}

// ---- Victim selection ----
export function computeVictimCosts(): RecoveryVictim[] {
  return store.simulation.deadlockedPids.map(pid => {
    const p = store.processes.find(x => x.pid === pid);
    if (!p) return { pid, cost: 0, costBreakdown: {}, impact: 'low' as const };
    const heldResources = p.allocation.reduce((s, a) => s + a, 0);
    const waitPenalty = p.waitTicks * 2;
    const priorityPenalty = p.priority * 3;
    const rollbackPenalty = p.rollbackCount * 5;
    const criticalityPenalty = p.criticality * 4;
    const breakdown = { heldResources, waitPenalty, priorityPenalty, rollbackPenalty, criticalityPenalty };
    const cost = Object.values(breakdown).reduce((s, v) => s + v, 0);
    const impact: 'low' | 'medium' | 'high' = cost < 10 ? 'low' : cost < 25 ? 'medium' : 'high';
    return { pid, cost, costBreakdown: breakdown, impact };
  }).sort((a, b) => a.cost - b.cost);
}

// ---- Scheduler: pick next request ----
export function pickNextRequest(): RequestEntry | null {
  const q = store.requestQueue;
  if (q.length === 0) return null;
  const policy = store.simulation.policy;

  if (policy === 'FCFS') return q[0];
  if (policy === 'RR') return q[0];
  if (policy === 'PRIORITY') {
    return q.reduce((best, r) => r.priority > best.priority ? r : best, q[0]);
  }
  if (policy === 'PRIORITY_AGING') {
    const effective = (r: RequestEntry) => {
      const p = store.processes.find(x => x.pid === r.pid);
      return r.priority + Math.floor((p?.waitTicks ?? 0) / 5);
    };
    return q.reduce((best, r) => effective(r) > effective(best) ? r : best, q[0]);
  }
  return q[0];
}

// ---- Core tick ----
export function applyTick(): void {
  const sim = store.simulation;
  sim.tick += 1;
  store.analytics.ticks = sim.tick;

  for (const p of store.processes) {
    if (p.status !== 'TERMINATED') p.age += 1;
    if (p.status === 'WAITING' || p.status === 'BLOCKED') p.waitTicks += 1;
  }

  const req = pickNextRequest();
  if (req) {
    const r = store.resources[req.resourceIdx];
    const proc = store.processes.find(p => p.pid === req.pid);
    if (r && proc && proc.status !== 'TERMINATED') {
      if (req.amount <= r.available) {
        // Tentatively apply
        r.available -= req.amount;
        proc.allocation[req.resourceIdx] = (proc.allocation[req.resourceIdx] ?? 0) + req.amount;
        proc.need[req.resourceIdx] = Math.max(0, (proc.need[req.resourceIdx] ?? 0) - req.amount);

        const bankers = runBankers();
        if (bankers.safe) {
          store.requestQueue = store.requestQueue.filter(x => x.id !== req.id);
          proc.status = 'RUNNING';
          sim.currentPid = proc.pid;
          store.analytics.grants += 1;
          addEvent('GRANT', 'info', `Granted: ${proc.pid} got ${req.amount} of ${r.label}`, { pid: proc.pid, resource: r.id, amount: req.amount });

          if (proc.need.every(n => n === 0)) {
            for (let j = 0; j < proc.allocation.length; j++) {
              store.resources[j].available += proc.allocation[j];
              proc.allocation[j] = 0;
            }
            proc.status = 'TERMINATED';
            store.analytics.terminatedCount += 1;
            addEvent('RELEASE', 'info', `Process ${proc.pid} completed and released all resources`);
          }
        } else {
          // Rollback tentative grant
          r.available += req.amount;
          proc.allocation[req.resourceIdx] -= req.amount;
          proc.need[req.resourceIdx] += req.amount;
          proc.status = 'BLOCKED';
          store.requestQueue = store.requestQueue.filter(x => x.id !== req.id);
          store.analytics.denials += 1;
          addEvent('DENY', 'warn', `Denied (unsafe state): ${proc.pid} request for ${req.amount} of ${r.label}`, { pid: proc.pid, resource: r.id });
        }
      } else {
        proc.status = 'BLOCKED';
        store.requestQueue = store.requestQueue.filter(x => x.id !== req.id);
        store.analytics.denials += 1;
        addEvent('DENY', 'warn', `Denied (insufficient): ${req.pid} needs ${req.amount} of ${r.label}`, { pid: req.pid });
      }
    }
  }

  sim.bankersResult = runBankers();

  const wfg = buildWFG();
  const cycles = detectCycles(wfg);
  sim.wfgCycles = cycles;
  const deadlocked = [...new Set(cycles.flat())];
  const wasDeadlocked = sim.deadlockedPids.length > 0;
  sim.deadlockedPids = deadlocked;

  if (deadlocked.length > 0 && !wasDeadlocked) {
    store.analytics.deadlocksDetected += 1;
    addEvent('DEADLOCK', 'error', `Deadlock detected! Processes: ${deadlocked.join(', ')}`, { pids: deadlocked, cycles });
    snapshotCheckpoint(`Pre-recovery at tick ${sim.tick}`);
  }

  if (sim.tick % 10 === 0) {
    snapshotCheckpoint(`Auto-checkpoint tick ${sim.tick}`);
  }

  store.analytics.throughput = parseFloat(
    (store.analytics.terminatedCount / Math.max(1, sim.tick / 10)).toFixed(2)
  );

  const waiting = store.processes.filter(p => p.status !== 'TERMINATED');
  store.analytics.avgWaitTicks = waiting.length
    ? parseFloat((waiting.reduce((s, p) => s + p.waitTicks, 0) / waiting.length).toFixed(1))
    : 0;
}

// ---- Reset ----
export function resetStore(): void {
  const numR = store.resources.length;
  store.processes = makeDefaultProcesses(numR);
  store.resources = makeDefaultResources();
  store.requestQueue = [];
  store.eventLog = [];
  store.checkpoints = [];
  store.replaySeed = null;
  store.replayLog = [];
  store.simulation = {
    tick: 0,
    isPlaying: false,
    lastTickAt: Date.now(),
    policy: store.simulation.policy,
    rrQuantum: store.simulation.rrQuantum,
    rrCounter: 0,
    currentPid: 'P0',
    deadlockedPids: [],
    wfgCycles: [],
    bankersResult: null,
    lastRecoveryTick: -1,
  };
  store.analytics = {
    ticks: 0,
    grants: 0,
    denials: 0,
    deadlocksDetected: 0,
    recoveriesApplied: 0,
    checkpointsCreated: 0,
    avgWaitTicks: 0,
    throughput: 0,
    terminatedCount: 0,
  };
  addEvent('SYSTEM', 'info', 'Simulation reset.');
}
