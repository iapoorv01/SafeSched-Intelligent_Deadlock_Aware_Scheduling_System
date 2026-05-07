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
  burstTime: number;       // total CPU burst needed (for RR scheduling)
  remainingTime: number;   // remaining burst (decremented each tick when RUNNING)
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
  type: 'REQUEST' | 'GRANT' | 'DENY' | 'RELEASE' | 'DEADLOCK' | 'RECOVERY' | 'CHECKPOINT' | 'ROLLBACK' | 'SYSTEM' | 'STARVATION' | 'PREEMPT' | 'SPAWN' | 'TERMINATE';
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
  tickIntervalMs: number;  // configurable speed: 500ms, 1000ms, 2000ms
  policy: SchedulerPolicy;
  rrQuantum: number;
  rrCounter: number;
  currentPid: string | null;
  deadlockedPids: string[];
  wfgCycles: WFGCycle[];
  bankersResult: BankersResult | null;
  lastRecoveryTick: number;
  starvationThreshold: number; // ticks before a waiting process is flagged
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
  // ── Novelty: deadlock risk score 0-100 ──
  deadlockRiskScore: number;
  // ── Novelty: per-process contention heat ──
  contentionHeat: Record<string, number>;
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
  const data: Array<[string, number[], number[], 'RUNNING' | 'WAITING' | 'BLOCKED' | 'TERMINATED', number, number, number]> = [
    ['P0', [0, 1], [7, 5], 'RUNNING',  2, 1, 8],
    ['P1', [2, 0], [3, 2], 'WAITING',  1, 0, 5],
    ['P2', [3, 0], [9, 0], 'WAITING',  0, 2, 12],
    ['P3', [2, 1], [2, 2], 'BLOCKED',  3, 1, 6],
    ['P4', [0, 0], [4, 3], 'WAITING',  1, 0, 4],
  ];
  return data.map(([pid, alloc, max, status, priority, criticality, burst]) => ({
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
    burstTime: burst,
    remainingTime: burst,
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
    tickIntervalMs: 1000,
    policy: 'FCFS',
    rrQuantum: 3,
    rrCounter: 0,
    currentPid: 'P0',
    deadlockedPids: [],
    wfgCycles: [],
    bankersResult: null,
    lastRecoveryTick: -1,
    starvationThreshold: 15,
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
    deadlockRiskScore: 0,
    contentionHeat: {},
  },
  processes: makeDefaultProcesses(2),
  resources: makeDefaultResources(),
  // Seed initial request queue so graph shows edges immediately
  requestQueue: [
    { id: 'init-0', pid: 'P0', resourceIdx: 0, amount: 3, enqueuedAt: 0, priority: 2 },
    { id: 'init-1', pid: 'P1', resourceIdx: 1, amount: 2, enqueuedAt: 0, priority: 1 },
    { id: 'init-2', pid: 'P4', resourceIdx: 0, amount: 1, enqueuedAt: 0, priority: 1 },
  ],
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
  const nodes: Array<{
    id: string; label: string; type: 'process' | 'resource';
    status?: string; deadlocked?: boolean;
    // extra richness
    allocation?: number[]; need?: number[]; max?: number[];
    priority?: number; waitTicks?: number; age?: number;
    // resource capacity
    total?: number; available?: number; utilizationPct?: number;
  }> = [];
  const edges: Array<{ source: string; target: string; type: 'allocation' | 'request'; amount?: number }> = [];
  const deadSet = new Set(store.simulation.deadlockedPids);

  for (const p of store.processes) {
    nodes.push({
      id: p.pid, label: p.pid, type: 'process', status: p.status,
      deadlocked: deadSet.has(p.pid),
      allocation: p.allocation, need: p.need, max: p.max,
      priority: p.priority, waitTicks: p.waitTicks, age: p.age,
    });
  }
  for (const r of store.resources) {
    const used = r.total - r.available;
    nodes.push({
      id: r.id, label: r.label, type: 'resource',
      total: r.total, available: r.available,
      utilizationPct: Math.round((used / Math.max(r.total, 1)) * 100),
    });
  }
  for (const p of store.processes) {
    for (let j = 0; j < p.allocation.length; j++) {
      if (p.allocation[j] > 0) {
        edges.push({ source: store.resources[j]?.id ?? `R${j}`, target: p.pid, type: 'allocation', amount: p.allocation[j] });
      }
    }
  }
  for (const req of store.requestQueue) {
    const rId = store.resources[req.resourceIdx]?.id ?? `R${req.resourceIdx}`;
    edges.push({ source: req.pid, target: rId, type: 'request', amount: req.amount });
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

  // ── Auto-generate requests when queue is empty so simulation never stalls ──
  if (store.requestQueue.length === 0) {
    const active = store.processes.filter(p => p.status !== 'TERMINATED');
    for (const p of active) {
      // Find a resource this process still needs
      for (let ri = 0; ri < store.resources.length; ri++) {
        const need = p.need[ri] ?? 0;
        if (need > 0) {
          const amount = Math.min(need, Math.max(1, Math.floor(need / 2)));
          store.requestQueue.push({
            id: `auto-${sim.tick}-${p.pid}-${ri}`,
            pid: p.pid,
            resourceIdx: ri,
            amount,
            enqueuedAt: sim.tick,
            priority: p.priority,
          });
          addEvent('REQUEST', 'info', `Auto-request: ${p.pid} needs ${amount} of ${store.resources[ri].label}`);
          break; // one request per process per tick
        }
      }
    }
  }

  // ── Starvation detection: flag processes waiting > threshold ticks ──
  for (const p of store.processes) {
    if (p.waitTicks > sim.starvationThreshold && p.status === 'WAITING') {
      p.status = 'BLOCKED';
      addEvent('STARVATION', 'warn', `Starvation: ${p.pid} waited ${p.waitTicks} ticks (threshold: ${sim.starvationThreshold})`, { pid: p.pid, waitTicks: p.waitTicks });
    }
  }

  // ── RR: decrement remaining time for running process ──
  if (sim.policy === 'RR' && sim.currentPid) {
    const runningProc = store.processes.find(p => p.pid === sim.currentPid && p.status === 'RUNNING');
    if (runningProc) {
      runningProc.remainingTime = Math.max(0, runningProc.remainingTime - 1);
      sim.rrCounter += 1;
      // Preempt after quantum expires
      if (sim.rrCounter >= sim.rrQuantum) {
        sim.rrCounter = 0;
        runningProc.status = 'WAITING';
        addEvent('PREEMPT', 'info', `RR preempt: ${runningProc.pid} quantum expired`, { pid: runningProc.pid });
        sim.currentPid = null;
      }
    }
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

  // ── Novelty: Deadlock Risk Score (0-100) ──────────────────────────────────
  // Heuristic: combines resource saturation, blocked process ratio, WFG density
  const totalProcs = store.processes.filter(p => p.status !== 'TERMINATED').length;
  const blockedProcs = store.processes.filter(p => p.status === 'BLOCKED').length;
  const blockedRatio = totalProcs > 0 ? blockedProcs / totalProcs : 0;

  const avgSaturation = store.resources.length > 0
    ? store.resources.reduce((s, r) => s + (r.total - r.available) / Math.max(r.total, 1), 0) / store.resources.length
    : 0;

  const wfgEdges = Object.values(buildWFG()).reduce((s, arr) => s + arr.length, 0);
  const wfgDensity = totalProcs > 1 ? Math.min(1, wfgEdges / (totalProcs * (totalProcs - 1))) : 0;

  store.analytics.deadlockRiskScore = Math.round(
    (blockedRatio * 40 + avgSaturation * 35 + wfgDensity * 25) * 100
  );

  // ── Novelty: Contention Heat per process ─────────────────────────────────
  for (const req of store.requestQueue) {
    const heat = store.analytics.contentionHeat;
    heat[req.pid] = (heat[req.pid] ?? 0) + 1;
  }
}

// ---- Dynamic Process Management ----
export function addProcess(opts: {
  pid?: string;
  max: number[];
  priority?: number;
  criticality?: number;
  burstTime?: number;
}): ProcessRecord {
  const numR = store.resources.length;
  const pid = opts.pid ?? `P${store.processes.length}`;
  if (store.processes.find(p => p.pid === pid)) {
    throw new Error(`Process ${pid} already exists`);
  }
  const max = opts.max.slice(0, numR);
  // Pad max if fewer entries than resources
  while (max.length < numR) max.push(0);
  const burst = opts.burstTime ?? 8;
  const proc: ProcessRecord = {
    pid,
    allocation: Array(numR).fill(0),
    max,
    need: [...max],
    status: 'WAITING',
    priority: opts.priority ?? 1,
    age: 0,
    waitTicks: 0,
    rollbackCount: 0,
    criticality: opts.criticality ?? 1,
    burstTime: burst,
    remainingTime: burst,
  };
  store.processes.push(proc);
  addEvent('SPAWN', 'info', `Process ${pid} added (max: [${max.join(', ')}], priority: ${proc.priority})`, { pid });
  return proc;
}

export function removeProcess(pid: string): void {
  const proc = store.processes.find(p => p.pid === pid);
  if (!proc) throw new Error(`Process ${pid} not found`);
  // Release held resources
  for (let j = 0; j < proc.allocation.length; j++) {
    store.resources[j].available += proc.allocation[j];
  }
  store.processes = store.processes.filter(p => p.pid !== pid);
  store.requestQueue = store.requestQueue.filter(r => r.pid !== pid);
  addEvent('TERMINATE', 'info', `Process ${pid} removed`, { pid });
}

export function addResource(opts: {
  id?: string;
  label: string;
  total: number;
  type?: ResourceRecord['type'];
}): ResourceRecord {
  const id = opts.id ?? `R${store.resources.length}`;
  if (store.resources.find(r => r.id === id)) {
    throw new Error(`Resource ${id} already exists`);
  }
  const res: ResourceRecord = {
    id,
    label: opts.label,
    total: opts.total,
    available: opts.total,
    type: opts.type ?? 'GENERIC',
  };
  store.resources.push(res);
  // Extend all process allocation/max/need arrays
  for (const p of store.processes) {
    p.allocation.push(0);
    p.max.push(0);
    p.need.push(0);
  }
  addEvent('SYSTEM', 'info', `Resource ${id} (${opts.label}) added, total: ${opts.total}`);
  return res;
}

export function removeResource(id: string): void {
  const idx = store.resources.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`Resource ${id} not found`);
  // Release allocations for this resource
  for (const p of store.processes) {
    p.allocation.splice(idx, 1);
    p.max.splice(idx, 1);
    p.need.splice(idx, 1);
  }
  store.resources.splice(idx, 1);
  // Remove requests for this resource index, shift higher indices
  store.requestQueue = store.requestQueue
    .filter(r => r.resourceIdx !== idx)
    .map(r => ({ ...r, resourceIdx: r.resourceIdx > idx ? r.resourceIdx - 1 : r.resourceIdx }));
  addEvent('SYSTEM', 'info', `Resource ${id} removed`);
}

// ---- Scenario Presets ----
export type ScenarioPreset = 'classic_deadlock' | 'safe_state' | 'starvation' | 'dining_philosophers' | 'custom';

export function loadScenarioPreset(preset: ScenarioPreset): void {
  // Reset first
  store.processes = [];
  store.resources = [];
  store.requestQueue = [];
  store.eventLog = [];
  store.checkpoints = [];
  store.simulation.tick = 0;
  store.simulation.deadlockedPids = [];
  store.simulation.wfgCycles = [];
  store.simulation.bankersResult = null;
  store.analytics = { ticks: 0, grants: 0, denials: 0, deadlocksDetected: 0, recoveriesApplied: 0, checkpointsCreated: 0, avgWaitTicks: 0, throughput: 0, terminatedCount: 0, deadlockRiskScore: 0, contentionHeat: {} };

  if (preset === 'classic_deadlock') {
    // Classic 2-process deadlock: P0 holds R0 needs R1, P1 holds R1 needs R0
    store.resources = [
      { id: 'R0', label: 'CPU',    total: 1, available: 0, type: 'CPU' },
      { id: 'R1', label: 'Memory', total: 1, available: 0, type: 'MEMORY' },
    ];
    store.processes = [
      { pid: 'P0', allocation: [1, 0], max: [1, 1], need: [0, 1], status: 'BLOCKED', priority: 1, age: 0, waitTicks: 0, rollbackCount: 0, criticality: 1, burstTime: 5, remainingTime: 5 },
      { pid: 'P1', allocation: [0, 1], max: [1, 1], need: [1, 0], status: 'BLOCKED', priority: 1, age: 0, waitTicks: 0, rollbackCount: 0, criticality: 1, burstTime: 5, remainingTime: 5 },
    ];
    store.requestQueue = [
      { id: 'dl-0', pid: 'P0', resourceIdx: 1, amount: 1, enqueuedAt: 0, priority: 1 },
      { id: 'dl-1', pid: 'P1', resourceIdx: 0, amount: 1, enqueuedAt: 0, priority: 1 },
    ];
    addEvent('SYSTEM', 'info', 'Loaded preset: Classic Deadlock (P0↔P1 circular wait)');

  } else if (preset === 'safe_state') {
    // Banker's classic safe state example (Silberschatz OS textbook)
    store.resources = [
      { id: 'R0', label: 'A', total: 10, available: 3, type: 'CPU' },
      { id: 'R1', label: 'B', total: 5,  available: 3, type: 'MEMORY' },
      { id: 'R2', label: 'C', total: 7,  available: 2, type: 'IO' },
    ];
    store.processes = [
      { pid: 'P0', allocation: [0,1,0], max: [7,5,3], need: [7,4,3], status: 'WAITING', priority: 2, age: 0, waitTicks: 0, rollbackCount: 0, criticality: 1, burstTime: 10, remainingTime: 10 },
      { pid: 'P1', allocation: [2,0,0], max: [3,2,2], need: [1,2,2], status: 'WAITING', priority: 1, age: 0, waitTicks: 0, rollbackCount: 0, criticality: 1, burstTime: 6, remainingTime: 6 },
      { pid: 'P2', allocation: [3,0,2], max: [9,0,2], need: [6,0,0], status: 'RUNNING', priority: 0, age: 0, waitTicks: 0, rollbackCount: 0, criticality: 2, burstTime: 8, remainingTime: 8 },
      { pid: 'P3', allocation: [2,1,1], max: [2,2,2], need: [0,1,1], status: 'WAITING', priority: 3, age: 0, waitTicks: 0, rollbackCount: 0, criticality: 1, burstTime: 4, remainingTime: 4 },
      { pid: 'P4', allocation: [0,0,2], max: [4,3,3], need: [4,3,1], status: 'WAITING', priority: 1, age: 0, waitTicks: 0, rollbackCount: 0, criticality: 1, burstTime: 7, remainingTime: 7 },
    ];
    store.requestQueue = [
      { id: 'ss-0', pid: 'P1', resourceIdx: 0, amount: 1, enqueuedAt: 0, priority: 1 },
      { id: 'ss-1', pid: 'P3', resourceIdx: 1, amount: 1, enqueuedAt: 0, priority: 3 },
    ];
    addEvent('SYSTEM', 'info', 'Loaded preset: Safe State (Silberschatz textbook example)');

  } else if (preset === 'starvation') {
    // High-priority processes monopolize resources, low-priority starves
    store.resources = [
      { id: 'R0', label: 'CPU', total: 3, available: 0, type: 'CPU' },
    ];
    store.processes = [
      { pid: 'P0', allocation: [1], max: [2], need: [1], status: 'RUNNING',  priority: 5, age: 0, waitTicks: 0,  rollbackCount: 0, criticality: 2, burstTime: 20, remainingTime: 20 },
      { pid: 'P1', allocation: [1], max: [2], need: [1], status: 'RUNNING',  priority: 4, age: 0, waitTicks: 0,  rollbackCount: 0, criticality: 2, burstTime: 15, remainingTime: 15 },
      { pid: 'P2', allocation: [1], max: [2], need: [1], status: 'RUNNING',  priority: 3, age: 0, waitTicks: 0,  rollbackCount: 0, criticality: 1, burstTime: 10, remainingTime: 10 },
      { pid: 'P3', allocation: [0], max: [1], need: [1], status: 'WAITING',  priority: 1, age: 0, waitTicks: 20, rollbackCount: 0, criticality: 1, burstTime: 5,  remainingTime: 5 },
      { pid: 'P4', allocation: [0], max: [1], need: [1], status: 'WAITING',  priority: 0, age: 0, waitTicks: 25, rollbackCount: 0, criticality: 1, burstTime: 3,  remainingTime: 3 },
    ];
    store.requestQueue = [
      { id: 'st-0', pid: 'P3', resourceIdx: 0, amount: 1, enqueuedAt: 0, priority: 1 },
      { id: 'st-1', pid: 'P4', resourceIdx: 0, amount: 1, enqueuedAt: 0, priority: 0 },
    ];
    addEvent('SYSTEM', 'info', 'Loaded preset: Starvation (low-priority processes starved by high-priority)');

  } else if (preset === 'dining_philosophers') {
    // 5 philosophers, 5 forks — classic dining philosophers deadlock
    const n = 5;
    store.resources = Array.from({ length: n }, (_, i) => ({
      id: `F${i}`, label: `Fork ${i}`, total: 1, available: 0, type: 'GENERIC' as const,
    }));
    store.processes = Array.from({ length: n }, (_, i) => ({
      pid: `Ph${i}`,
      allocation: Array.from({ length: n }, (_, j) => (j === i ? 1 : 0)), // each holds left fork
      max: Array.from({ length: n }, (_, j) => (j === i || j === (i + 1) % n ? 1 : 0)),
      need: Array.from({ length: n }, (_, j) => (j === (i + 1) % n ? 1 : 0)), // needs right fork
      status: 'BLOCKED' as const,
      priority: 1, age: 0, waitTicks: 0, rollbackCount: 0, criticality: 1,
      burstTime: 6, remainingTime: 6,
    }));
    store.requestQueue = Array.from({ length: n }, (_, i) => ({
      id: `dp-${i}`, pid: `Ph${i}`, resourceIdx: (i + 1) % n, amount: 1, enqueuedAt: 0, priority: 1,
    }));
    addEvent('SYSTEM', 'info', 'Loaded preset: Dining Philosophers (5 philosophers, circular deadlock)');
  }
}

// ---- Export / Import Scenario ----
export function exportScenario(): object {
  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    processes: store.processes,
    resources: store.resources,
    requestQueue: store.requestQueue,
    policy: store.simulation.policy,
    rrQuantum: store.simulation.rrQuantum,
    starvationThreshold: store.simulation.starvationThreshold,
    tickIntervalMs: store.simulation.tickIntervalMs,
  };
}

export function importScenario(data: any): void {
  if (!data.processes || !data.resources) throw new Error('Invalid scenario format');
  store.processes = data.processes;
  store.resources = data.resources;
  store.requestQueue = data.requestQueue ?? [];
  store.eventLog = [];
  store.checkpoints = [];
  store.simulation.tick = 0;
  store.simulation.deadlockedPids = [];
  store.simulation.wfgCycles = [];
  store.simulation.bankersResult = null;
  store.simulation.policy = data.policy ?? 'FCFS';
  store.simulation.rrQuantum = data.rrQuantum ?? 3;
  store.simulation.starvationThreshold = data.starvationThreshold ?? 15;
  store.simulation.tickIntervalMs = data.tickIntervalMs ?? 1000;
  store.analytics = { ticks: 0, grants: 0, denials: 0, deadlocksDetected: 0, recoveriesApplied: 0, checkpointsCreated: 0, avgWaitTicks: 0, throughput: 0, terminatedCount: 0, deadlockRiskScore: 0, contentionHeat: {} };
  addEvent('SYSTEM', 'info', `Scenario imported: ${data.processes.length} processes, ${data.resources.length} resources`);
}

// ---- Reset ----
export function resetStore(): void {
  store.processes = makeDefaultProcesses(2);
  store.resources = makeDefaultResources();
  store.requestQueue = [
    { id: 'init-0', pid: 'P0', resourceIdx: 0, amount: 3, enqueuedAt: 0, priority: 2 },
    { id: 'init-1', pid: 'P1', resourceIdx: 1, amount: 2, enqueuedAt: 0, priority: 1 },
    { id: 'init-2', pid: 'P4', resourceIdx: 0, amount: 1, enqueuedAt: 0, priority: 1 },
  ];
  store.eventLog = [];
  store.checkpoints = [];
  store.replaySeed = null;
  store.replayLog = [];
  store.simulation = {
    tick: 0,
    isPlaying: false,
    lastTickAt: Date.now(),
    tickIntervalMs: store.simulation.tickIntervalMs,
    policy: store.simulation.policy,
    rrQuantum: store.simulation.rrQuantum,
    rrCounter: 0,
    currentPid: 'P0',
    deadlockedPids: [],
    wfgCycles: [],
    bankersResult: null,
    lastRecoveryTick: -1,
    starvationThreshold: store.simulation.starvationThreshold,
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
    deadlockRiskScore: 0,
    contentionHeat: {},
  };
  addEvent('SYSTEM', 'info', 'Simulation reset.');
}
