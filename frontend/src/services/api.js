/**
 * SafeSched API Service Layer
 * Connects to FastAPI backend at BASE_URL
 * All endpoints mirror your Phase 7 route definitions
 */

export const BASE_URL = import.meta.env?.VITE_API_URL || "http://localhost:8000";
export const WS_URL   = BASE_URL.replace(/^http/, "ws");

// ─── helpers ────────────────────────────────────────────────────────────────

async function request(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

const get  = (path)        => request("GET",    path);
const post = (path, body)  => request("POST",   path, body);
const del  = (path)        => request("DELETE", path);


// ─── SCENARIO ───────────────────────────────────────────────────────────────

/**
 * POST /scenario/create
 * body: { processes, resources, allocation, max, available }
 */
export const createScenario = (payload) => post("/scenario/create", payload);

/**
 * POST /scenario/load
 * body: JSON scenario object (exported previously)
 */
export const loadScenario = (scenarioJson) => post("/scenario/load", scenarioJson);

/**
 * POST /scenario/reset
 */
export const resetScenario = () => post("/scenario/reset");

/**
 * GET /scenario/export
 * Returns the full scenario as a JSON object for download
 */
export const exportScenario = () => get("/scenario/export");


// ─── SIMULATION ─────────────────────────────────────────────────────────────

/**
 * POST /simulation/start
 * body: { seed?: number, auto?: boolean, steps?: number }
 */
export const startSimulation = (opts = {}) => post("/simulation/start", opts);

/**
 * POST /simulation/step
 * Advance one event tick
 */
export const stepSimulation = () => post("/simulation/step");

/**
 * POST /simulation/auto
 * body: { steps: number }
 */
export const autoSimulation = (steps = 10) => post("/simulation/auto", { steps });

/**
 * POST /simulation/pause
 */
export const pauseSimulation = () => post("/simulation/pause");

/**
 * POST /simulation/stop
 */
export const stopSimulation = () => post("/simulation/stop");

/**
 * GET /simulation/state
 * Returns: { processes, resources, logs, step, running }
 */
export const getSimulationState = () => get("/simulation/state");

/**
 * GET /simulation/logs
 * Query params: ?limit=50&type=grant|deny|warn|info
 */
export const getLogs = (limit = 50, type = null) => {
  const qs = new URLSearchParams({ limit });
  if (type) qs.set("type", type);
  return get(`/simulation/logs?${qs}`);
};


// ─── REQUESTS ───────────────────────────────────────────────────────────────

/**
 * POST /request/submit
 * body: { pid, resource_vector: number[], priority?: number }
 */
export const submitRequest = (pid, resourceVector, priority = 5) =>
  post("/request/submit", { pid, resource_vector: resourceVector, priority });

/**
 * GET /request/queue
 * Returns current request queue items
 */
export const getQueue = () => get("/request/queue");


// ─── ANALYSIS ───────────────────────────────────────────────────────────────

/**
 * GET /analysis/banker
 * Returns: { safe, sequence, explanation_steps }
 */
export const runBankerCheck = () => get("/analysis/banker");

/**
 * GET /analysis/deadlock
 * Returns: { deadlocked_processes, cycles, method: "matrix"|"wfg" }
 */
export const runDeadlockDetection = () => get("/analysis/deadlock");

/**
 * GET /analysis/risk-score
 * Returns: { risk: 0-100, breakdown, prediction }
 */
export const getRiskScore = () => get("/analysis/risk-score");


// ─── GRAPH ──────────────────────────────────────────────────────────────────

/**
 * GET /graph/rag
 * Returns: { nodes: [{id, label, type}], edges: [{source, target, type}] }
 */
export const getRAG = () => get("/graph/rag");

/**
 * GET /graph/wfg
 * Returns: { nodes, edges, cycles }
 */
export const getWFG = () => get("/graph/wfg");


// ─── RECOVERY ───────────────────────────────────────────────────────────────

/**
 * GET /recovery/costs
 * Returns sorted list of processes with computed recovery costs
 * Returns: [{ pid, cost, breakdown, held_resources, wait_time, priority, dependents }]
 */
export const getRecoveryCosts = () => get("/recovery/costs");

/**
 * POST /recovery/auto
 * Runs iterative recovery loop automatically
 * Returns: { actions_taken, final_state_safe, iterations }
 */
export const runAutoRecovery = () => post("/recovery/auto");

/**
 * POST /recovery/terminate
 * body: { pid }
 */
export const terminateProcess = (pid) => post("/recovery/terminate", { pid });

/**
 * POST /recovery/preempt
 * body: { pid, resources?: number[] }
 */
export const preemptProcess = (pid, resources = null) =>
  post("/recovery/preempt", { pid, ...(resources ? { resources } : {}) });

/**
 * POST /recovery/rollback
 * body: { pid }
 */
export const rollbackProcess = (pid) => post("/recovery/rollback", { pid });


// ─── SELF-HEAL / CHECKPOINTS ────────────────────────────────────────────────

/**
 * GET /selfheal/checkpoints
 * Returns: [{ id, timestamp, event_count, valid }]
 */
export const getCheckpoints = () => get("/selfheal/checkpoints");

/**
 * POST /selfheal/rollback
 * body: { checkpoint_id }
 */
export const rollbackToCheckpoint = (checkpointId) =>
  post("/selfheal/rollback", { checkpoint_id: checkpointId });


// ─── EXPORT ─────────────────────────────────────────────────────────────────

/**
 * GET /export/report
 * Returns full JSON report blob
 */
export const exportReport = () => get("/export/report");

/**
 * Trigger a browser download of the JSON report
 */
export const downloadReport = async (filename = "safesched-report.json") => {
  const data = await exportReport();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};


// ─── WEBSOCKET ──────────────────────────────────────────────────────────────

/**
 * createWebSocket(handlers)
 *
 * Opens a WebSocket to /ws/stream and routes incoming events to handler callbacks.
 *
 * handlers = {
 *   onStateUpdate  : (state)   => void,
 *   onNewEvent     : (event)   => void,
 *   onRiskUpdate   : (risk)    => void,
 *   onDeadlock     : (info)    => void,
 *   onError        : (err)     => void,
 *   onClose        : ()        => void,
 * }
 *
 * Returns: { close: () => void, send: (msg) => void }
 */
export function createWebSocket(handlers = {}) {
  const ws = new WebSocket(`${WS_URL}/ws/stream`);

  ws.onopen = () => {
    console.info("[SafeSched WS] connected");
  };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case "state_update":  handlers.onStateUpdate?.(msg.payload);  break;
      case "new_event":     handlers.onNewEvent?.(msg.payload);      break;
      case "risk_update":   handlers.onRiskUpdate?.(msg.payload);    break;
      case "deadlock_alert":handlers.onDeadlock?.(msg.payload);      break;
      default:
        console.warn("[SafeSched WS] unknown message type:", msg.type);
    }
  };

  ws.onerror = (e) => {
    console.error("[SafeSched WS] error", e);
    handlers.onError?.(e);
  };

  ws.onclose = () => {
    console.info("[SafeSched WS] closed");
    handlers.onClose?.();
  };

  return {
    close: () => ws.close(),
    send:  (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)),
  };
}


// ─── REACT HOOK ─────────────────────────────────────────────────────────────

/**
 * useSimulation()
 *
 * Drop-in React hook. Manages state, polling fallback, and WebSocket lifecycle.
 *
 * Usage:
 *   const { state, loading, error, actions } = useSimulation();
 *
 * actions: { step, start, pause, stop, refresh, submitRequest, runRecovery }
 */
export function useSimulation() {
  // NOTE: this is a plain JS export — copy into your React component file
  // and add React import { useState, useEffect, useCallback, useRef }.
  //
  // Pseudocode outline:
  //
  // const [state,   setState]   = useState(null);
  // const [loading, setLoading] = useState(true);
  // const [error,   setError]   = useState(null);
  // const wsRef = useRef(null);
  //
  // const refresh = useCallback(async () => {
  //   try {
  //     const s = await getSimulationState();
  //     setState(s);
  //   } catch (e) { setError(e.message); }
  //   finally { setLoading(false); }
  // }, []);
  //
  // useEffect(() => {
  //   refresh();
  //   wsRef.current = createWebSocket({
  //     onStateUpdate: setState,
  //     onNewEvent: (ev) => setState(s => ({ ...s, logs: [ev, ...(s?.logs ?? [])].slice(0,200) })),
  //     onRiskUpdate: (r) => setState(s => ({ ...s, risk: r.risk })),
  //     onDeadlock:   (d) => setState(s => ({ ...s, deadlocked: d.processes })),
  //     onClose: () => { /* optional reconnect logic */ },
  //   });
  //   return () => wsRef.current?.close();
  // }, [refresh]);
  //
  // return {
  //   state, loading, error,
  //   actions: {
  //     step:          () => stepSimulation().then(refresh),
  //     start:         (opts) => startSimulation(opts).then(refresh),
  //     pause:         () => pauseSimulation().then(refresh),
  //     stop:          () => stopSimulation().then(refresh),
  //     refresh,
  //     submitRequest: (pid, vec, pri) => submitRequest(pid, vec, pri).then(refresh),
  //     runRecovery:   () => runAutoRecovery().then(refresh),
  //   },
  // };
  throw new Error("useSimulation must be used inside a React component file.");
}
