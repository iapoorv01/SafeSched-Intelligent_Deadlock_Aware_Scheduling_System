import { store, buildRAG, buildWFG, detectCycles } from '../store';

export async function GET(params?: { type?: 'rag' | 'wfg' }) {
  const type = params?.type ?? 'rag';

  if (type === 'wfg') {
    const wfg = buildWFG();
    const cycles = detectCycles(wfg);
    const deadSet = new Set(store.simulation.deadlockedPids);
    const cycleSet = new Set(cycles.flat());

    const nodes = store.processes.map(p => ({
      id: p.pid,
      label: p.pid,
      type: 'process' as const,
      status: p.status,
      deadlocked: deadSet.has(p.pid),
      inCycle: cycleSet.has(p.pid),
    }));

    const edges: Array<{ source: string; target: string; type: 'wait'; inCycle: boolean }> = [];
    for (const [from, tos] of Object.entries(wfg)) {
      for (const to of tos) {
        const inCycle = cycles.some(c => c.includes(from) && c.includes(to));
        edges.push({ source: from, target: to, type: 'wait', inCycle });
      }
    }

    return { nodes, edges, cycles, deadlockedPids: store.simulation.deadlockedPids };
  }

  // Default: RAG
  const rag = buildRAG();
  return {
    ...rag,
    deadlockedPids: store.simulation.deadlockedPids,
    currentPid: store.simulation.currentPid,
  };
}
