import { store } from '../store';

export async function GET() {
  return {
    ...store.analytics,
    tick: store.simulation.tick,
    policy: store.simulation.policy,
    activeProcesses: store.processes.filter(p => p.status !== 'TERMINATED').length,
    totalProcesses: store.processes.length,
    resourceUtilization: store.resources.map(r => ({
      id: r.id,
      label: r.label,
      total: r.total,
      available: r.available,
      used: r.total - r.available,
      utilizationPct: parseFloat(((r.total - r.available) / Math.max(1, r.total) * 100).toFixed(1)),
    })),
  };
}
