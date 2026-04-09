/**
 * useSimulation.js
 * React hook that wires SafeSched UI to the FastAPI backend.
 * Drop this into src/hooks/useSimulation.js
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getSimulationState,
  createWebSocket,
  stepSimulation,
  startSimulation,
  pauseSimulation,
  stopSimulation,
  submitRequest,
  runAutoRecovery,
  runBankerCheck,
  runDeadlockDetection,
  getRiskScore,
  getRAG,
  getWFG,
  getRecoveryCosts,
  getCheckpoints,
  rollbackToCheckpoint,
  terminateProcess,
  preemptProcess,
  rollbackProcess,
  exportScenario,
  downloadReport,
} from "../services/api";

// ── shape of the unified state the hook exposes ──────────────────────────────
const INITIAL_STATE = {
  // simulation
  step: 0,
  running: false,
  processes: [],
  resources: [],
  logs: [],
  // analysis
  safe: null,
  safeSequence: [],
  deadlocked: [],
  cycles: [],
  risk: 0,
  riskBreakdown: {},
  // graphs
  rag: { nodes: [], edges: [] },
  wfg: { nodes: [], edges: [] },
  // recovery
  recoveryCosts: [],
  checkpoints: [],
};

export function useSimulation() {
  const [state,   setState]   = useState(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [wsReady, setWsReady] = useState(false);

  const wsRef      = useRef(null);
  const mountedRef = useRef(true);

  // ── safe setState: ignore updates after unmount ───────────────────────────
  const safeSet = useCallback((updater) => {
    if (mountedRef.current) setState(updater);
  }, []);

  // ── fetch everything from REST ────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      setError(null);

      // Fire all reads in parallel — backend handles concurrency lock
      const [
        simState,
        banker,
        deadlock,
        riskData,
        ragData,
        wfgData,
        costs,
        checkpts,
      ] = await Promise.all([
        getSimulationState(),
        runBankerCheck(),
        runDeadlockDetection(),
        getRiskScore(),
        getRAG(),
        getWFG(),
        getRecoveryCosts(),
        getCheckpoints(),
      ]);

      safeSet(() => ({
        // simulation
        step:      simState.step      ?? 0,
        running:   simState.running   ?? false,
        processes: simState.processes ?? [],
        resources: simState.resources ?? [],
        logs:      simState.logs      ?? [],
        // analysis
        safe:         banker.safe           ?? null,
        safeSequence: banker.sequence       ?? [],
        deadlocked:   deadlock.deadlocked_processes ?? [],
        cycles:       deadlock.cycles       ?? [],
        risk:         riskData.risk         ?? 0,
        riskBreakdown:riskData.breakdown    ?? {},
        // graphs
        rag: ragData ?? { nodes: [], edges: [] },
        wfg: wfgData ?? { nodes: [], edges: [] },
        // recovery
        recoveryCosts: costs     ?? [],
        checkpoints:   checkpts  ?? [],
      }));
    } catch (e) {
      setError(e.message ?? "Failed to reach backend");
    } finally {
      setLoading(false);
    }
  }, [safeSet]);

  // ── WebSocket: patch state incrementally ─────────────────────────────────
  const connectWS = useCallback(() => {
    if (wsRef.current) wsRef.current.close();

    wsRef.current = createWebSocket({
      onStateUpdate: (payload) => {
        setWsReady(true);
        safeSet((s) => ({
          ...s,
          step:      payload.step      ?? s.step,
          running:   payload.running   ?? s.running,
          processes: payload.processes ?? s.processes,
          resources: payload.resources ?? s.resources,
        }));
      },

      onNewEvent: (ev) => {
        safeSet((s) => ({
          ...s,
          logs: [ev, ...s.logs].slice(0, 500), // keep last 500
        }));
      },

      onRiskUpdate: (payload) => {
        safeSet((s) => ({
          ...s,
          risk:          payload.risk      ?? s.risk,
          riskBreakdown: payload.breakdown ?? s.riskBreakdown,
        }));
      },

      onDeadlock: (payload) => {
        safeSet((s) => ({
          ...s,
          deadlocked: payload.processes ?? s.deadlocked,
          cycles:     payload.cycles    ?? s.cycles,
          safe:       false,
        }));
      },

      onError: () => setWsReady(false),

      onClose: () => {
        setWsReady(false);
        // Reconnect after 3 s if still mounted
        setTimeout(() => {
          if (mountedRef.current) connectWS();
        }, 3000);
      },
    });
  }, [safeSet]);

  // ── mount / unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    refresh();
    connectWS();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
    };
  }, [refresh, connectWS]);

  // ── actions ───────────────────────────────────────────────────────────────
  const actions = {
    /** Advance one simulation tick */
    step: async () => {
      await stepSimulation();
      await refresh();
    },

    /** Start / resume simulation */
    start: async (opts = {}) => {
      await startSimulation(opts);
      await refresh();
    },

    /** Pause auto-run */
    pause: async () => {
      await pauseSimulation();
      await refresh();
    },

    /** Stop and reset running state */
    stop: async () => {
      await stopSimulation();
      await refresh();
    },

    /** Re-fetch all state manually */
    refresh,

    /** Submit a resource request from a process
     *  @param {string}   pid            e.g. "P0"
     *  @param {number[]} resourceVector e.g. [1, 0, 2, 0]
     *  @param {number}   priority       1–10
     */
    submitRequest: async (pid, resourceVector, priority = 5) => {
      await submitRequest(pid, resourceVector, priority);
      await refresh();
    },

    /** Run the full auto-recovery loop */
    autoRecover: async () => {
      const result = await runAutoRecovery();
      await refresh();
      return result; // { actions_taken, final_state_safe, iterations }
    },

    /** Terminate a specific process */
    terminate: async (pid) => {
      await terminateProcess(pid);
      await refresh();
    },

    /** Preempt resources from a process */
    preempt: async (pid, resources = null) => {
      await preemptProcess(pid, resources);
      await refresh();
    },

    /** Rollback a specific process to last checkpoint */
    rollback: async (pid) => {
      await rollbackProcess(pid);
      await refresh();
    },

    /** Rollback entire system to a checkpoint snapshot */
    rollbackCheckpoint: async (checkpointId) => {
      await rollbackToCheckpoint(checkpointId);
      await refresh();
    },

    /** Download JSON report to browser */
    downloadReport: () => downloadReport(),

    /** Export current scenario JSON */
    exportScenario: () => exportScenario(),
  };

  return { state, loading, error, wsReady, actions };
}
