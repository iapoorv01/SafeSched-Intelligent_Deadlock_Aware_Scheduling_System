/**
 * App.jsx  — SafeSched Frontend
 * All pages wired to FastAPI backend via useSimulation()
 */

import React, { useState, useRef, useEffect } from "react";
import { useSimulation } from "./hooks/useSimulation";
import { createScenario, loadScenario, resetScenario } from "./services/api";

/* ─── tiny icon shim ─────────────────────────────────────────────────────── */
const PATHS = {
  dashboard: "M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 5h2v3h-2zm4-3h2v6h-2zm-2-2h2v8h-2z",
  scenario:  "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  sim:       "M5 3l14 9-14 9V3z",
  graph:     "M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18-.21 0-.41-.06-.57-.18l-7.9-4.44A1 1 0 013 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18.21 0 .41.06.57.18l7.9 4.44c.32.17.53.5.53.88v9z",
  recovery:  "M12 22C6.48 22 2 17.52 2 12S6.48 2 12 2s10 4.48 10 10-4.48 10-10 10zm1-13v4l3.25 1.95-.75 1.22L12 14V9h1z",
  reports:   "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13z",
  shield:    "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z",
  refresh:   "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  play:      "M5 3l14 9-14 9V3z",
  pause:     "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  step:      "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
  check:     "M20 6L9 17l-5-5",
  alert:     "M12 2L1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z",
  download:  "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  plus:      "M12 5v14M5 12h14",
  x:         "M18 6L6 18M6 6l12 12",
  db:        "M12 3C7.58 3 4 4.79 4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7c0-2.21-3.58-4-8-4zm0 2c3.87 0 6 1.36 6 2s-2.13 2-6 2-6-1.36-6-2 2.13-2 6-2z",
  cpu:       "M9 2H15V4H17V6H22V10H20V14H22V18H17V20H15V22H9V20H7V18H2V14H4V10H2V6H7V4H9V2Z",
  lock:      "M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4",
  wifi:      "M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01",
};

const Icon = ({ n, s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={PATHS[n] || ""} />
  </svg>
);

/* ─── shared UI ───────────────────────────────────────────────────────────── */
const Card = ({ children, style = {}, danger = false }) => (
  <div style={{
    background: "var(--bg2)", border: `1px solid ${danger ? "var(--danger-border)" : "var(--border)"}`,
    borderRadius: 10, padding: "16px 18px", ...style,
  }}>{children}</div>
);

const MetricCard = ({ label, value, sub, color = "var(--accent)", icon }) => (
  <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 4 }}>{sub}</div>}
      </div>
      {icon && <div style={{ color, opacity: 0.6 }}><Icon n={icon} s={20} /></div>}
    </div>
  </div>
);

const Badge = ({ children, color = "accent" }) => {
  const map = {
    accent:  ["#4f8ef722", "#4f8ef7"],
    safe:    ["#4fcc8e22", "#4fcc8e"],
    danger:  ["#f75f5f22", "#f75f5f"],
    warn:    ["#f7b84f22", "#f7b84f"],
    info:    ["#7c4dff22", "#c4b2ff"],
  };
  const [bg, fg] = map[color] || map.accent;
  return (
    <span style={{ background: bg, color: fg, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontFamily: "var(--mono)", fontWeight: 500, letterSpacing: "0.5px" }}>
      {children}
    </span>
  );
};

const RiskMeter = ({ value }) => {
  const color = value < 40 ? "var(--success)" : value < 70 ? "var(--warn)" : "var(--danger)";
  return (
    <svg width={140} height={80} viewBox="0 0 140 80">
      <path d="M15 70 A55 55 0 0 1 125 70" fill="none" stroke="#ffffff0a" strokeWidth={12} strokeLinecap="round" />
      <path d="M15 70 A55 55 0 0 1 125 70" fill="none" stroke={color} strokeWidth={12} strokeLinecap="round"
        strokeDasharray={`${(value / 100) * 173} 173`} style={{ transition: "stroke-dasharray 0.5s,stroke 0.5s" }} />
      <text x={70} y={60} textAnchor="middle" fill={color} fontWeight={700} fontSize={22} fontFamily="var(--mono)">{value}</text>
      <text x={70} y={76} textAnchor="middle" fill={color} fontSize={9} fontFamily="var(--font)" letterSpacing="2">
        {value < 40 ? "LOW" : value < 70 ? "MED" : "HIGH"}
      </text>
    </svg>
  );
};

const Spinner = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
    <div style={{ width: 28, height: 28, border: "2px solid var(--border2)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
  </div>
);

const ErrorBanner = ({ msg, onRetry }) => (
  <div style={{ background: "#f75f5f11", border: "1px solid #f75f5f33", borderRadius: 8, padding: "12px 16px", display: "flex", gap: 12, alignItems: "center" }}>
    <Icon n="alert" s={16} />
    <span style={{ color: "var(--danger)", fontSize: 13, flex: 1 }}>{msg}</span>
    <button onClick={onRetry} style={{ background: "none", border: "1px solid var(--danger)", color: "var(--danger)", padding: "4px 12px", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>Retry</button>
  </div>
);

const ProcessTable = ({ processes }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--mono)" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          {["PID", "Status", "Alloc", "Max", "Wait", "Priority"].map(h => (
            <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--text3)", fontWeight: 500, fontSize: 10, letterSpacing: "1px", textTransform: "uppercase" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {processes.map((p) => {
          const sc = { running: "var(--success)", waiting: "var(--warn)", blocked: "var(--danger)" }[p.status] || "var(--text2)";
          return (
            <tr key={p.id} style={{ borderBottom: "1px solid #ffffff08", transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--bg3)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: "8px 10px", color: "var(--accent)", fontWeight: 600 }}>{p.id}</td>
              <td style={{ padding: "8px 10px" }}><span style={{ color: sc, fontSize: 10 }}>{p.status?.toUpperCase()}</span></td>
              <td style={{ padding: "8px 10px", color: "var(--text2)" }}>[{(p.allocation || []).join(",")}]</td>
              <td style={{ padding: "8px 10px", color: "var(--text3)" }}>[{(p.max || []).join(",")}]</td>
              <td style={{ padding: "8px 10px", color: p.wait_time > 150 ? "var(--warn)" : "var(--text2)" }}>{p.wait_time ?? 0}ms</td>
              <td style={{ padding: "8px 10px" }}>
                <div style={{ width: 60, height: 4, background: "var(--bg4)", borderRadius: 2 }}>
                  <div style={{ width: `${(p.priority || 1) * 10}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

/* ─── PAGE: DASHBOARD ─────────────────────────────────────────────────────── */
const Dashboard = ({ state, actions }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>System Dashboard</h1>
        <div style={{ color: "var(--text2)", fontSize: 12, marginTop: 2 }}>Step {state.step} · real-time via WebSocket</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Badge color={state.safe === true ? "safe" : state.safe === false ? "danger" : "warn"}>
          {state.safe === true ? "✓ SAFE" : state.safe === false ? "✗ UNSAFE" : "CHECKING…"}
        </Badge>
        <button onClick={actions.refresh} style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon n="refresh" s={13} /> Refresh
        </button>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
      <MetricCard label="Risk Score" value={state.risk} color={state.risk > 70 ? "var(--danger)" : state.risk > 40 ? "var(--warn)" : "var(--success)"} icon="alert" />
      <MetricCard label="Processes" value={state.processes.length} sub={`${state.processes.filter(p => p.status === "running").length} running`} icon="cpu" />
      <MetricCard label="Resources" value={state.resources.length} sub={`${state.resources.reduce((a, r) => a + (r.available ?? 0), 0)} units free`} icon="db" />
      <MetricCard label="Deadlocks" value={state.deadlocked.length} color={state.deadlocked.length > 0 ? "var(--danger)" : "var(--success)"} icon="shield" />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12 }}>
      <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text2)", fontSize: 10, letterSpacing: "1px", marginBottom: 8 }}>RISK METER</div>
        <RiskMeter value={state.risk} />
      </Card>
      <Card>
        <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 12 }}>RESOURCE UTILIZATION</div>
        {state.resources.map(r => {
          const used = (r.total || 0) - (r.available || 0);
          const pct = r.total ? Math.round((used / r.total) * 100) : 0;
          const col = pct > 80 ? "var(--danger)" : pct > 60 ? "var(--warn)" : "var(--accent)";
          return (
            <div key={r.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                <span style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 600 }}>{r.id}</span>
                <span style={{ color: col, fontFamily: "var(--mono)" }}>{used}/{r.total} ({pct}%)</span>
              </div>
              <div style={{ height: 6, background: "var(--bg4)", borderRadius: 3 }}>
                <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 3, transition: "width 0.4s" }} />
              </div>
            </div>
          );
        })}
      </Card>
    </div>

    {state.safeSequence.length > 0 && (
      <Card style={{ borderColor: "#4fcc8e22", background: "#4fcc8e08" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Icon n="check" s={16} />
          <div>
            <div style={{ color: "var(--success)", fontSize: 12, fontWeight: 600 }}>SAFE SEQUENCE FOUND</div>
            <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 2, fontFamily: "var(--mono)" }}>
              {state.safeSequence.join(" → ")}
            </div>
          </div>
        </div>
      </Card>
    )}

    <Card>
      <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 12 }}>PROCESS STATE</div>
      <ProcessTable processes={state.processes} />
    </Card>

    <Card>
      <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 10 }}>RECENT EVENTS</div>
      {state.logs.slice(0, 5).map((l, i) => {
        const c = { grant: "var(--success)", deny: "var(--danger)", warn: "var(--warn)", info: "var(--text3)" }[l.type] || "var(--text3)";
        return (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, fontFamily: "var(--mono)", marginBottom: 4 }}>
            <span style={{ color: "var(--text3)", minWidth: 70 }}>{l.timestamp || l.t}</span>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0 }} />
            <span style={{ color: "var(--text2)" }}>{l.message || l.msg}</span>
          </div>
        );
      })}
    </Card>
  </div>
);

/* ─── PAGE: SCENARIO BUILDER ─────────────────────────────────────────────── */
const ScenarioBuilder = ({ actions }) => {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(4);
  const [allocation, setAlloc] = useState(() => Array.from({ length: 3 }, () => Array(4).fill(0)));
  const [max, setMax] = useState(() => Array.from({ length: 3 }, () => Array(4).fill(5)));
  const [available, setAvail] = useState([3, 2, 2, 1]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const resize = (r, c) => {
    setRows(r); setCols(c);
    setAlloc(Array.from({ length: r }, () => Array(c).fill(0)));
    setMax(Array.from({ length: r }, () => Array(c).fill(5)));
    setAvail(Array(c).fill(2));
  };

  const setCell = (matrix, setMatrix, r, c, v) => {
    const m = matrix.map(row => [...row]);
    m[r][c] = Math.max(0, parseInt(v) || 0);
    setMatrix(m);
  };

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      await createScenario({
        processes: Array.from({ length: rows }, (_, i) => `P${i}`),
        resources: Array.from({ length: cols }, (_, i) => `R${i}`),
        allocation, max, available,
      });
      await actions.refresh();
      setMsg({ ok: true, text: "Scenario created and loaded ✓" });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true);
    try { await resetScenario(); await actions.refresh(); setMsg({ ok: true, text: "Scenario reset ✓" }); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Scenario Builder</h1>

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: 7, fontSize: 12, background: msg.ok ? "#4fcc8e11" : "#f75f5f11", border: `1px solid ${msg.ok ? "#4fcc8e33" : "#f75f5f33"}`, color: msg.ok ? "var(--success)" : "var(--danger)" }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card>
          <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 12 }}>DIMENSIONS</div>
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            {[["Processes", rows, v => resize(v, cols), [2,3,4,5,6]],
              ["Resources", cols, v => resize(rows, v), [2,3,4,5]]].map(([label, val, set, opts]) => (
              <div key={label} style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>{label}</div>
                <select value={val} onChange={e => set(+e.target.value)}
                  style={{ width: "100%", background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, fontFamily: "var(--mono)", fontSize: 13 }}>
                  {opts.map(n => <option key={n}>{n}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} disabled={busy} style={{ flex: 1, background: "var(--accent)", border: "none", color: "#fff", padding: "9px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              {busy ? "Sending…" : "Create Scenario"}
            </button>
            <button onClick={reset} disabled={busy} style={{ flex: 1, background: "var(--bg4)", border: "1px solid var(--border2)", color: "var(--text2)", padding: "9px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
              Reset
            </button>
          </div>
        </Card>

        <Card>
          <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 10 }}>AVAILABLE RESOURCES</div>
          <div style={{ display: "flex", gap: 8 }}>
            {available.map((v, i) => (
              <div key={i} style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4, textAlign: "center" }}>R{i}</div>
                <input type="number" min={0} max={20} value={v}
                  onChange={e => setAvail(a => a.map((x, j) => j === i ? +e.target.value : x))}
                  style={{ width: "100%", textAlign: "center", background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 6, padding: "6px", fontFamily: "var(--mono)", fontSize: 14 }} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Allocation matrix */}
      {["Allocation", "Max"].map((label, mi) => {
        const matrix = mi === 0 ? allocation : max;
        const setMatrix = mi === 0 ? setAlloc : setMax;
        return (
          <Card key={label}>
            <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 12 }}>{label.toUpperCase()} MATRIX</div>
            <table style={{ borderCollapse: "separate", borderSpacing: 4 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  {Array.from({ length: cols }, (_, i) => (
                    <th key={i} style={{ color: "var(--accent)", fontSize: 11, fontFamily: "var(--mono)", width: 52, textAlign: "center" }}>R{i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, ri) => (
                  <tr key={ri}>
                    <td style={{ color: "var(--accent2)", fontSize: 11, fontFamily: "var(--mono)", textAlign: "right", paddingRight: 8, fontWeight: 600 }}>P{ri}</td>
                    {row.map((val, ci) => (
                      <td key={ci}>
                        <input type="number" min={0} max={20} value={val}
                          onChange={e => setCell(matrix, setMatrix, ri, ci, e.target.value)}
                          style={{ width: 48, height: 36, textAlign: "center", background: "var(--bg3)", border: `1px solid ${val > 0 ? "var(--border2)" : "var(--border)"}`, color: val > 0 ? "var(--text)" : "var(--text3)", borderRadius: 6, fontFamily: "var(--mono)", fontSize: 14, fontWeight: val > 0 ? 600 : 400 }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      })}
    </div>
  );
};

/* ─── PAGE: LIVE SIMULATION ──────────────────────────────────────────────── */
const LiveSim = ({ state, actions }) => {
  const [injPid, setInjPid] = useState("P0");
  const [injVec, setInjVec] = useState("1,0,0,0");
  const [injPri, setInjPri] = useState(5);
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.logs]);

  const inject = async () => {
    setBusy(true);
    try {
      const vec = injVec.split(",").map(Number);
      await actions.submitRequest(injPid, vec, injPri);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Live Simulation</h1>
          <div style={{ color: "var(--text2)", fontSize: 12, marginTop: 2 }}>Step {state.step} · {state.running ? "auto-running" : "paused"}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={actions.step} style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon n="step" s={13} /> Step
          </button>
          <button onClick={state.running ? actions.pause : () => actions.start({ auto: true })}
            style={{ background: state.running ? "var(--danger)" : "var(--accent)", border: "none", color: "#fff", padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon n={state.running ? "pause" : "play"} s={13} />
            {state.running ? "Pause" : "Auto Run"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Inject request */}
        <Card>
          <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 12 }}>INJECT REQUEST</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>PID</div>
                <select value={injPid} onChange={e => setInjPid(e.target.value)}
                  style={{ width: "100%", background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", padding: "6px", borderRadius: 6, fontFamily: "var(--mono)" }}>
                  {state.processes.map(p => <option key={p.id}>{p.id}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>Priority (1-10)</div>
                <input type="number" min={1} max={10} value={injPri} onChange={e => setInjPri(+e.target.value)}
                  style={{ width: "100%", background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", padding: "6px", borderRadius: 6, fontFamily: "var(--mono)" }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>Resource vector (comma-separated)</div>
              <input value={injVec} onChange={e => setInjVec(e.target.value)} placeholder="1,0,2,0"
                style={{ width: "100%", background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", padding: "6px 8px", borderRadius: 6, fontFamily: "var(--mono)", fontSize: 13 }} />
            </div>
            <button onClick={inject} disabled={busy}
              style={{ background: "var(--accent)", border: "none", color: "#fff", padding: "9px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              {busy ? "Injecting…" : "+ Submit Request"}
            </button>
          </div>
        </Card>

        {/* Event log */}
        <Card>
          <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 10 }}>EVENT LOG</div>
          <div ref={logRef} style={{ height: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
            {state.logs.map((l, i) => {
              const c = { grant: "var(--success)", deny: "var(--danger)", warn: "var(--warn)", info: "var(--text3)" }[l.type] || "var(--text3)";
              return (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, fontFamily: "var(--mono)", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text3)", minWidth: 64, flexShrink: 0 }}>{l.timestamp || l.t}</span>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0, marginTop: 3 }} />
                  <span style={{ color: "var(--text2)" }}>{l.message || l.msg}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 12 }}>PROCESS STATE</div>
        <ProcessTable processes={state.processes} />
      </Card>
    </div>
  );
};

/* ─── PAGE: GRAPH VIEW ────────────────────────────────────────────────────── */
const GraphView = ({ state }) => {
  const [mode, setMode] = useState("rag");
  const graph = mode === "rag" ? state.rag : state.wfg;
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];

  // Simple force-free layout: processes top row, resources bottom
  const pNodes = nodes.filter(n => n.type === "process");
  const rNodes = nodes.filter(n => n.type === "resource");
  const W = 560, PY = 80, RY = 230;
  const pos = {};
  pNodes.forEach((n, i) => { pos[n.id] = { x: 60 + i * (W / Math.max(pNodes.length, 1)), y: PY }; });
  rNodes.forEach((n, i) => { pos[n.id] = { x: 100 + i * (W / Math.max(rNodes.length, 1)), y: RY }; });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Graph View</h1>
          <div style={{ color: "var(--text2)", fontSize: 12, marginTop: 2 }}>Live RAG / WFG from backend</div>
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--bg3)", padding: 3, borderRadius: 7 }}>
          {["rag", "wfg"].map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{ padding: "5px 14px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: mode === m ? "var(--accent)" : "transparent", color: mode === m ? "#fff" : "var(--text2)" }}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <svg width="100%" viewBox="0 0 580 320" style={{ maxHeight: 320 }}>
          <defs>
            <marker id="ag" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke="#4f8ef7" strokeWidth="1.5" strokeLinecap="round" />
            </marker>
            <marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke="#f7b84f" strokeWidth="1.5" strokeLinecap="round" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const s = pos[e.source], t = pos[e.target];
            if (!s || !t) return null;
            const isCycle = state.cycles?.some(c => c.includes(e.source) && c.includes(e.target));
            return (
              <line key={i} x1={s.x} y1={s.y + (s.y < t.y ? 18 : -18)} x2={t.x} y2={t.y + (t.y < s.y ? 18 : -18)}
                stroke={isCycle ? "var(--danger)" : e.type === "request" ? "#f7b84f60" : "#4f8ef740"}
                strokeWidth={isCycle ? 2 : 1.5} strokeDasharray={e.type === "request" ? "4 3" : undefined}
                markerEnd={`url(#${e.type === "request" ? "ar" : "ag"})`} />
            );
          })}
          {pNodes.map(n => {
            const p = pos[n.id]; if (!p) return null;
            const proc = state.processes.find(pr => pr.id === n.id);
            const col = { running: "#4fcc8e", waiting: "#f7b84f", blocked: "#f75f5f" }[proc?.status] || "#4f8ef7";
            return (
              <g key={n.id}>
                <circle cx={p.x} cy={p.y} r={22} fill="#111520" stroke={col} strokeWidth={1.5} />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fill={col} fontSize={11} fontFamily="var(--mono)" fontWeight={600}>{n.id}</text>
                <text x={p.x} y={p.y + 40} textAnchor="middle" fill="#4a5268" fontSize={10} fontFamily="var(--mono)">{proc?.status}</text>
              </g>
            );
          })}
          {rNodes.map(n => {
            const p = pos[n.id]; if (!p) return null;
            const res = state.resources.find(r => r.id === n.id);
            return (
              <g key={n.id}>
                <rect x={p.x - 22} y={p.y - 15} width={44} height={30} rx={5} fill="#1e2435" stroke="#7c4dff88" strokeWidth={1.5} />
                <text x={p.x} y={p.y + 5} textAnchor="middle" fill="#c4b2ff" fontSize={11} fontFamily="var(--mono)" fontWeight={600}>{n.id}</text>
                <text x={p.x} y={p.y + 38} textAnchor="middle" fill="#4a5268" fontSize={10} fontFamily="var(--mono)">{res?.available ?? "?"} free</text>
              </g>
            );
          })}
          {nodes.length === 0 && (
            <text x={290} y={160} textAnchor="middle" fill="#4a5268" fontSize={13} fontFamily="var(--mono)">No graph data — create a scenario first</text>
          )}
        </svg>

        {state.cycles?.length > 0 && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#f75f5f11", border: "1px solid #f75f5f33", borderRadius: 6, fontSize: 11, color: "var(--danger)", fontFamily: "var(--mono)" }}>
            ⚠ Cycle detected: {state.cycles.map(c => c.join(" → ")).join(", ")}
          </div>
        )}
      </Card>
    </div>
  );
};

/* ─── PAGE: RECOVERY ──────────────────────────────────────────────────────── */
const Recovery = ({ state, actions }) => {
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);

  const act = async (fn, label) => {
    setBusy(label);
    try { const r = await fn(); if (r) setResult(r); }
    catch (e) { setResult({ error: e.message }); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Recovery Console</h1>

      {result && (
        <Card style={{ borderColor: result.error ? "#f75f5f33" : "#4fcc8e33", background: result.error ? "#f75f5f08" : "#4fcc8e08" }}>
          <div style={{ fontSize: 12, color: result.error ? "var(--danger)" : "var(--success)" }}>
            {result.error ? `Error: ${result.error}` : `Recovery complete · ${result.iterations ?? 1} iteration(s) · state now ${result.final_state_safe ? "SAFE" : "UNSAFE"}`}
          </div>
        </Card>
      )}

      {/* Cost table */}
      <Card>
        <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 12 }}>VICTIM SELECTION TABLE</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--mono)" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["PID", "Held", "Wait", "Priority", "Deps", "Cost", "Actions"].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--text3)", fontSize: 10, letterSpacing: "1px", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.recoveryCosts.map((c, i) => (
              <tr key={c.pid} style={{ borderBottom: "1px solid #ffffff08", background: i === 0 ? "#4fcc8e08" : "transparent" }}>
                <td style={{ padding: "9px 10px", color: i === 0 ? "var(--success)" : "var(--accent)", fontWeight: 600 }}>{i === 0 ? "★ " : ""}{c.pid}</td>
                <td style={{ padding: "9px 10px", color: "var(--text2)" }}>{c.held_resources ?? c.heldRes}</td>
                <td style={{ padding: "9px 10px", color: "var(--text2)" }}>{c.wait_time ?? c.waitTime}ms</td>
                <td style={{ padding: "9px 10px", color: "var(--text2)" }}>{c.priority}</td>
                <td style={{ padding: "9px 10px", color: "var(--text2)" }}>{c.dependents}</td>
                <td style={{ padding: "9px 10px", color: i === 0 ? "var(--success)" : "var(--text)", fontWeight: i === 0 ? 700 : 400 }}>{c.cost}</td>
                <td style={{ padding: "9px 10px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[["Terminate", () => act(() => actions.terminate(c.pid), `term-${c.pid}`)],
                      ["Preempt",   () => act(() => actions.preempt(c.pid), `pre-${c.pid}`)],
                      ["Rollback",  () => act(() => actions.rollback(c.pid), `rb-${c.pid}`)],
                    ].map(([label, fn]) => (
                      <button key={label} onClick={fn} disabled={!!busy}
                        style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text2)", padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10 }}>
                        {busy === `${label.slice(0,4).toLowerCase()}-${c.pid}` ? "…" : label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {state.recoveryCosts.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 20, textAlign: "center", color: "var(--text3)" }}>No cost data — run banker/deadlock analysis first</td></tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--text3)" }}>★ Recommended victim (lowest recovery cost)</div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card>
          <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 12 }}>AUTO RECOVERY</div>
          <button onClick={() => act(actions.autoRecover, "auto")} disabled={!!busy}
            style={{ width: "100%", background: "var(--danger)", border: "none", color: "#fff", padding: 10, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            {busy === "auto" ? "Running…" : "⚡ Run Auto Recovery"}
          </button>
        </Card>

        <Card>
          <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 12 }}>CHECKPOINTS ({state.checkpoints.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {state.checkpoints.slice(0, 4).map(cp => (
              <div key={cp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: "var(--bg3)", borderRadius: 6, fontSize: 11, fontFamily: "var(--mono)" }}>
                <span style={{ color: "var(--text2)" }}>#{cp.id}</span>
                <span style={{ color: "var(--text3)" }}>{cp.event_count} events</span>
                <span style={{ color: cp.valid ? "var(--success)" : "var(--danger)", fontSize: 10 }}>{cp.valid ? "valid" : "quarantined"}</span>
                <button onClick={() => act(() => actions.rollbackCheckpoint(cp.id), `cp-${cp.id}`)} disabled={!cp.valid || !!busy}
                  style={{ background: "none", border: "1px solid var(--border)", color: "var(--accent)", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10 }}>
                  Restore
                </button>
              </div>
            ))}
            {state.checkpoints.length === 0 && <div style={{ color: "var(--text3)", fontSize: 12 }}>No checkpoints yet</div>}
          </div>
        </Card>
      </div>
    </div>
  );
};

/* ─── PAGE: REPORTS ───────────────────────────────────────────────────────── */
const Reports = ({ state, actions }) => {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const download = async () => {
    setBusy(true);
    try { await actions.downloadReport(); setDone(true); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Reports & Export</h1>
      {done && <div style={{ padding: "10px 14px", borderRadius: 7, fontSize: 12, background: "#4fcc8e11", border: "1px solid #4fcc8e33", color: "var(--success)" }}>Report downloaded ✓</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { title: "Full Simulation Report", desc: "All state, events, and analysis in one JSON", icon: "db", color: "var(--accent)" },
          { title: "Banker Safety Report",   desc: "Safety check, safe sequence, and explanation", icon: "shield", color: "var(--success)" },
          { title: "Deadlock Analysis",      desc: "WFG cycles, matrix results, dependency map", icon: "alert", color: "var(--warn)" },
          { title: "Recovery Audit Trail",   desc: "All actions, costs, rollbacks with timestamps", icon: "refresh", color: "var(--accent2)" },
        ].map(r => (
          <Card key={r.title}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ color: r.color, marginTop: 2 }}><Icon n={r.icon} s={20} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{r.title}</div>
                <div style={{ color: "var(--text3)", fontSize: 11, lineHeight: 1.5, marginBottom: 12 }}>{r.desc}</div>
                <button onClick={download} disabled={busy}
                  style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon n="download" s={12} /> {busy ? "Exporting…" : "Download JSON"}
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div style={{ color: "var(--text2)", fontSize: 11, letterSpacing: "1px", marginBottom: 12 }}>SIMULATION SUMMARY</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10 }}>
          {[
            ["Total Events", state.logs.length],
            ["Processes",    state.processes.length],
            ["Resources",    state.resources.length],
            ["Deadlocks",    state.deadlocked.length],
            ["Risk Score",   `${state.risk}%`],
            ["Checkpoints",  state.checkpoints.length],
          ].map(([k, v]) => (
            <div key={k} style={{ background: "var(--bg3)", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ color: "var(--text3)", fontSize: 10, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6 }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--mono)" }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

/* ─── NAV ─────────────────────────────────────────────────────────────────── */
const NAV = [
  { id: "dashboard", label: "Dashboard",  icon: "dashboard" },
  { id: "scenario",  label: "Scenario",   icon: "scenario"  },
  { id: "simulation",label: "Simulation", icon: "sim"       },
  { id: "graphs",    label: "Graphs",     icon: "graph"     },
  { id: "recovery",  label: "Recovery",   icon: "recovery"  },
  { id: "reports",   label: "Reports",    icon: "reports"   },
];

/* ─── ROOT APP ────────────────────────────────────────────────────────────── */
export default function App() {
  const [page, setPage] = useState("dashboard");
  const { state, loading, error, wsReady, actions } = useSimulation();

  const pages = {
    dashboard:  <Dashboard  state={state} actions={actions} />,
    scenario:   <ScenarioBuilder         actions={actions} />,
    simulation: <LiveSim    state={state} actions={actions} />,
    graphs:     <GraphView  state={state} />,
    recovery:   <Recovery   state={state} actions={actions} />,
    reports:    <Reports    state={state} actions={actions} />,
  };

  return (
    <>
      <style>{`
        :root {
          --bg:#0a0c10;--bg2:#111520;--bg3:#181d2a;--bg4:#1e2435;
          --border:#ffffff14;--border2:#ffffff22;--danger-border:#f75f5f33;
          --text:#e8ecf4;--text2:#8892a8;--text3:#4a5268;--accent2:#7c4dff;
          --accent:#4f8ef7;--accent3:#00d4a0;--danger:#f75f5f;--warn:#f7b84f;
          --success:#4fcc8e;--font:'Syne',sans-serif;--mono:'JetBrains Mono',monospace;
        }
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:14px}
        input,select,button{font-family:inherit}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh" }}>
        {/* Sidebar */}
        <div style={{ width: 200, background: "var(--bg2)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "18px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, background: "var(--accent)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon n="shield" s={15} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>SafeSched</div>
                <div style={{ fontSize: 9, color: "var(--text3)", letterSpacing: "1px" }}>LIVE · FastAPI</div>
              </div>
            </div>
          </div>

          <nav style={{ padding: 8, flex: 1 }}>
            {NAV.map(n => (
              <button key={n.id} onClick={() => setPage(n.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 7, border: "none", cursor: "pointer", marginBottom: 2, textAlign: "left",
                  background: page === n.id ? "#4f8ef718" : "transparent",
                  color: page === n.id ? "var(--accent)" : "var(--text2)",
                  fontFamily: "var(--font)", fontSize: 13, fontWeight: page === n.id ? 600 : 400 }}>
                <Icon n={n.icon} s={15} />{n.label}
              </button>
            ))}
          </nav>

          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: wsReady ? "var(--success)" : "var(--warn)", animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 10, color: "var(--text3)" }}>{wsReady ? "WS live" : "REST polling"}</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: error ? "var(--danger)" : "var(--success)" }} />
              <span style={{ fontSize: 10, color: "var(--text3)" }}>{error ? "backend error" : "connected"}</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "24px 28px" }}>
          {error && <ErrorBanner msg={error} onRetry={actions.refresh} />}
          {loading ? <Spinner /> : pages[page]}
        </div>
      </div>
    </>
  );
}
