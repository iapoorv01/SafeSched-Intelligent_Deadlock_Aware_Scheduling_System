import {
  store, addEvent,
  addProcess, removeProcess,
  addResource, removeResource,
  loadScenarioPreset, exportScenario, importScenario,
  type ScenarioPreset,
} from '../store';

export async function GET() {
  return {
    processes: store.processes,
    resources: store.resources,
    requestQueue: store.requestQueue,
    policy: store.simulation.policy,
    rrQuantum: store.simulation.rrQuantum,
    tickIntervalMs: store.simulation.tickIntervalMs,
    starvationThreshold: store.simulation.starvationThreshold,
  };
}

export async function POST(body: {
  action?: 'add_process' | 'remove_process' | 'add_resource' | 'remove_resource' | 'load_preset' | 'import';
  // add_process
  pid?: string; max?: number[]; priority?: number; criticality?: number; burstTime?: number;
  // remove_process / remove_resource
  id?: string;
  // add_resource
  label?: string; total?: number; type?: string;
  // load_preset
  preset?: ScenarioPreset;
  // import
  scenario?: any;
  // settings
  tickIntervalMs?: number;
  starvationThreshold?: number;
}) {
  const { action } = body;

  // Settings update (no action needed)
  if (body.tickIntervalMs != null && body.tickIntervalMs > 0) {
    store.simulation.tickIntervalMs = body.tickIntervalMs;
    addEvent('SYSTEM', 'info', `Tick interval set to ${body.tickIntervalMs}ms`);
  }
  if (body.starvationThreshold != null && body.starvationThreshold > 0) {
    store.simulation.starvationThreshold = body.starvationThreshold;
    addEvent('SYSTEM', 'info', `Starvation threshold set to ${body.starvationThreshold} ticks`);
  }

  if (action === 'add_process') {
    if (!body.max) throw new Error('max array required');
    const proc = addProcess({
      pid: body.pid,
      max: body.max,
      priority: body.priority,
      criticality: body.criticality,
      burstTime: body.burstTime,
    });
    return { success: true, process: proc, processes: store.processes };
  }

  if (action === 'remove_process') {
    if (!body.id) throw new Error('id required');
    removeProcess(body.id);
    return { success: true, processes: store.processes };
  }

  if (action === 'add_resource') {
    if (!body.label || !body.total) throw new Error('label and total required');
    const res = addResource({
      id: body.id,
      label: body.label,
      total: body.total,
      type: body.type as any,
    });
    return { success: true, resource: res, resources: store.resources };
  }

  if (action === 'remove_resource') {
    if (!body.id) throw new Error('id required');
    removeResource(body.id);
    return { success: true, resources: store.resources };
  }

  if (action === 'load_preset') {
    if (!body.preset) throw new Error('preset required');
    loadScenarioPreset(body.preset);
    return {
      success: true,
      processes: store.processes,
      resources: store.resources,
      requestQueue: store.requestQueue,
    };
  }

  if (action === 'import') {
    if (!body.scenario) throw new Error('scenario required');
    importScenario(body.scenario);
    return {
      success: true,
      processes: store.processes,
      resources: store.resources,
    };
  }

  // Default: return current scenario
  return {
    processes: store.processes,
    resources: store.resources,
    requestQueue: store.requestQueue,
  };
}

export async function DELETE() {
  // Export before reset
  const exported = exportScenario();
  return { exported };
}
