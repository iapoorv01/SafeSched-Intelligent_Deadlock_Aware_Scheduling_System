import { useEffect, useState, useRef, useCallback } from 'react';
import { localApiFetch } from '../lib/localApiFetch';

// ── Types ──────────────────────────────────────────────────────────────────
type GraphNode = {
  id: string; label: string; type: 'process' | 'resource';
  status?: string; deadlocked?: boolean; inCycle?: boolean;
  x?: number; y?: number;
  // process extras
  allocation?: number[]; need?: number[]; max?: number[];
  priority?: number; waitTicks?: number; age?: number;
  // resource extras
  total?: number; available?: number; utilizationPct?: number;
};
type GraphEdge = {
  source: string; target: string;
  type: 'allocation' | 'request' | 'wait';
  inCycle?: boolean; amount?: number;
};
type GraphData = {
  nodes: GraphNode[]; edges: GraphEdge[];
  deadlockedPids?: string[]; cycles?: string[][];
  currentPid?: string | null;
};

type Props = { refreshKey?: number; mode?: 'rag' | 'wfg' };

const W = 720;
const H = 480;
const P_R = 32;   // process node radius
const R_W = 64;   // resource node width
const R_H = 44;   // resource node height
const MIN_DIST = 90; // minimum distance between node centers

// ── Force-directed layout (Fruchterman-Reingold) ──────────────────────────
function forceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  mode: 'rag' | 'wfg',
  iterations = 120
): GraphNode[] {
  if (nodes.length === 0) return nodes;

  // Seed initial positions
  const pos: Record<string, { x: number; y: number }> = {};

  if (mode === 'wfg') {
    // WFG: circular layout — all nodes are processes
    const n = nodes.length;
    const cx = W / 2, cy = H / 2;
    const r = Math.min(W, H) * 0.35;
    nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      pos[node.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  } else {
    // RAG: bipartite seed — processes left, resources right
    const procs = nodes.filter(n => n.type === 'process');
    const ress  = nodes.filter(n => n.type === 'resource');
    const pStep = H / (procs.length + 1);
    const rStep = H / (ress.length + 1);
    procs.forEach((n, i) => { pos[n.id] = { x: W * 0.28, y: pStep * (i + 1) }; });
    ress.forEach((n, i)  => { pos[n.id] = { x: W * 0.72, y: rStep * (i + 1) }; });
  }

  const k = Math.sqrt((W * H) / Math.max(nodes.length, 1));
  const repulse = (d: number) => (k * k) / Math.max(d, 1);
  const attract = (d: number) => (d * d) / k;

  for (let iter = 0; iter < iterations; iter++) {
    const temp = k * (1 - iter / iterations) * 0.5;
    const disp: Record<string, { dx: number; dy: number }> = {};
    nodes.forEach(n => { disp[n.id] = { dx: 0, dy: 0 }; });

    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = pos[a.id].x - pos[b.id].x;
        const dy = pos[a.id].y - pos[b.id].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = repulse(dist);
        const ux = dx / dist, uy = dy / dist;
        disp[a.id].dx += ux * f;
        disp[a.id].dy += uy * f;
        disp[b.id].dx -= ux * f;
        disp[b.id].dy -= uy * f;
      }
    }

    // Attraction along edges
    for (const e of edges) {
      const a = pos[e.source], b = pos[e.target];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = attract(dist);
      const ux = dx / dist, uy = dy / dist;
      disp[e.source].dx += ux * f;
      disp[e.source].dy += uy * f;
      disp[e.target].dx -= ux * f;
      disp[e.target].dy -= uy * f;
    }

    // Apply displacement with temperature cooling
    const pad = 60;
    nodes.forEach(n => {
      const d = disp[n.id];
      const mag = Math.sqrt(d.dx * d.dx + d.dy * d.dy) || 0.01;
      const move = Math.min(mag, temp);
      pos[n.id].x += (d.dx / mag) * move;
      pos[n.id].y += (d.dy / mag) * move;
      // Clamp to canvas with padding
      pos[n.id].x = Math.max(pad, Math.min(W - pad, pos[n.id].x));
      pos[n.id].y = Math.max(pad, Math.min(H - pad, pos[n.id].y));
    });

    // Enforce minimum distance
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = pos[b.id].x - pos[a.id].x;
        const dy = pos[b.id].y - pos[a.id].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (dist < MIN_DIST) {
          const push = (MIN_DIST - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          pos[a.id].x -= ux * push;
          pos[a.id].y -= uy * push;
          pos[b.id].x += ux * push;
          pos[b.id].y += uy * push;
          // Re-clamp
          const pad2 = 60;
          pos[a.id].x = Math.max(pad2, Math.min(W - pad2, pos[a.id].x));
          pos[a.id].y = Math.max(pad2, Math.min(H - pad2, pos[a.id].y));
          pos[b.id].x = Math.max(pad2, Math.min(W - pad2, pos[b.id].x));
          pos[b.id].y = Math.max(pad2, Math.min(H - pad2, pos[b.id].y));
        }
      }
    }
  }

  return nodes.map(n => ({ ...n, x: pos[n.id].x, y: pos[n.id].y }));
}

// ── Edge geometry ─────────────────────────────────────────────────────────
function edgeGeometry(
  s: GraphNode, t: GraphNode,
  edgeIndex: number, totalBetween: number
): { x1: number; y1: number; x2: number; y2: number; mx: number; my: number } {
  const sx = s.x ?? 0, sy = s.y ?? 0;
  const tx = t.x ?? 0, ty = t.y ?? 0;
  const dx = tx - sx, dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;

  const sR = s.type === 'process' ? P_R : R_W / 2;
  const tR = t.type === 'process' ? P_R + 10 : R_W / 2 + 8;

  const x1 = sx + ux * sR;
  const y1 = sy + uy * sR;
  const x2 = tx - ux * tR;
  const y2 = ty - uy * tR;

  // Offset curve for multiple edges between same pair
  const offset = (edgeIndex - (totalBetween - 1) / 2) * 22;
  const mx = (x1 + x2) / 2 - uy * offset;
  const my = (y1 + y2) / 2 + ux * offset;

  return { x1, y1, x2, y2, mx, my };
}

// ── Tooltip component ─────────────────────────────────────────────────────
function NodeTooltip({ node, x, y }: { node: GraphNode; x: number; y: number }) {
  const isProc = node.type === 'process';
  return (
    <foreignObject x={x + 10} y={y - 10} width={180} height={isProc ? 130 : 80} style={{ overflow: 'visible' }}>
      <div
        style={{
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(37,99,235,0.25)',
          borderRadius: 10,
          padding: '8px 12px',
          fontSize: 11,
          color: '#1e293b',
          boxShadow: '0 4px 20px rgba(37,99,235,0.12)',
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4, color: '#2563eb' }}>{node.label}</div>
        {isProc ? (
          <>
            <div>Status: <b>{node.status}</b></div>
            <div>Priority: <b>{node.priority ?? 0}</b></div>
            <div>Wait ticks: <b style={{ color: (node.waitTicks ?? 0) > 10 ? '#ef4444' : '#22c55e' }}>{node.waitTicks ?? 0}</b></div>
            <div>Age: <b>{node.age ?? 0}</b></div>
            {node.allocation && <div>Alloc: <b>[{node.allocation.join(', ')}]</b></div>}
            {node.need && <div>Need: <b>[{node.need.join(', ')}]</b></div>}
          </>
        ) : (
          <>
            <div>Available: <b style={{ color: '#22c55e' }}>{node.available ?? 0}</b> / {node.total ?? 0}</div>
            <div>Utilization: <b style={{ color: (node.utilizationPct ?? 0) > 80 ? '#ef4444' : '#f59e0b' }}>{node.utilizationPct ?? 0}%</b></div>
          </>
        )}
      </div>
    </foreignObject>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function GraphVisualizer({ refreshKey = 0, mode = 'rag' }: Props) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [animTick, setAnimTick] = useState(0);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Pinned positions: user-dragged overrides
  const [pinned, setPinned] = useState<Record<string, { x: number; y: number }>>({});
  // Drag state
  const dragging = useRef<{ id: string; ox: number; oy: number; mx: number; my: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Computed laid-out nodes (force layout + pinned overrides)
  const [laidOut, setLaidOut] = useState<GraphNode[]>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    localApiFetch<GraphData>(`/api/graph?type=${mode}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [mode]);

  // Re-run force layout when data changes (but respect pinned positions)
  const runLayout = useCallback((d: GraphData, currentPinned: Record<string, { x: number; y: number }>) => {
    const laid = forceLayout(d.nodes, d.edges, mode);
    // Apply pinned overrides
    const merged = laid.map(n => currentPinned[n.id] ? { ...n, ...currentPinned[n.id] } : n);
    setLaidOut(merged);
  }, [mode]);

  useEffect(() => {
    if (data) runLayout(data, pinned);
  }, [data, runLayout]); // intentionally exclude pinned to avoid re-layout on every drag

  useEffect(() => {
    setLoading(true);
    setPinned({}); // clear pins on mode/refresh change
    load();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(load, 1500);
    if (animRef.current) clearInterval(animRef.current);
    animRef.current = setInterval(() => setAnimTick(t => (t + 1) % 100), 600);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (animRef.current) clearInterval(animRef.current);
    };
  }, [load, refreshKey]);

  // ── Drag handlers ──────────────────────────────────────────────────────
  const getSVGPoint = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    if ('touches' in e) {
      pt.x = e.touches[0].clientX;
      pt.y = e.touches[0].clientY;
    } else {
      pt.x = (e as React.MouseEvent).clientX;
      pt.y = (e as React.MouseEvent).clientY;
    }
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: svgP.x, y: svgP.y };
  };

  const onNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const pt = getSVGPoint(e);
    if (!pt) return;
    const node = laidOut.find(n => n.id === nodeId);
    if (!node) return;
    dragging.current = { id: nodeId, ox: node.x ?? 0, oy: node.y ?? 0, mx: pt.x, my: pt.y };
  };

  const onSVGMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const pt = getSVGPoint(e);
    if (!pt) return;
    const { id, ox, oy, mx, my } = dragging.current;
    const nx = Math.max(50, Math.min(W - 50, ox + pt.x - mx));
    const ny = Math.max(50, Math.min(H - 50, oy + pt.y - my));
    setPinned(prev => ({ ...prev, [id]: { x: nx, y: ny } }));
    setLaidOut(prev => prev.map(n => n.id === id ? { ...n, x: nx, y: ny } : n));
  };

  const onSVGMouseUp = () => { dragging.current = null; };

  const autoArrange = () => {
    if (!data) return;
    setPinned({});
    const laid = forceLayout(data.nodes, data.edges, mode);
    setLaidOut(laid);
  };

  // ── Loading / empty ──────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="w-full flex items-center justify-center glass-card rounded-2xl" style={{ height: H }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <span className="text-slate-500 text-sm">Loading graph…</span>
        </div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="w-full flex items-center justify-center glass-card rounded-2xl" style={{ height: H }}>
        <div className="text-center">
          <div className="text-5xl mb-3">🕸</div>
          <div className="text-slate-600 font-semibold">No graph data yet</div>
          <div className="text-slate-400 text-xs mt-1">Start the simulation to see the live graph</div>
        </div>
      </div>
    );
  }

  const nodes    = laidOut.length > 0 ? laidOut : data.nodes;
  const nodeMap  = Object.fromEntries(nodes.map(n => [n.id, n]));
  const deadSet  = new Set(data.deadlockedPids ?? []);
  const pulse    = animTick % 3 === 0;

  // Count edges between each pair for offset calculation
  const pairCount: Record<string, number> = {};
  for (const e of data.edges) {
    const key = [e.source, e.target].sort().join('|');
    pairCount[key] = (pairCount[key] ?? 0) + 1;
  }
  const pairCur: Record<string, number> = {};

  return (
    <div className="w-full relative glass-card rounded-2xl overflow-hidden" style={{ minHeight: H }}>
      {/* ── Toolbar ── */}
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        <button
          onClick={autoArrange}
          className="skeuo-button text-xs px-3 py-1.5 text-indigo-600 flex items-center gap-1"
          title="Auto-arrange nodes using force layout"
        >
          ✦ Auto-arrange
        </button>
        {Object.keys(pinned).length > 0 && (
          <button
            onClick={() => {
              setPinned({});
              if (data) runLayout(data, {});
            }}
            className="skeuo-button text-xs px-3 py-1.5 text-slate-500"
            title="Reset all node positions"
          >
            ↺ Reset
          </button>
        )}
      </div>

      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', cursor: dragging.current ? 'grabbing' : 'default' }}
        aria-label={`${mode === 'rag' ? 'Resource Allocation' : 'Wait-For'} Graph`}
        onMouseMove={onSVGMouseMove}
        onMouseUp={onSVGMouseUp}
        onMouseLeave={onSVGMouseUp}
      >
        <defs>
          {/* ── Arrow markers ── */}
          <marker id="arr-alloc" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
            <polygon points="0 0,10 4,0 8" fill="#16a34a" />
          </marker>
          <marker id="arr-req" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
            <polygon points="0 0,10 4,0 8" fill="#2563eb" />
          </marker>
          <marker id="arr-wait" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
            <polygon points="0 0,10 4,0 8" fill="#d97706" />
          </marker>
          <marker id="arr-cycle" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
            <polygon points="0 0,10 4,0 8" fill="#ef4444" />
          </marker>

          {/* ── Glow filters ── */}
          <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-amber" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="shadow-node" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="3" stdDeviation="4" floodColor="rgba(30,41,59,0.18)" />
          </filter>

          {/* ── Gradients ── */}
          <radialGradient id="g-proc" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#eff6ff" />
            <stop offset="100%" stopColor="#bfdbfe" />
          </radialGradient>
          <radialGradient id="g-proc-run" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#f0fdf4" />
            <stop offset="100%" stopColor="#86efac" />
          </radialGradient>
          <radialGradient id="g-proc-dead" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#fff1f2" />
            <stop offset="100%" stopColor="#fca5a5" />
          </radialGradient>
          <radialGradient id="g-proc-blocked" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#fffbeb" />
            <stop offset="100%" stopColor="#fde68a" />
          </radialGradient>
          <radialGradient id="g-proc-done" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </radialGradient>
          <linearGradient id="g-res" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fefce8" />
            <stop offset="100%" stopColor="#fef08a" />
          </linearGradient>
          <linearGradient id="g-res-hot" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fff7ed" />
            <stop offset="100%" stopColor="#fdba74" />
          </linearGradient>

          {/* ── Glassmorphic background gradient ── */}
          <linearGradient id="g-bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(224,229,236,0.6)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.3)" />
          </linearGradient>
        </defs>

        {/* ── Background ── */}
        <rect width={W} height={H} fill="url(#g-bg)" />

        {/* ── Subtle dot grid ── */}
        {Array.from({ length: Math.ceil(W / 32) }).map((_, xi) =>
          Array.from({ length: Math.ceil(H / 32) }).map((_, yi) => (
            <circle
              key={`${xi}-${yi}`}
              cx={xi * 32 + 16} cy={yi * 32 + 16} r={1}
              fill="rgba(148,163,184,0.18)"
            />
          ))
        )}

        {/* ── Mode label ── */}
        <text x={W / 2} y={20} textAnchor="middle" fontSize={10} fontWeight="600"
          fill="rgba(100,116,139,0.6)" letterSpacing="1">
          {mode === 'rag' ? 'RESOURCE ALLOCATION GRAPH' : 'WAIT-FOR GRAPH'}
        </text>
        <text x={W - 10} y={H - 10} textAnchor="end" fontSize={9}
          fill="rgba(148,163,184,0.5)">
          drag nodes to reposition
        </text>

        {/* ── Edges ── */}
        {data.edges.map((edge, i) => {
          const s = nodeMap[edge.source];
          const t = nodeMap[edge.target];
          if (!s || !t || s.x == null || t.x == null) return null;

          const key = [edge.source, edge.target].sort().join('|');
          pairCur[key] = (pairCur[key] ?? -1) + 1;
          const { x1, y1, x2, y2, mx, my } = edgeGeometry(s, t, pairCur[key], pairCount[key] ?? 1);
          const path = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;

          const isCycle = edge.inCycle;
          const isAlloc = edge.type === 'allocation';
          const isReq   = edge.type === 'request';

          const color  = isCycle ? '#ef4444' : isAlloc ? '#16a34a' : isReq ? '#2563eb' : '#d97706';
          const marker = isCycle ? 'arr-cycle' : isAlloc ? 'arr-alloc' : isReq ? 'arr-req' : 'arr-wait';
          const dash   = edge.type === 'wait' ? '8 4' : undefined;
          const width  = isCycle ? 3 : 2;

          // Mid-point for label
          const lx = (x1 + x2) / 2 + (mx - (x1 + x2) / 2) * 0.5;
          const ly = (y1 + y2) / 2 + (my - (y1 + y2) / 2) * 0.5;

          return (
            <g key={i}>
              {/* Edge shadow for depth */}
              <path d={path} fill="none" stroke="rgba(30,41,59,0.08)" strokeWidth={width + 2} />
              {/* Main edge */}
              <path
                d={path} fill="none"
                stroke={color} strokeWidth={width}
                strokeDasharray={dash}
                markerEnd={`url(#${marker})`}
                opacity={isCycle ? 1 : 0.8}
                style={{ transition: 'stroke 0.4s' }}
              />

              {/* Amount label on edge */}
              {edge.amount != null && edge.amount > 0 && (
                <g>
                  <rect x={lx - 10} y={ly - 8} width={20} height={14} rx={4}
                    fill="rgba(255,255,255,0.85)" stroke={color} strokeWidth={0.8} />
                  <text x={lx} y={ly + 3} textAnchor="middle" fontSize={9} fontWeight="700"
                    fill={color} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {edge.amount}
                  </text>
                </g>
              )}

              {/* Animated flow particle on allocation edges */}
              {isAlloc && !isCycle && (
                <circle r="3.5" fill={color} opacity="0.7">
                  <animateMotion dur={`${2 + (i % 3) * 0.5}s`} repeatCount="indefinite" path={path} />
                </circle>
              )}

              {/* Animated dot on cycle edges (faster, red) */}
              {isCycle && (
                <circle r="5" fill="#ef4444" opacity="0.9">
                  <animateMotion dur="1.4s" repeatCount="indefinite" path={path} />
                </circle>
              )}
            </g>
          );
        })}

        {/* ── Nodes ── */}
        {nodes.map((node) => {
          const isProc = node.type === 'process';
          const isDead = deadSet.has(node.id) || node.deadlocked;
          const isRun  = node.status === 'RUNNING' || node.id === data.currentPid;
          const isBlk  = node.status === 'BLOCKED';
          const isDone = node.status === 'TERMINATED';
          const isHov  = hoveredNode === node.id;

          const nx = node.x ?? 0;
          const ny = node.y ?? 0;

          // Process gradient
          const gradId = isDead ? 'g-proc-dead'
            : isRun  ? 'g-proc-run'
            : isBlk  ? 'g-proc-blocked'
            : isDone ? 'g-proc-done'
            : 'g-proc';

          // Stroke
          const stroke = isDead ? '#ef4444'
            : isRun  ? '#16a34a'
            : isBlk  ? '#d97706'
            : isDone ? '#94a3b8'
            : '#3b82f6';

          const filterAttr = isDead ? 'url(#glow-red)'
            : isRun  ? 'url(#glow-green)'
            : isBlk  ? 'url(#glow-amber)'
            : 'url(#shadow-node)';

          // Resource utilization color
          const util = node.utilizationPct ?? 0;
          const resGrad = util > 75 ? 'g-res-hot' : 'g-res';
          const resStroke = util > 75 ? '#f97316' : util > 50 ? '#d97706' : '#ca8a04';

          return (
            <g
              key={node.id}
              transform={`translate(${nx}, ${ny})`}
              filter={filterAttr}
              style={{ cursor: 'grab' }}
              onMouseDown={e => onNodeMouseDown(e, node.id)}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {isProc ? (
                <>
                  {/* Outer pulse ring */}
                  {(isRun || isDead) && (
                    <circle
                      r={P_R + 10 + (pulse && isRun ? 3 : 0)}
                      fill="none"
                      stroke={isDead ? '#ef4444' : '#16a34a'}
                      strokeWidth="1.5"
                      opacity={pulse ? 0.45 : 0.12}
                      style={{ transition: 'r 0.6s ease, opacity 0.6s ease' }}
                    />
                  )}
                  {/* Starvation ring (waiting too long) */}
                  {(node.waitTicks ?? 0) > 10 && !isDead && !isRun && (
                    <circle r={P_R + 6} fill="none" stroke="#f59e0b" strokeWidth="1.5"
                      strokeDasharray="4 3" opacity="0.6">
                      <animateTransform attributeName="transform" type="rotate"
                        from="0" to="360" dur="4s" repeatCount="indefinite" />
                    </circle>
                  )}
                  {/* Main circle */}
                  <circle
                    r={isHov ? P_R + 3 : P_R}
                    fill={`url(#${gradId})`}
                    stroke={stroke}
                    strokeWidth={isDead || isRun ? 3 : 2}
                    style={{ transition: 'r 0.2s ease, fill 0.4s, stroke 0.4s' }}
                  />
                  {/* Priority badge */}
                  {(node.priority ?? 0) > 0 && (
                    <g transform={`translate(${P_R - 6}, ${-P_R + 6})`}>
                      <circle r={8} fill="#6366f1" stroke="white" strokeWidth={1.5} />
                      <text textAnchor="middle" dy="0.35em" fontSize={8} fontWeight="800" fill="white"
                        style={{ pointerEvents: 'none', userSelect: 'none' }}>
                        {node.priority}
                      </text>
                    </g>
                  )}
                </>
              ) : (
                <>
                  {/* Resource utilization arc */}
                  {node.total != null && node.total > 0 && (
                    <circle
                      r={R_W / 2 + 6}
                      fill="none"
                      stroke={util > 75 ? '#f97316' : '#22c55e'}
                      strokeWidth="3"
                      strokeDasharray={`${(util / 100) * (Math.PI * (R_W + 12))} ${Math.PI * (R_W + 12)}`}
                      strokeLinecap="round"
                      opacity="0.6"
                      transform="rotate(-90)"
                    />
                  )}
                  {/* Main rect */}
                  <rect
                    x={isHov ? -R_W / 2 - 3 : -R_W / 2}
                    y={isHov ? -R_H / 2 - 3 : -R_H / 2}
                    width={isHov ? R_W + 6 : R_W}
                    height={isHov ? R_H + 6 : R_H}
                    rx={10}
                    fill={`url(#${resGrad})`}
                    stroke={resStroke}
                    strokeWidth={2}
                    style={{ transition: 'all 0.2s ease' }}
                  />
                  {/* Capacity text */}
                  {node.available != null && (
                    <text textAnchor="middle" dy={R_H / 2 - 4} fontSize={8} fontWeight="600"
                      fill={util > 75 ? '#c2410c' : '#65a30d'}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      {node.available}/{node.total}
                    </text>
                  )}
                </>
              )}

              {/* Main label */}
              <text
                textAnchor="middle"
                dy={isProc ? '0.35em' : '-0.1em'}
                fontSize={isProc ? 13 : 11}
                fontWeight="800"
                fill={isDead ? '#991b1b' : isRun ? '#14532d' : isDone ? '#94a3b8' : '#1e293b'}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {node.label}
              </text>

              {/* Status sub-label */}
              {isProc && node.status && !isDone && (
                <text
                  textAnchor="middle"
                  dy={P_R + 16}
                  fontSize={8}
                  fontWeight="700"
                  letterSpacing="0.5"
                  fill={isRun ? '#16a34a' : isDead ? '#ef4444' : isBlk ? '#d97706' : '#64748b'}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {node.status}
                </text>
              )}
              {isDone && (
                <text textAnchor="middle" dy={P_R + 16} fontSize={8} fill="#94a3b8"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  DONE ✓
                </text>
              )}

              {/* Hover tooltip */}
              {isHov && (
                <NodeTooltip node={node} x={isProc ? P_R + 4 : R_W / 2 + 4} y={0} />
              )}
            </g>
          );
        })}

        {/* ── Cycle warning badges ── */}
        {(data.cycles ?? []).length > 0 && (
          <g>
            <rect x={8} y={H - 28 * (data.cycles!.length) - 4} width={W - 16}
              height={28 * data.cycles!.length + 8} rx={8}
              fill="rgba(254,226,226,0.85)" stroke="#fca5a5" strokeWidth={1} />
            {data.cycles!.map((cycle, i) => (
              <text key={i} x={16} y={H - 28 * (data.cycles!.length - i) + 14}
                fontSize={10} fontWeight="700" fill="#dc2626">
                🔴 Cycle {i + 1}: {cycle.join(' → ')} → {cycle[0]}
              </text>
            ))}
          </g>
        )}
      </svg>

      {/* Loading shimmer overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl"
          style={{ background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="w-7 h-7 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
