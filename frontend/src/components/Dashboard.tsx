// ============================================================
// SafeSched — Dashboard.tsx
// Light neumorphic theme, guided tour, full simulation UI
// ============================================================
import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react';
import { localApiFetch } from '../lib/localApiFetch';
import GraphVisualizer from './GraphVisualizer';

// ── Types ────────────────────────────────────────────────────────────────────
type ProcessRecord = {
  pid: string; allocation: number[]; max: number[]; need: number[];
  status: 'RUNNING'|'WAITING'|'BLOCKED'|'TERMINATED';
  priority: number; age: number; waitTicks: number; rollbackCount: number; criticality: number;
  burstTime?: number; remainingTime?: number;
};
type ResourceRecord = { id: string; label: string; total: number; available: number; type: string };
type BankersStep = { pid: string; workBefore: number[]; need: number[]; allocation: number[]; workAfter: number[] };
type BankersResult = { safe: boolean; safeSequence: string[]; steps: BankersStep[] };
type EventSnapshot = { id: string; tick: number; ts: number; level: 'info'|'warn'|'error'; type: string; message: string };
type RecoveryVictim = { pid: string; cost: number; costBreakdown: Record<string,number>; impact: 'low'|'medium'|'high' };
type CheckpointInfo = { id: string; tick: number; description: string; ts: number };
type SchedulerPolicy = 'FCFS'|'RR'|'PRIORITY'|'PRIORITY_AGING';
type SimState = {
  tick: number; isPlaying: boolean; policy: SchedulerPolicy; rrQuantum: number;
  tickIntervalMs: number; starvationThreshold: number;
  currentPid: string|null; deadlockedPids: string[]; wfgCycles: string[][];
  bankersResult: BankersResult|null; processes: ProcessRecord[]; resources: ResourceRecord[];
};
type Analytics = {
  ticks: number; grants: number; denials: number; deadlocksDetected: number;
  recoveriesApplied: number; checkpointsCreated: number; avgWaitTicks: number;
  throughput: number; terminatedCount: number; activeProcesses: number; totalProcesses: number;
  resourceUtilization: Array<{id:string;label:string;total:number;available:number;used:number;utilizationPct:number}>;
};
type RecoveryData = {
  deadlockedPids: string[]; wfgCycles: string[][];
  suggestedVictim: string|null; victims: RecoveryVictim[];
  checkpoints: CheckpointInfo[];
};
type ReplayResult = {
  seed: number; steps: number; replayLog: EventSnapshot[];
  processes: ProcessRecord[]; resources: ResourceRecord[];
  deadlockedPids: string[]; bankersResult: BankersResult|null;
};

// ── Helper functions ─────────────────────────────────────────────────────────
function resourceIcon(type: string): string {
  switch (type) {
    case 'CPU': return '🖥';
    case 'MEMORY': return '🧠';
    case 'IO': return '💾';
    case 'NETWORK': return '🌐';
    default: return '⚙️';
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case 'RUNNING': return 'Running';
    case 'WAITING': return 'Waiting';
    case 'BLOCKED': return 'Blocked';
    case 'TERMINATED': return 'Done';
    default: return s;
  }
}

function statusDotClass(s: string): string {
  switch (s) {
    case 'RUNNING': return 'status-dot running';
    case 'WAITING': return 'status-dot waiting';
    case 'BLOCKED': return 'status-dot blocked';
    case 'TERMINATED': return 'status-dot terminated';
    default: return 'status-dot';
  }
}

function barColor(pct: number): string {
  if (pct >= 85) return '#ef4444';
  if (pct >= 60) return '#f59e0b';
  return '#22c55e';
}

function dotBar(available: number, total: number): ReactElement {
  const used = total - available;
  return (
    <span className="flex gap-0.5 flex-wrap">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: i < used ? '#3b82f6' : '#cbd5e1' }}
        />
      ))}
    </span>
  );
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function eventBadgeColor(level: string): string {
  switch (level) {
    case 'error': return 'bg-red-100 text-red-700 border border-red-200';
    case 'warn': return 'bg-amber-100 text-amber-700 border border-amber-200';
    default: return 'bg-blue-50 text-blue-700 border border-blue-200';
  }
}

// ── Learn sections ────────────────────────────────────────────────────────────
const LEARN_SECTIONS = [
  {
    icon: '🔒',
    title: 'What is a Deadlock?',
    body: 'A deadlock occurs when a set of processes are each waiting for a resource held by another process in the set — creating a circular wait that never resolves. Think of it like a four-way traffic jam where no car can move because each is blocked by the next.',
    example: 'P1 holds R1, wants R2. P2 holds R2, wants R1. Neither can proceed → deadlock!',
  },
  {
    icon: '🏦',
    title: "Banker's Algorithm",
    body: "The Banker's Algorithm is a deadlock avoidance technique. Before granting a resource request, it simulates the allocation and checks if the system can still reach a 'safe state' — a sequence where every process can eventually finish. If not safe, the request is denied.",
    example: 'Safe sequence: P1 → P3 → P0 → P2 → P4 means each process can run to completion in that order.',
  },
  {
    icon: '🕸',
    title: 'Resource Allocation Graph (RAG)',
    body: 'The RAG is a directed graph showing relationships between processes and resources. An edge from a resource to a process means the resource is allocated to that process. An edge from a process to a resource means the process is requesting it. A cycle in the RAG indicates a potential deadlock.',
    example: 'P1 → R1 → P2 → R2 → P1 forms a cycle — deadlock!',
  },
  {
    icon: '⏳',
    title: 'Wait-For Graph (WFG)',
    body: 'The WFG simplifies the RAG by only showing process-to-process wait relationships. An edge P1 → P2 means P1 is waiting for a resource currently held by P2. A cycle in the WFG is a definitive deadlock indicator.',
    example: 'If P1 waits for P2 and P2 waits for P1, the WFG has a cycle → deadlock confirmed.',
  },
  {
    icon: '🛡',
    title: 'Recovery Strategies',
    body: 'When a deadlock is detected, the system can recover by: (1) Process Preemption — forcibly terminating a "victim" process to free its resources. The victim is chosen by lowest cost (fewest held resources, lowest priority). (2) Rollback — restoring the system to a previously saved checkpoint before the deadlock occurred.',
    example: 'Preempt P3 (cost: 4) instead of P0 (cost: 18) to minimize disruption.',
  },
];

// ── BankersStepsSection sub-component ────────────────────────────────────────
function BankersStepsSection({ steps }: { steps: BankersStep[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div className="mt-4">
      <button
        className="skeuo-button text-sm px-4 py-2 rounded-xl"
        onClick={() => setOpen(o => !o)}
      >
        {open ? '▲ Hide' : '▼ Show'} Step-by-Step Trace ({steps.length} steps)
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto fade-in">
          <table className="w-full text-xs text-slate-600 border-collapse">
            <thead>
              <tr className="skeuo-pressed">
                <th className="px-3 py-2 text-left rounded-tl-xl">Process</th>
                <th className="px-3 py-2 text-left">Work Before</th>
                <th className="px-3 py-2 text-left">Need</th>
                <th className="px-3 py-2 text-left">Allocation</th>
                <th className="px-3 py-2 text-left rounded-tr-xl">Work After</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white/20' : 'bg-white/10'}>
                  <td className="px-3 py-2 font-bold text-blue-700">{s.pid}</td>
                  <td className="px-3 py-2 font-mono">[{s.workBefore.join(', ')}]</td>
                  <td className="px-3 py-2 font-mono">[{s.need.join(', ')}]</td>
                  <td className="px-3 py-2 font-mono">[{s.allocation.join(', ')}]</td>
                  <td className="px-3 py-2 font-mono">[{s.workAfter.join(', ')}]</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tour steps — each targets a CSS selector on the page ─────────────────────
const TOUR_STEPS = [
  {
    target: '[data-tour="header"]',
    title: '🛡 SafeSched Dashboard',
    desc: 'This is your deadlock simulation control center. The colored badge shows system health — green means safe, red means deadlock detected. Use ▶ Play to start the simulation.',
    position: 'bottom' as const,
  },
  {
    target: '[data-tour="processes"]',
    title: '⚙️ Active Processes',
    desc: 'Each card is a running process (like a program on your computer). The colored dot shows its state: 🟢 Running, 🟡 Waiting for a resource, 🔴 Blocked (can\'t get what it needs). The bars show how much of each resource it currently holds vs. its maximum demand.',
    position: 'right' as const,
  },
  {
    target: '[data-tour="resources"]',
    title: '📦 System Resources',
    desc: 'Resources are things processes need — like CPU time or Memory. The progress bar shows how much is in use. Blue dots = used units, grey dots = free units. When all units are taken and another process needs them, a deadlock can form.',
    position: 'right' as const,
  },
  {
    target: '[data-tour="inject"]',
    title: '💉 Inject a Request',
    desc: 'This is how you manually tell a process to request a resource. Pick a process, pick a resource, set how many units it needs, and hit Inject. The simulation will try to grant it safely using the Banker\'s Algorithm.',
    position: 'left' as const,
  },
  {
    target: '[data-tour="tabnav"]',
    title: '🗂 Navigation Tabs',
    desc: '• Safety Check — see if the system can finish all processes safely\n• Graph — visual map of who holds what\n• Recovery — fix deadlocks when they happen\n• Replay — reproduce any simulation with a seed\n• Learn — deep explanations of every concept',
    position: 'bottom' as const,
  },
];

// ── Inline Tour Tooltip ───────────────────────────────────────────────────────
function TourTooltip({
  step, total, stepIdx, onNext, onPrev, onClose,
}: {
  step: typeof TOUR_STEPS[0]; total: number; stepIdx: number;
  onNext: () => void; onPrev: () => void; onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; arrowSide: string } | null>(null);

  useEffect(() => {
    const el = document.querySelector(step.target);
    if (!el) { setPos({ top: 80, left: window.innerWidth / 2 - 180, arrowSide: 'none' }); return; }
    const rect = el.getBoundingClientRect();
    const TW = 360;
    let top = 0, left = 0, arrowSide = 'top';
    if (step.position === 'bottom') {
      top = rect.bottom + 12;
      left = Math.min(rect.left + rect.width / 2 - TW / 2, window.innerWidth - TW - 16);
      arrowSide = 'top';
    } else if (step.position === 'right') {
      top = rect.top;
      left = rect.right + 12;
      arrowSide = 'left';
    } else {
      top = rect.top;
      left = rect.left - TW - 12;
      arrowSide = 'right';
    }
    left = Math.max(8, Math.min(left, window.innerWidth - TW - 8));
    setPos({ top, left, arrowSide });

    // Highlight target
    (el as HTMLElement).style.outline = '3px solid #2563eb';
    (el as HTMLElement).style.outlineOffset = '4px';
    (el as HTMLElement).style.borderRadius = '12px';
    (el as HTMLElement).style.transition = 'outline 0.2s';
    return () => {
      (el as HTMLElement).style.outline = '';
      (el as HTMLElement).style.outlineOffset = '';
    };
  }, [step]);

  if (!pos) return null;

  return (
    <div
      style={{
        position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
        width: 360, background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(16px)',
        border: '1.5px solid rgba(37,99,235,0.3)', borderRadius: 16,
        boxShadow: '0 8px 32px rgba(37,99,235,0.18), 0 2px 8px rgba(0,0,0,0.08)',
        padding: '18px 20px',
      }}
    >
      {/* Arrow indicator */}
      {pos.arrowSide === 'top' && (
        <div style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)',
          width: 0, height: 0, borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
          borderBottom: '8px solid rgba(37,99,235,0.3)' }} />
      )}
      {pos.arrowSide === 'left' && (
        <div style={{ position: 'absolute', left: -8, top: 20,
          width: 0, height: 0, borderTop: '8px solid transparent', borderBottom: '8px solid transparent',
          borderRight: '8px solid rgba(37,99,235,0.3)' }} />
      )}
      {pos.arrowSide === 'right' && (
        <div style={{ position: 'absolute', right: -8, top: 20,
          width: 0, height: 0, borderTop: '8px solid transparent', borderBottom: '8px solid transparent',
          borderLeft: '8px solid rgba(37,99,235,0.3)' }} />
      )}

      <div className="flex items-start justify-between mb-2">
        <span className="font-bold text-slate-800 text-sm leading-snug">{step.title}</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-2">×</button>
      </div>
      <p className="text-slate-600 text-xs leading-relaxed mb-4 whitespace-pre-line">{step.desc}</p>

      {/* Progress dots */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
              background: i === stepIdx ? '#2563eb' : '#cbd5e1',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>
        <div className="flex gap-2">
          {stepIdx > 0 && (
            <button onClick={onPrev} className="skeuo-button text-xs px-3 py-1.5">← Back</button>
          )}
          {stepIdx < total - 1 ? (
            <button onClick={onNext} className="skeuo-button text-xs px-3 py-1.5 text-blue-600">Next →</button>
          ) : (
            <button onClick={onClose} className="skeuo-button text-xs px-3 py-1.5 text-blue-600 font-bold">Done 🎉</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard component ──────────────────────────────────────────────────
export default function Dashboard() {
  // Core simulation state
  const [sim, setSim] = useState<SimState | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [events, setEvents] = useState<EventSnapshot[]>([]);
  const [recovery, setRecovery] = useState<RecoveryData | null>(null);
  const [loading, setLoading] = useState(true);

  // Tab & graph
  const [activeTab, setActiveTab] = useState<'overview'|'banker'|'graph'|'recovery'|'replay'|'learn'|'manage'>('overview');
  const [graphMode, setGraphMode] = useState<'rag'|'wfg'>('rag');
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);

  // Inject form
  const [injPid, setInjPid] = useState('');
  const [injResIdx, setInjResIdx] = useState(0);
  const [injAmount, setInjAmount] = useState(1);
  const [injPriority, setInjPriority] = useState(0);
  const [injError, setInjError] = useState('');

  // Replay
  const [replaySeed, setReplaySeed] = useState(42);
  const [replaySteps, setReplaySteps] = useState(15);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);

  // Policy
  const [policyDraft, setPolicyDraft] = useState<SchedulerPolicy>('FCFS');
  const [rrQuantumDraft, setRrQuantumDraft] = useState(3);

  // Event log
  const [eventsOpen, setEventsOpen] = useState(true);
  const [queue, setQueue] = useState<Array<{id:string;pid:string;resourceIdx:number;amount:number;priority:number}>>([]);

  // Learn accordion
  const [learnOpen, setLearnOpen] = useState<boolean[]>([false, false, false, false, false]);

  // ── Manage panel state ──
  const [newProcPid, setNewProcPid]         = useState('');
  const [newProcMax, setNewProcMax]         = useState('');
  const [newProcPriority, setNewProcPriority] = useState(1);
  const [newProcBurst, setNewProcBurst]     = useState(8);
  const [newResLabel, setNewResLabel]       = useState('');
  const [newResTotal, setNewResTotal]       = useState(5);
  const [newResType, setNewResType]         = useState('GENERIC');
  const [manageError, setManageError]       = useState('');
  const [speedMs, setSpeedMs]               = useState(1000);
  const [starvThreshold, setStarvThreshold] = useState(15);

  // Tour
  const [showTour, setShowTour] = useState<boolean>(() => {
    try { return localStorage.getItem('safesched_tour_done') !== '1'; } catch { return true; }
  });
  const [tourStep, setTourStep] = useState(0);

  // Refs for tick flash animation
  const tickRef = useRef<HTMLSpanElement | null>(null);
  const prevTickRef = useRef<number>(0);

  // ── fetchAll ────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [simRes, analyticsRes, logsRes, recoveryRes, requestsRes] = await Promise.all([
        localApiFetch<SimState>('/api/simulation'),
        localApiFetch<Analytics>('/api/analytics'),
        localApiFetch<{events: EventSnapshot[]}>('/api/logs'),
        localApiFetch<RecoveryData>('/api/recovery'),
        localApiFetch<{queue: Array<{id:string;pid:string;resourceIdx:number;amount:number;priority:number}>}>('/api/requests'),
      ]);
      const simData = await simRes.json();
      const analyticsData = await analyticsRes.json();
      const logsData = await logsRes.json();
      const recoveryData = await recoveryRes.json();
      const requestsData = await requestsRes.json();

      setSim(simData);
      setAnalytics(analyticsData);
      if (Array.isArray((logsData as any).events)) setEvents((logsData as any).events);
      else if (Array.isArray(logsData)) setEvents(logsData as unknown as EventSnapshot[]);
      setRecovery(recoveryData);
      if (requestsData?.queue) setQueue(requestsData.queue);

      // Sync policy draft on first load
      if (loading) {
        setPolicyDraft(simData.policy);
        setRrQuantumDraft(simData.rrQuantum);
        if (simData.tickIntervalMs) setSpeedMs(simData.tickIntervalMs);
        if (simData.starvationThreshold) setStarvThreshold(simData.starvationThreshold);
        setLoading(false);
      }

      // Tick flash animation
      if (simData.tick !== prevTickRef.current) {
        prevTickRef.current = simData.tick;
        if (tickRef.current) {
          tickRef.current.classList.remove('tick-flash');
          void tickRef.current.offsetWidth;
          tickRef.current.classList.add('tick-flash');
        }
      }
    } catch (e) {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 1200);
    return () => clearInterval(id);
  }, [fetchAll]);

  // Increment graphRefreshKey when graph tab is opened
  useEffect(() => {
    if (activeTab === 'graph') setGraphRefreshKey(k => k + 1);
  }, [activeTab]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const sendAction = useCallback(async (action: string) => {
    await localApiFetch('/api/simulation', { method: 'POST', body: JSON.stringify({ action }) });
    fetchAll();
  }, [fetchAll]);

  const applyPolicy = useCallback(async () => {
    await localApiFetch('/api/simulation', {
      method: 'POST',
      body: JSON.stringify({ policy: policyDraft, rrQuantum: rrQuantumDraft }),
    });
    fetchAll();
  }, [policyDraft, rrQuantumDraft, fetchAll]);

  const injectRequest = useCallback(async () => {
    setInjError('');
    if (!injPid) { setInjError('Select a process.'); return; }
    const res = await localApiFetch('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ pid: injPid, resourceIdx: injResIdx, amount: injAmount, priority: injPriority }),
    });
    if (!res.ok) {
      const d = await res.json() as any;
      setInjError(d?.error ?? 'Request failed.');
    } else {
      fetchAll();
    }
  }, [injPid, injResIdx, injAmount, injPriority, fetchAll]);

  const clearQueue = useCallback(async () => {
    await localApiFetch('/api/requests', { method: 'DELETE' });
    fetchAll();
  }, [fetchAll]);

  const applyRecovery = useCallback(async (victim: RecoveryVictim) => {
    await localApiFetch('/api/recovery', {
      method: 'POST',
      body: JSON.stringify({ action: 'apply', victim: victim.pid }),
    });
    fetchAll();
  }, [fetchAll]);

  const rollback = useCallback(async () => {
    await localApiFetch('/api/recovery', {
      method: 'POST',
      body: JSON.stringify({ action: 'rollback' }),
    });
    fetchAll();
  }, [fetchAll]);

  const restoreCheckpoint = useCallback(async (id: string) => {
    await localApiFetch('/api/recovery', {
      method: 'POST',
      body: JSON.stringify({ action: 'restore', checkpointId: id }),
    });
    fetchAll();
  }, [fetchAll]);

  const loadReplay = useCallback(async () => {
    const res = await localApiFetch<ReplayResult>('/api/replay', {
      method: 'POST',
      body: JSON.stringify({ seed: replaySeed, steps: replaySteps }),
    });
    const data = await res.json();
    setReplayResult(data);
    fetchAll();
  }, [replaySeed, replaySteps, fetchAll]);

  const completeTour = useCallback(() => {
    try { localStorage.setItem('safesched_tour_done', '1'); } catch {}
    setShowTour(false);
  }, []);

  // ── Manage handlers ──────────────────────────────────────────────────────
  const addProcessHandler = useCallback(async () => {
    setManageError('');
    const maxArr = newProcMax.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (maxArr.length === 0) { setManageError('Enter max demand as comma-separated numbers e.g. 3,2'); return; }
    const res = await localApiFetch('/api/scenario', {
      method: 'POST',
      body: JSON.stringify({ action: 'add_process', pid: newProcPid || undefined, max: maxArr, priority: newProcPriority, burstTime: newProcBurst }),
    });
    if (!res.ok) { const d = await res.json() as any; setManageError(d?.error ?? 'Failed'); return; }
    setNewProcPid(''); setNewProcMax('');
    fetchAll();
  }, [newProcPid, newProcMax, newProcPriority, newProcBurst, fetchAll]);

  const removeProcessHandler = useCallback(async (pid: string) => {
    setManageError('');
    const res = await localApiFetch('/api/scenario', { method: 'POST', body: JSON.stringify({ action: 'remove_process', id: pid }) });
    if (!res.ok) { const d = await res.json() as any; setManageError(d?.error ?? 'Failed'); return; }
    fetchAll();
  }, [fetchAll]);

  const addResourceHandler = useCallback(async () => {
    setManageError('');
    if (!newResLabel) { setManageError('Enter a resource label'); return; }
    const res = await localApiFetch('/api/scenario', {
      method: 'POST',
      body: JSON.stringify({ action: 'add_resource', label: newResLabel, total: newResTotal, type: newResType }),
    });
    if (!res.ok) { const d = await res.json() as any; setManageError(d?.error ?? 'Failed'); return; }
    setNewResLabel('');
    fetchAll();
  }, [newResLabel, newResTotal, newResType, fetchAll]);

  const removeResourceHandler = useCallback(async (id: string) => {
    setManageError('');
    const res = await localApiFetch('/api/scenario', { method: 'POST', body: JSON.stringify({ action: 'remove_resource', id }) });
    if (!res.ok) { const d = await res.json() as any; setManageError(d?.error ?? 'Failed'); return; }
    fetchAll();
  }, [fetchAll]);

  const loadPreset = useCallback(async (preset: string) => {
    setManageError('');
    const res = await localApiFetch('/api/scenario', { method: 'POST', body: JSON.stringify({ action: 'load_preset', preset }) });
    if (!res.ok) { const d = await res.json() as any; setManageError(d?.error ?? 'Failed'); return; }
    fetchAll();
  }, [fetchAll]);

  const applySpeedAndThreshold = useCallback(async () => {
    await localApiFetch('/api/simulation', { method: 'POST', body: JSON.stringify({ tickIntervalMs: speedMs, starvationThreshold: starvThreshold }) });
    fetchAll();
  }, [speedMs, starvThreshold, fetchAll]);

  const exportScenarioHandler = useCallback(async () => {
    const res = await localApiFetch('/api/scenario');
    if (res.ok) {
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'safesched-scenario.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    }
  }, []);

  const importScenarioHandler = useCallback(async (file: File) => {
    setManageError('');
    try {
      const text = await file.text();
      const scenario = JSON.parse(text);
      const res = await localApiFetch('/api/scenario', { method: 'POST', body: JSON.stringify({ action: 'import', scenario }) });
      if (!res.ok) { const d = await res.json() as any; setManageError(d?.error ?? 'Import failed'); return; }
      fetchAll();
    } catch { setManageError('Invalid JSON file'); }
  }, [fetchAll]);

  // ── Derived values ───────────────────────────────────────────────────────────
  const isDeadlocked = (sim?.deadlockedPids?.length ?? 0) > 0;
  const isSafe = sim?.bankersResult?.safe ?? true;
  const systemStatus = isDeadlocked ? 'DEADLOCK' : isSafe ? 'SAFE' : 'UNSAFE';

  return (
    <div className="min-h-screen bg-[#e0e5ec] pb-10" style={{ position: 'relative' }}>

      {/* ── Inline Tour Tooltip ── */}
      {showTour && TOUR_STEPS[tourStep] && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.18)', zIndex: 9998, pointerEvents: 'none' }} />
          <TourTooltip
            step={TOUR_STEPS[tourStep]}
            total={TOUR_STEPS.length}
            stepIdx={tourStep}
            onNext={() => setTourStep(s => Math.min(TOUR_STEPS.length - 1, s + 1))}
            onPrev={() => setTourStep(s => Math.max(0, s - 1))}
            onClose={completeTour}
          />
        </>
      )}

      {/* ── Header ── */}
      <header data-tour="header" className="sticky top-0 z-50 glass-card rounded-b-2xl px-6 py-3 flex flex-wrap items-center gap-3 mb-6">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <span className="text-2xl">🛡</span>
          <span className="text-xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent">
            SafeSched
          </span>
        </div>

        {/* System status badge */}
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold ${
            systemStatus === 'DEADLOCK'
              ? 'bg-red-100 text-red-700 pulse-ring-red'
              : systemStatus === 'SAFE'
              ? 'bg-green-100 text-green-700'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {systemStatus === 'DEADLOCK' ? '🔴 DEADLOCK' : systemStatus === 'SAFE' ? '🟢 SAFE' : '🟡 UNSAFE'}
        </span>

        {/* Tick counter */}
        <span className="skeuo-pressed rounded-xl px-3 py-1 text-sm font-mono text-slate-600 flex items-center gap-1">
          ⏱ Tick{' '}
          <span ref={tickRef} className="font-bold text-blue-600 rounded px-1">
            {sim?.tick ?? 0}
          </span>
        </span>

        {/* Policy badge */}
        <span className="skeuo-pressed rounded-xl px-3 py-1 text-xs font-semibold text-slate-500">
          {sim?.policy ?? 'FCFS'}
          {sim?.policy === 'RR' && ` (Q=${sim.rrQuantum})`}
        </span>

        <div className="flex-1" />

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            className={`skeuo-button px-4 py-2 text-sm ${sim?.isPlaying ? 'text-amber-600' : 'text-green-600'}`}
            onClick={() => sendAction(sim?.isPlaying ? 'pause' : 'play')}
            title={sim?.isPlaying ? 'Pause' : 'Play'}
          >
            {sim?.isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
          <button className="skeuo-button px-3 py-2 text-sm" onClick={() => sendAction('step')} title="Step">
            ⏭ Step
          </button>
          <button className="skeuo-button px-3 py-2 text-sm text-red-500" onClick={() => sendAction('reset')} title="Reset">
            ↺ Reset
          </button>
          <button
            className="skeuo-button px-3 py-2 text-sm text-indigo-500"
            title="Open tour"
            onClick={() => { setTourStep(0); setShowTour(true); }}
          >
            ?
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4">

        {/* ── Tab Nav ── */}
        <nav data-tour="tabnav" className="skeuo-pressed rounded-2xl p-1.5 flex gap-1 mb-6 overflow-x-auto">
          {(
            [
              { key: 'overview', label: '📊 Overview' },
              { key: 'banker',   label: '🏦 Safety Check' },
              { key: 'graph',    label: '🕸 Graph' },
              { key: 'recovery', label: '🛡 Recovery' },
              { key: 'replay',   label: '🔁 Replay' },
              { key: 'learn',    label: '📚 Learn' },
              { key: 'manage',   label: '⚙️ Manage' },
            ] as const
          ).map(tab => (
            <button
              key={tab.key}
              className={`flex-1 min-w-max px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === tab.key
                  ? 'glass-card text-blue-700 shadow-md'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* ══════════════════════════════════════════════════════════════════
            OVERVIEW TAB
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <div className="fade-in space-y-5">

            {/* Hero bar */}
            <div className="glass-card rounded-2xl p-5 flex flex-wrap items-center gap-4">
              {/* Animated status */}
              <div className="flex items-center gap-2">
                <span className={statusDotClass(isDeadlocked ? 'BLOCKED' : sim?.isPlaying ? 'RUNNING' : 'WAITING')} />
                <span className="font-semibold text-slate-700">
                  {isDeadlocked ? 'Deadlock Detected' : sim?.isPlaying ? 'Simulation Running' : 'Simulation Paused'}
                </span>
              </div>

              {/* Stat pills */}
              <div className="flex flex-wrap gap-3 flex-1">
                <div className="skeuo-stat min-w-[90px]">
                  <div className="text-2xl font-bold text-blue-600">{analytics?.ticks ?? 0}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Ticks</div>
                </div>
                <div className="skeuo-stat min-w-[90px]">
                  <div className="text-2xl font-bold text-green-600">{analytics?.grants ?? 0}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Grants</div>
                </div>
                <div className="skeuo-stat min-w-[90px]">
                  <div className="text-2xl font-bold text-red-500">{analytics?.denials ?? 0}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Denials</div>
                </div>
                <div className="skeuo-stat min-w-[90px]">
                  <div className="text-2xl font-bold text-amber-600">{analytics?.deadlocksDetected ?? 0}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Deadlocks</div>
                </div>
                <div className="skeuo-stat min-w-[90px]">
                  <div className="text-2xl font-bold text-indigo-600">{analytics?.throughput ?? 0}</div>
                  <div className="text-xs text-slate-500 mt-0.5">Throughput</div>
                </div>
                {/* ── Novelty: Live Deadlock Risk Score ── */}
                {(() => {
                  const risk = (analytics as any)?.deadlockRiskScore ?? 0;
                  const riskColor = risk > 70 ? '#ef4444' : risk > 40 ? '#f59e0b' : '#22c55e';
                  const riskLabel = risk > 70 ? 'HIGH' : risk > 40 ? 'MED' : 'LOW';
                  return (
                    <div className="skeuo-stat min-w-[90px]" style={{ position: 'relative' }}>
                      {/* Mini arc gauge */}
                      <svg width="48" height="28" viewBox="0 0 48 28" style={{ margin: '0 auto', display: 'block' }}>
                        <path d="M 4 24 A 20 20 0 0 1 44 24" fill="none" stroke="#e2e8f0" strokeWidth="5" strokeLinecap="round" />
                        <path
                          d="M 4 24 A 20 20 0 0 1 44 24"
                          fill="none"
                          stroke={riskColor}
                          strokeWidth="5"
                          strokeLinecap="round"
                          strokeDasharray={`${(risk / 100) * 62.8} 62.8`}
                          style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.4s' }}
                        />
                      </svg>
                      <div className="text-sm font-bold mt-0.5" style={{ color: riskColor }}>{risk}% {riskLabel}</div>
                      <div className="text-xs text-slate-500">Risk Score</div>
                    </div>
                  );
                })()}
              </div>

              {/* Quick controls */}
              <div className="flex gap-2">
                <button
                  className={`skeuo-button px-4 py-2 text-sm ${sim?.isPlaying ? 'text-amber-600' : 'text-green-600'}`}
                  onClick={() => sendAction(sim?.isPlaying ? 'pause' : 'play')}
                >
                  {sim?.isPlaying ? '⏸' : '▶'}
                </button>
                <button className="skeuo-button px-3 py-2 text-sm" onClick={() => sendAction('step')}>⏭</button>
              </div>
            </div>

            {/* 3-col grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* Col 1: Processes */}
              <div data-tour="processes" className="space-y-3">
                <h3 className="font-bold text-slate-600 text-sm uppercase tracking-wide px-1">
                  Processes ({sim?.processes?.length ?? 0})
                </h3>
                {(sim?.processes ?? []).map(proc => {
                  const isDeadlockProc = sim?.deadlockedPids?.includes(proc.pid);
                  return (
                    <div
                      key={proc.pid}
                      className={`skeuo-pressed rounded-2xl p-4 card-hover slide-up ${isDeadlockProc ? 'ring-2 ring-red-400 pulse-ring-red' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={statusDotClass(proc.status)} />
                          <span className="font-bold text-slate-700">{proc.pid}</span>
                          {isDeadlockProc && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-semibold">DEADLOCKED</span>}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          proc.status === 'RUNNING' ? 'bg-green-100 text-green-700' :
                          proc.status === 'BLOCKED' ? 'bg-red-100 text-red-700' :
                          proc.status === 'WAITING' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {statusLabel(proc.status)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-slate-500 mb-2">
                        <div><span className="font-semibold">Priority:</span> {proc.priority}</div>
                        <div><span className="font-semibold">Age:</span> {proc.age}</div>
                        <div><span className="font-semibold">Wait:</span> {proc.waitTicks}</div>
                      </div>
                      {/* Contention heat badge */}
                      {(() => {
                        const heat = (analytics as any)?.contentionHeat?.[proc.pid] ?? 0;
                        if (heat === 0) return null;
                        const heatColor = heat > 10 ? '#ef4444' : heat > 5 ? '#f59e0b' : '#94a3b8';
                        return (
                          <div className="text-xs mb-1.5 flex items-center gap-1">
                            <span style={{ color: heatColor }}>🔥</span>
                            <span style={{ color: heatColor, fontWeight: 600 }}>Contention: {heat}</span>
                          </div>
                        );
                      })()}
                      {/* Resource bars */}
                      {proc.allocation.map((alloc, ri) => {
                        const res = sim?.resources?.[ri];
                        if (!res) return null;
                        const maxD = proc.max[ri] ?? 1;
                        const pct = maxD > 0 ? Math.round((alloc / maxD) * 100) : 0;
                        return (
                          <div key={ri} className="mb-1.5">
                            <div className="flex justify-between text-xs text-slate-500 mb-0.5">
                              <span>{resourceIcon(res.type)} {res.label}</span>
                              <span>{alloc}/{maxD}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className="h-full rounded-full bar-fill"
                                style={{ width: `${pct}%`, background: barColor(pct) }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Col 2: Resources */}
              <div data-tour="resources" className="space-y-3">
                <h3 className="font-bold text-slate-600 text-sm uppercase tracking-wide px-1">
                  Resources ({sim?.resources?.length ?? 0})
                </h3>
                {(sim?.resources ?? []).map(res => {
                  const used = res.total - res.available;
                  const pct = res.total > 0 ? Math.round((used / res.total) * 100) : 0;
                  return (
                    <div key={res.id} className="skeuo-pressed rounded-2xl p-4 card-hover slide-up">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{resourceIcon(res.type)}</span>
                          <div>
                            <div className="font-bold text-slate-700">{res.label}</div>
                            <div className="text-xs text-slate-400">{res.id} · {res.type}</div>
                          </div>
                        </div>
                        <span className="text-sm font-bold" style={{ color: barColor(pct) }}>{pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200 overflow-hidden mb-2">
                        <div
                          className="h-full rounded-full bar-fill"
                          style={{ width: `${pct}%`, background: barColor(pct) }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-slate-500 mb-2">
                        <span>Used: <strong>{used}</strong></span>
                        <span>Available: <strong className="text-green-600">{res.available}</strong></span>
                        <span>Total: <strong>{res.total}</strong></span>
                      </div>
                      <div className="flex gap-0.5 flex-wrap">{dotBar(res.available, res.total)}</div>
                    </div>
                  );
                })}

                {/* Analytics utilization */}
                {analytics?.resourceUtilization && analytics.resourceUtilization.length > 0 && (
                  <div className="skeuo-pressed rounded-2xl p-4">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Utilization</div>
                    {analytics.resourceUtilization.map(ru => (
                      <div key={ru.id} className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs text-slate-500 w-16 truncate">{ru.label}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className="h-full rounded-full bar-fill"
                            style={{ width: `${ru.utilizationPct}%`, background: barColor(ru.utilizationPct) }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-600 w-10 text-right">{ru.utilizationPct}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Col 3: Inject + Policy */}
              <div className="space-y-4">
                {/* Inject form */}
                <div data-tour="inject" className="glass-card rounded-2xl p-5">
                  <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <span>💉</span> Inject Request
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-500 font-semibold mb-1 block">Process</label>
                      <select
                        className="skeuo-input"
                        value={injPid}
                        onChange={e => setInjPid(e.target.value)}
                      >
                        <option value="">Select process…</option>
                        {(sim?.processes ?? [])
                          .filter(p => p.status !== 'TERMINATED')
                          .map(p => (
                            <option key={p.pid} value={p.pid}>{p.pid} ({statusLabel(p.status)})</option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 font-semibold mb-1 block">Resource</label>
                      <select
                        className="skeuo-input"
                        value={injResIdx}
                        onChange={e => setInjResIdx(Number(e.target.value))}
                      >
                        {(sim?.resources ?? []).map((r, i) => (
                          <option key={r.id} value={i}>{r.label} (avail: {r.available}/{r.total})</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500 font-semibold mb-1 block">Amount</label>
                        <input
                          type="number" min={1} max={10}
                          className="skeuo-input"
                          value={injAmount}
                          onChange={e => setInjAmount(Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 font-semibold mb-1 block">Priority</label>
                        <input
                          type="number" min={0} max={10}
                          className="skeuo-input"
                          value={injPriority}
                          onChange={e => setInjPriority(Number(e.target.value))}
                        />
                      </div>
                    </div>
                    {injError && (
                      <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{injError}</div>
                    )}
                    <div className="flex gap-2">
                      <button className="skeuo-button flex-1 text-sm text-blue-600" onClick={injectRequest}>
                        + Inject
                      </button>
                      <button className="skeuo-button px-3 py-2 text-sm text-red-500" onClick={clearQueue} title="Clear queue">
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* Queue preview */}
                  {queue.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-white/30">
                      <div className="text-xs font-semibold text-slate-500 mb-2">Queue ({queue.length})</div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {queue.map(q => (
                          <div key={q.id} className="flex justify-between text-xs text-slate-600 bg-white/30 rounded-lg px-2 py-1">
                            <span className="font-semibold">{q.pid}</span>
                            <span>R{q.resourceIdx} ×{q.amount}</span>
                            <span className="text-slate-400">p={q.priority}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Policy selector */}
                <div className="glass-card rounded-2xl p-5">
                  <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <span>⚙️</span> Scheduler Policy
                  </h3>
                  <div className="space-y-3">
                    <select
                      className="skeuo-input"
                      value={policyDraft}
                      onChange={e => setPolicyDraft(e.target.value as SchedulerPolicy)}
                    >
                      <option value="FCFS">FCFS — First Come First Served</option>
                      <option value="RR">RR — Round Robin</option>
                      <option value="PRIORITY">PRIORITY — Highest Priority First</option>
                      <option value="PRIORITY_AGING">PRIORITY_AGING — Priority with Aging</option>
                    </select>
                    {policyDraft === 'RR' && (
                      <div>
                        <label className="text-xs text-slate-500 font-semibold mb-1 block">RR Quantum</label>
                        <input
                          type="number" min={1} max={20}
                          className="skeuo-input"
                          value={rrQuantumDraft}
                          onChange={e => setRrQuantumDraft(Number(e.target.value))}
                        />
                      </div>
                    )}
                    <button className="skeuo-button w-full text-sm text-indigo-600" onClick={applyPolicy}>
                      Apply Policy
                    </button>
                  </div>
                </div>

                {/* Extra stats */}
                <div className="skeuo-pressed rounded-2xl p-4 grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <div className="text-lg font-bold text-slate-700">{analytics?.activeProcesses ?? 0}</div>
                    <div className="text-xs text-slate-500">Active</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-slate-700">{analytics?.terminatedCount ?? 0}</div>
                    <div className="text-xs text-slate-500">Completed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-slate-700">{analytics?.avgWaitTicks ?? 0}</div>
                    <div className="text-xs text-slate-500">Avg Wait</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-slate-700">{analytics?.recoveriesApplied ?? 0}</div>
                    <div className="text-xs text-slate-500">Recoveries</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            SAFETY CHECK TAB (Banker's Algorithm)
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'banker' && (
          <div className="fade-in space-y-5">
            {/* Friendly intro */}
            <div className="glass-card rounded-2xl p-5">
              <h2 className="text-lg font-bold text-slate-700 mb-1 flex items-center gap-2">
                🏦 Banker's Algorithm — Safety Analysis
              </h2>
              <p className="text-slate-500 text-sm leading-relaxed">
                Before granting any resource request, the Banker's Algorithm simulates the allocation and checks
                whether the system can still reach a <strong>safe state</strong> — a sequence where every process
                can eventually finish. If no safe sequence exists, the request is denied to prevent deadlock.
              </p>
            </div>

            {/* Big safe/unsafe status card */}
            {sim?.bankersResult ? (
              <div className={`glass-card rounded-2xl p-6 ${sim.bankersResult.safe ? 'ring-2 ring-green-400' : 'ring-2 ring-red-400 pulse-ring-red'}`}>
                <div className="flex items-center gap-4 mb-4">
                  <span className="text-5xl">{sim.bankersResult.safe ? '✅' : '🚨'}</span>
                  <div>
                    <div className={`text-2xl font-extrabold ${sim.bankersResult.safe ? 'text-green-600' : 'text-red-600'}`}>
                      {sim.bankersResult.safe ? 'System is SAFE' : 'System is UNSAFE'}
                    </div>
                    <div className="text-slate-500 text-sm mt-1">
                      {sim.bankersResult.safe
                        ? 'All processes can complete without deadlocking.'
                        : 'No safe sequence found — deadlock risk is high!'}
                    </div>
                  </div>
                </div>

                {/* Safe sequence */}
                {sim.bankersResult.safe && sim.bankersResult.safeSequence.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Safe Sequence</div>
                    <div className="flex flex-wrap items-center gap-1">
                      {sim.bankersResult.safeSequence.map((pid, i) => (
                        <span key={i} className="seq-arrow">
                          <span className="inline-block bg-green-100 text-green-700 font-bold px-3 py-1 rounded-full text-sm">
                            {pid}
                          </span>
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      Processes can complete in this order — each one releases resources for the next.
                    </p>
                  </div>
                )}

                {/* Unsafe: show deadlocked pids */}
                {!sim.bankersResult.safe && sim.deadlockedPids.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-bold text-red-500 uppercase tracking-wide mb-2">Deadlocked Processes</div>
                    <div className="flex flex-wrap gap-2">
                      {sim.deadlockedPids.map(pid => (
                        <span key={pid} className="bg-red-100 text-red-700 font-bold px-3 py-1 rounded-full text-sm">
                          {pid}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <BankersStepsSection steps={sim.bankersResult.steps} />
              </div>
            ) : (
              <div className="glass-card rounded-2xl p-8 text-center text-slate-400">
                <div className="text-4xl mb-2">🏦</div>
                <div>No Banker's result yet. Start the simulation to see safety analysis.</div>
              </div>
            )}

            {/* Resource matrix summary */}
            {sim && sim.processes.length > 0 && (
              <div className="glass-card rounded-2xl p-5">
                <h3 className="font-bold text-slate-700 mb-3">Resource Allocation Matrix</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-slate-600 border-collapse">
                    <thead>
                      <tr className="skeuo-pressed">
                        <th className="px-3 py-2 text-left">PID</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        {sim.resources.map(r => (
                          <th key={r.id} className="px-3 py-2 text-center" colSpan={3}>
                            {r.label}
                          </th>
                        ))}
                      </tr>
                      <tr className="bg-white/10">
                        <th className="px-3 py-1" />
                        <th className="px-3 py-1" />
                        {sim.resources.map(r => (
                          <>
                            <th key={`${r.id}-a`} className="px-2 py-1 text-center text-slate-400 font-normal">Alloc</th>
                            <th key={`${r.id}-m`} className="px-2 py-1 text-center text-slate-400 font-normal">Max</th>
                            <th key={`${r.id}-n`} className="px-2 py-1 text-center text-slate-400 font-normal">Need</th>
                          </>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sim.processes.map((p, i) => (
                        <tr key={p.pid} className={i % 2 === 0 ? 'bg-white/20' : 'bg-white/10'}>
                          <td className="px-3 py-2 font-bold text-blue-700">{p.pid}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1`}>
                              <span className={statusDotClass(p.status)} />
                              {statusLabel(p.status)}
                            </span>
                          </td>
                          {sim.resources.map((_, ri) => (
                            <>
                              <td key={`${p.pid}-${ri}-a`} className="px-2 py-2 text-center font-mono">{p.allocation[ri] ?? 0}</td>
                              <td key={`${p.pid}-${ri}-m`} className="px-2 py-2 text-center font-mono text-slate-400">{p.max[ri] ?? 0}</td>
                              <td key={`${p.pid}-${ri}-n`} className="px-2 py-2 text-center font-mono text-amber-600">{p.need[ri] ?? 0}</td>
                            </>
                          ))}
                        </tr>
                      ))}
                      {/* Available row */}
                      <tr className="border-t-2 border-white/30 bg-white/30">
                        <td className="px-3 py-2 font-bold text-slate-600" colSpan={2}>Available</td>
                        {sim.resources.map((r, ri) => (
                          <>
                            <td key={`avail-${ri}`} className="px-2 py-2 text-center font-bold text-green-600" colSpan={3}>{r.available}</td>
                          </>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            GRAPH TAB
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'graph' && (
          <div className="fade-in space-y-5">
            {/* RAG/WFG toggle */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="skeuo-pressed rounded-2xl p-1.5 flex gap-1">
                <button
                  className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                    graphMode === 'rag' ? 'glass-card text-blue-700 shadow-md' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  onClick={() => setGraphMode('rag')}
                >
                  🕸 RAG
                </button>
                <button
                  className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                    graphMode === 'wfg' ? 'glass-card text-blue-700 shadow-md' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  onClick={() => setGraphMode('wfg')}
                >
                  ⏳ WFG
                </button>
              </div>
              <p className="text-slate-500 text-sm">
                {graphMode === 'rag'
                  ? 'Resource Allocation Graph — circles are processes, rectangles are resources. Green arrows = allocated, blue arrows = requested.'
                  : 'Wait-For Graph — shows which processes are waiting for each other. A cycle here means deadlock.'}
              </p>
            </div>

            {/* Graph visualizer */}
            <div className="glass-card rounded-2xl p-4 min-h-[420px]">
              <GraphVisualizer mode={graphMode} refreshKey={graphRefreshKey} />
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3">
              <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">● Process (circle)</span>
              <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">■ Resource (rect)</span>
              <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">→ Allocated</span>
              <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-600">→ Requested</span>
              <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">→ In Cycle (deadlock)</span>
            </div>

            {/* Cycle alert */}
            {isDeadlocked && (
              <div className="glass-card rounded-2xl p-4 ring-2 ring-red-400 pulse-ring-red">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🔴</span>
                  <span className="font-bold text-red-700">Deadlock Cycle Detected!</span>
                </div>
                {(sim?.wfgCycles ?? []).map((cycle, i) => (
                  <div key={i} className="text-sm text-red-600 font-mono bg-red-50 rounded-lg px-3 py-1.5 mb-1">
                    {cycle.join(' → ')} → {cycle[0]}
                  </div>
                ))}
                <p className="text-xs text-slate-500 mt-2">
                  Go to the <strong>Recovery</strong> tab to resolve this deadlock.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            RECOVERY TAB
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'recovery' && (
          <div className="fade-in space-y-5">
            {!isDeadlocked ? (
              /* No deadlock */
              <div className="glass-card rounded-2xl p-8 text-center ring-2 ring-green-300">
                <div className="text-5xl mb-3">✅</div>
                <div className="text-xl font-bold text-green-700 mb-1">No Deadlock Detected</div>
                <div className="text-slate-500 text-sm">
                  The system is currently running without any circular waits. Keep an eye on the Graph tab for early warning signs.
                </div>
              </div>
            ) : (
              /* Deadlock detected */
              <div className="space-y-4">
                {/* Red alert */}
                <div className="glass-card rounded-2xl p-5 ring-2 ring-red-400 pulse-ring-red">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-3xl">🚨</span>
                    <div>
                      <div className="text-lg font-bold text-red-700">Deadlock Detected!</div>
                      <div className="text-sm text-slate-500">
                        {(recovery?.deadlockedPids ?? []).length} process(es) are stuck in a circular wait.
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(recovery?.deadlockedPids ?? []).map(pid => (
                      <span key={pid} className="bg-red-100 text-red-700 font-bold px-3 py-1 rounded-full text-sm">
                        {pid}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Suggested victim */}
                {recovery?.suggestedVictim && (
                  <div className="glass-card rounded-2xl p-5 ring-2 ring-amber-300">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl">💡</span>
                      <span className="font-bold text-amber-700">Suggested Victim: {recovery.suggestedVictim}</span>
                    </div>
                    <p className="text-sm text-slate-500">
                      Preempting this process has the lowest cost — it holds fewer resources and has lower priority.
                    </p>
                    <button
                      className="skeuo-button mt-3 text-sm text-amber-700"
                      onClick={() => {
                        const v = recovery.victims.find(x => x.pid === recovery.suggestedVictim);
                        if (v) applyRecovery(v);
                      }}
                    >
                      ⚡ Preempt {recovery.suggestedVictim}
                    </button>
                  </div>
                )}

                {/* Victim table */}
                {(recovery?.victims ?? []).length > 0 && (
                  <div className="glass-card rounded-2xl p-5">
                    <h3 className="font-bold text-slate-700 mb-3">All Victim Candidates</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-slate-600 border-collapse">
                        <thead>
                          <tr className="skeuo-pressed">
                            <th className="px-3 py-2 text-left">Process</th>
                            <th className="px-3 py-2 text-center">Cost</th>
                            <th className="px-3 py-2 text-center">Impact</th>
                            <th className="px-3 py-2 text-left">Breakdown</th>
                            <th className="px-3 py-2 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(recovery?.victims ?? []).map((v, i) => (
                            <tr key={v.pid} className={i % 2 === 0 ? 'bg-white/20' : 'bg-white/10'}>
                              <td className="px-3 py-2 font-bold text-blue-700">{v.pid}</td>
                              <td className="px-3 py-2 text-center font-mono font-bold">{v.cost}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  v.impact === 'low' ? 'bg-green-100 text-green-700' :
                                  v.impact === 'medium' ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {v.impact}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-xs text-slate-400">
                                {Object.entries(v.costBreakdown).map(([k, val]) => `${k}:${val}`).join(' · ')}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  className="skeuo-button text-xs px-3 py-1 text-red-600"
                                  onClick={() => applyRecovery(v)}
                                >
                                  Preempt
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Rollback button */}
                <div className="glass-card rounded-2xl p-5">
                  <h3 className="font-bold text-slate-700 mb-2 flex items-center gap-2">
                    <span>⏪</span> Rollback to Latest Checkpoint
                  </h3>
                  <p className="text-sm text-slate-500 mb-3">
                    Restore the system to the most recent saved state before the deadlock occurred.
                  </p>
                  <button className="skeuo-button text-sm text-indigo-600" onClick={rollback}>
                    ⏪ Rollback Now
                  </button>
                </div>
              </div>
            )}

            {/* Checkpoint list */}
            {(recovery?.checkpoints ?? []).length > 0 && (
              <div className="glass-card rounded-2xl p-5">
                <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <span>💾</span> Saved Checkpoints
                </h3>
                <div className="space-y-2">
                  {(recovery?.checkpoints ?? []).map(cp => (
                    <div key={cp.id} className="skeuo-pressed rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-700 text-sm">{cp.description}</div>
                        <div className="text-xs text-slate-400">Tick {cp.tick} · {fmtTime(cp.ts)}</div>
                      </div>
                      <button
                        className="skeuo-button text-xs px-3 py-1.5 text-indigo-600"
                        onClick={() => restoreCheckpoint(cp.id)}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            REPLAY TAB
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'replay' && (
          <div className="fade-in space-y-5">
            <div className="glass-card rounded-2xl p-5">
              <h2 className="text-lg font-bold text-slate-700 mb-1 flex items-center gap-2">
                🔁 Deterministic Replay
              </h2>
              <p className="text-slate-500 text-sm mb-4">
                Enter a seed number to reproduce any simulation exactly. The same seed always generates the same sequence of events — great for debugging and demonstrations.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="text-xs text-slate-500 font-semibold mb-1 block">Seed</label>
                  <input
                    type="number"
                    className="skeuo-input"
                    value={replaySeed}
                    onChange={e => setReplaySeed(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-semibold mb-1 block">Steps (max 50)</label>
                  <input
                    type="number" min={1} max={50}
                    className="skeuo-input"
                    value={replaySteps}
                    onChange={e => setReplaySteps(Math.min(50, Number(e.target.value)))}
                  />
                </div>
                <div className="flex items-end">
                  <button className="skeuo-button w-full text-sm text-blue-600" onClick={loadReplay}>
                    ▶ Run Replay
                  </button>
                </div>
              </div>
            </div>

            {replayResult && (
              <div className="space-y-4 slide-up">
                {/* Summary stats */}
                <div className="glass-card rounded-2xl p-5">
                  <h3 className="font-bold text-slate-700 mb-3">Replay Summary — Seed {replayResult.seed}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="skeuo-stat">
                      <div className="text-xl font-bold text-blue-600">{replayResult.steps}</div>
                      <div className="text-xs text-slate-500">Ticks Run</div>
                    </div>
                    <div className="skeuo-stat">
                      <div className="text-xl font-bold text-red-500">{replayResult.deadlockedPids?.length ?? 0}</div>
                      <div className="text-xs text-slate-500">Deadlocked</div>
                    </div>
                    <div className="skeuo-stat">
                      <div className="text-xl font-bold text-green-600">
                        {replayResult.processes?.filter(p => p.status === 'TERMINATED').length ?? 0}
                      </div>
                      <div className="text-xs text-slate-500">Completed</div>
                    </div>
                    <div className="skeuo-stat">
                      <div className={`text-xl font-bold ${replayResult.bankersResult?.safe ? 'text-green-600' : 'text-red-500'}`}>
                        {replayResult.bankersResult?.safe ? 'SAFE' : 'UNSAFE'}
                      </div>
                      <div className="text-xs text-slate-500">Final State</div>
                    </div>
                  </div>
                </div>

                {/* Replay event log */}
                {replayResult.replayLog && replayResult.replayLog.length > 0 && (
                  <div className="glass-card rounded-2xl p-5">
                    <h3 className="font-bold text-slate-700 mb-3">Replay Event Log ({replayResult.replayLog.length} events)</h3>
                    <div className="space-y-1.5 max-h-80 overflow-y-auto">
                      {replayResult.replayLog.map(ev => (
                        <div key={ev.id} className="flex items-start gap-2 text-xs">
                          <span className={`px-2 py-0.5 rounded-full font-semibold shrink-0 ${eventBadgeColor(ev.level)}`}>
                            {ev.type}
                          </span>
                          <span className="text-slate-400 shrink-0">T{ev.tick}</span>
                          <span className="text-slate-600">{ev.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            LEARN TAB
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'learn' && (
          <div className="fade-in space-y-3">
            <div className="glass-card rounded-2xl p-5 mb-2">
              <h2 className="text-lg font-bold text-slate-700 mb-1">📚 Learn About Deadlocks</h2>
              <p className="text-slate-500 text-sm">
                Expand any section below to learn the concepts behind this simulation — from what a deadlock is to how recovery works.
              </p>
            </div>
            {LEARN_SECTIONS.map((section, i) => (
              <div key={i} className="glass-card rounded-2xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-left"
                  onClick={() => setLearnOpen(prev => prev.map((v, j) => j === i ? !v : v))}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{section.icon}</span>
                    <span className="font-bold text-slate-700">{section.title}</span>
                  </div>
                  <span className="text-slate-400 text-lg">{learnOpen[i] ? '▲' : '▼'}</span>
                </button>
                {learnOpen[i] && (
                  <div className="px-5 pb-5 slide-up">
                    <p className="text-slate-600 text-sm leading-relaxed mb-3">{section.body}</p>
                    <div className="skeuo-pressed rounded-xl p-3">
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Example</div>
                      <div className="text-sm font-mono text-blue-700">{section.example}</div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            MANAGE TAB — Add/Remove Processes & Resources, Presets, Speed
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'manage' && (
          <div className="fade-in space-y-5">

            {/* ── Scenario Presets ── */}
            <div className="glass-card rounded-2xl p-5">
              <h2 className="text-base font-bold text-slate-700 mb-1 flex items-center gap-2">
                🎭 Scenario Presets
              </h2>
              <p className="text-slate-500 text-xs mb-4">
                Load a classic textbook scenario instantly. This replaces the current simulation.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { key: 'classic_deadlock',     icon: '🔴', label: 'Classic Deadlock',       desc: '2 processes, circular wait' },
                  { key: 'safe_state',            icon: '✅', label: 'Safe State',             desc: 'Silberschatz textbook (5P, 3R)' },
                  { key: 'starvation',            icon: '⏳', label: 'Starvation',             desc: 'Low-priority processes starved' },
                  { key: 'dining_philosophers',   icon: '🍽', label: 'Dining Philosophers',    desc: '5 philosophers, 5 forks' },
                ].map(p => (
                  <button
                    key={p.key}
                    onClick={() => loadPreset(p.key)}
                    className="skeuo-flat rounded-2xl p-4 text-left card-hover"
                  >
                    <div className="text-2xl mb-1">{p.icon}</div>
                    <div className="font-bold text-slate-700 text-sm">{p.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Export / Import ── */}
            <div className="glass-card rounded-2xl p-5">
              <h2 className="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
                📁 Export / Import Scenario
              </h2>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={exportScenarioHandler}
                  className="skeuo-button text-sm text-blue-600 px-5 py-2"
                >
                  ⬇ Export as JSON
                </button>
                <label className="skeuo-button text-sm text-indigo-600 px-5 py-2 cursor-pointer">
                  ⬆ Import JSON
                  <input
                    type="file" accept=".json" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) importScenarioHandler(f); }}
                  />
                </label>
              </div>
            </div>

            {/* ── Simulation Speed & Starvation Threshold ── */}
            <div className="glass-card rounded-2xl p-5">
              <h2 className="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
                ⚡ Simulation Settings
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">
                    Tick Speed
                    <span className="text-slate-400 font-normal ml-1">({speedMs}ms per tick)</span>
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: '🐇 Fast', ms: 300 },
                      { label: '🚶 Normal', ms: 1000 },
                      { label: '🐢 Slow', ms: 2500 },
                    ].map(s => (
                      <button
                        key={s.ms}
                        onClick={() => setSpeedMs(s.ms)}
                        className={`skeuo-button text-xs px-3 py-1.5 ${speedMs === s.ms ? 'text-blue-600' : 'text-slate-500'}`}
                      >
                        {s.label}
                      </button>
                    ))}
                    <input
                      type="number" min={100} max={5000} step={100}
                      value={speedMs}
                      onChange={e => setSpeedMs(Number(e.target.value))}
                      className="skeuo-input w-24 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1 block">
                    Starvation Threshold
                    <span className="text-slate-400 font-normal ml-1">(ticks before BLOCKED)</span>
                  </label>
                  <input
                    type="number" min={5} max={100}
                    value={starvThreshold}
                    onChange={e => setStarvThreshold(Number(e.target.value))}
                    className="skeuo-input text-sm"
                  />
                </div>
              </div>
              <button onClick={applySpeedAndThreshold} className="skeuo-button text-sm text-indigo-600 px-5 py-2">
                Apply Settings
              </button>
            </div>

            {/* ── Add / Remove Processes ── */}
            <div className="glass-card rounded-2xl p-5">
              <h2 className="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
                ⚙️ Processes
                <span className="text-xs font-normal text-slate-400">({sim?.processes?.length ?? 0} active)</span>
              </h2>

              {/* Existing processes */}
              <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                {(sim?.processes ?? []).map(p => (
                  <div key={p.pid} className="skeuo-pressed rounded-xl px-4 py-2 flex items-center gap-3">
                    <span className={statusDotClass(p.status)} />
                    <span className="font-bold text-slate-700 w-10">{p.pid}</span>
                    <span className="text-xs text-slate-500 flex-1">
                      alloc [{p.allocation.join(',')}] · max [{p.max.join(',')}] · pri {p.priority}
                      {p.burstTime != null && ` · burst ${p.remainingTime}/${p.burstTime}`}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      p.status === 'RUNNING' ? 'bg-green-100 text-green-700' :
                      p.status === 'BLOCKED' ? 'bg-red-100 text-red-700' :
                      p.status === 'WAITING' ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-100 text-slate-500'
                    }`}>{statusLabel(p.status)}</span>
                    <button
                      onClick={() => removeProcessHandler(p.pid)}
                      className="text-red-400 hover:text-red-600 text-sm font-bold transition-colors"
                      title={`Remove ${p.pid}`}
                    >✕</button>
                  </div>
                ))}
              </div>

              {/* Add new process */}
              <div className="skeuo-pressed rounded-xl p-4 space-y-3">
                <div className="text-xs font-bold text-slate-600 uppercase tracking-wide">Add New Process</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">PID (optional)</label>
                    <input
                      className="skeuo-input text-sm"
                      value={newProcPid}
                      onChange={e => setNewProcPid(e.target.value)}
                      placeholder="auto"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-500 mb-1 block">
                      Max demand per resource
                      <span className="text-slate-400 ml-1">(comma-separated, e.g. 3,2)</span>
                    </label>
                    <input
                      className="skeuo-input text-sm"
                      value={newProcMax}
                      onChange={e => setNewProcMax(e.target.value)}
                      placeholder={`e.g. ${(sim?.resources ?? []).map(() => '2').join(',')}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Priority</label>
                    <input
                      type="number" min={0} max={10}
                      className="skeuo-input text-sm"
                      value={newProcPriority}
                      onChange={e => setNewProcPriority(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Burst Time (ticks)</label>
                    <input
                      type="number" min={1} max={50}
                      className="skeuo-input text-sm"
                      value={newProcBurst}
                      onChange={e => setNewProcBurst(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex items-end">
                    <button onClick={addProcessHandler} className="skeuo-button w-full text-sm text-blue-600 py-2">
                      + Add Process
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Add / Remove Resources ── */}
            <div className="glass-card rounded-2xl p-5">
              <h2 className="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
                📦 Resources
                <span className="text-xs font-normal text-slate-400">({sim?.resources?.length ?? 0} defined)</span>
              </h2>

              {/* Existing resources */}
              <div className="space-y-2 mb-4">
                {(sim?.resources ?? []).map(r => {
                  const used = r.total - r.available;
                  const pct = Math.round((used / Math.max(r.total, 1)) * 100);
                  return (
                    <div key={r.id} className="skeuo-pressed rounded-xl px-4 py-2 flex items-center gap-3">
                      <span className="text-lg">{resourceIcon(r.type)}</span>
                      <span className="font-bold text-slate-700 w-16">{r.label}</span>
                      <span className="text-xs text-slate-500 flex-1">
                        {r.id} · {used}/{r.total} used · {pct}%
                      </span>
                      <div className="w-20 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div className="h-full rounded-full bar-fill" style={{ width: `${pct}%`, background: barColor(pct) }} />
                      </div>
                      <button
                        onClick={() => removeResourceHandler(r.id)}
                        className="text-red-400 hover:text-red-600 text-sm font-bold transition-colors"
                        title={`Remove ${r.id}`}
                      >✕</button>
                    </div>
                  );
                })}
              </div>

              {/* Add new resource */}
              <div className="skeuo-pressed rounded-xl p-4 space-y-3">
                <div className="text-xs font-bold text-slate-600 uppercase tracking-wide">Add New Resource</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-slate-500 mb-1 block">Label</label>
                    <input
                      className="skeuo-input text-sm"
                      value={newResLabel}
                      onChange={e => setNewResLabel(e.target.value)}
                      placeholder="e.g. GPU, Disk, Lock"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Total Units</label>
                    <input
                      type="number" min={1} max={100}
                      className="skeuo-input text-sm"
                      value={newResTotal}
                      onChange={e => setNewResTotal(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Type</label>
                    <select
                      className="skeuo-input text-sm"
                      value={newResType}
                      onChange={e => setNewResType(e.target.value)}
                    >
                      <option value="CPU">CPU</option>
                      <option value="MEMORY">Memory</option>
                      <option value="IO">IO</option>
                      <option value="NETWORK">Network</option>
                      <option value="GENERIC">Generic</option>
                    </select>
                  </div>
                </div>
                <button onClick={addResourceHandler} className="skeuo-button text-sm text-blue-600 px-5 py-2">
                  + Add Resource
                </button>
              </div>
            </div>

            {/* Error display */}
            {manageError && (
              <div className="glass-card rounded-2xl p-4 border border-red-200 bg-red-50/60">
                <span className="text-red-600 text-sm font-semibold">⚠ {manageError}</span>
                <button onClick={() => setManageError('')} className="ml-3 text-red-400 text-xs">dismiss</button>
              </div>
            )}

          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            EVENT LOG (always visible, collapsible)
        ══════════════════════════════════════════════════════════════════ */}
        <div className="mt-6 glass-card rounded-2xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-3 text-left"
            onClick={() => setEventsOpen(o => !o)}
          >
            <div className="flex items-center gap-2">
              <span>📋</span>
              <span className="font-bold text-slate-700">Activity Log</span>
              <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {events.length}
              </span>
            </div>
            <span className="text-slate-400">{eventsOpen ? '▲' : '▼'}</span>
          </button>
          {eventsOpen && (
            <div className="px-5 pb-4 max-h-64 overflow-y-auto space-y-1.5 fade-in">
              {events.length === 0 && (
                <div className="text-slate-400 text-sm text-center py-4">No events yet. Start the simulation!</div>
              )}
              {events.slice(0, 20).map(ev => (
                <div key={ev.id} className="flex items-start gap-2 text-xs">
                  <span className={`px-2 py-0.5 rounded-full font-semibold shrink-0 ${eventBadgeColor(ev.level)}`}>
                    {ev.type}
                  </span>
                  <span className="text-slate-400 shrink-0">T{ev.tick}</span>
                  <span className="text-slate-400 shrink-0">{fmtTime(ev.ts)}</span>
                  <span className="text-slate-600">{ev.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
