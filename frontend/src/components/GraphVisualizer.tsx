import { useEffect, useState, useRef, useCallback } from 'react';
import { localApiFetch } from '../lib/localApiFetch';

type GraphNode = {
  id: string;
  label: string;
  type: 'process' | 'resource';
  status?: string;
  deadlocked?: boolean;
  inCycle?: boolean;
  x?: number;
  y?: number;
};
type GraphEdge = {
  source: string;
  target: string;
  type: 'allocation' | 'request' | 'wait';
  inCycle?: boolean;
};
type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  deadlockedPids?: string[];
  cycles?: string[][];
  currentPid?: string | null;
};

type Props = { refreshKey?: number; mode?: 'rag' | 'wfg' };

const W = 700;
const H = 420;
const NODE_R = 30;

// ── Layout: processes on left arc, resources on right arc ──────────────────
function layoutNodes(nodes: GraphNode[]): GraphNode[] {
  const processes = nodes.filter(n => n.type === 'process');
  const resources = nodes.filter(n => n.type === 'resource');
  const placed: GraphNode[] = [];

  const cx = W * 0.38;
  const cy = H / 2;
  const rx = processes.length <= 2 ? 100 : processes.length <= 4 ? 130 : 155;
  const ry = processes.length <= 2 ? 90 : processes.length <= 4 ? 120 : 145;

  processes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(processes.length, 1) - Math.PI / 2;
    placed.push({ ...n, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  });

  const rcx = W * 0.72;
  const rcy = H / 2;
  const rrx = resources.length <= 1 ? 0 : resources.length <= 2 ? 70 : 100;
  const rry = resources.length <= 1 ? 0 : resources.length <= 2 ? 60 : 90;

  resources.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(resources.length, 1) - Math.PI / 2;
    placed.push({ ...n, x: rcx + rrx * Math.cos(angle), y: rcy + rry * Math.sin(angle) });
  });

  return placed;
}

// ── Edge color & marker ────────────────────────────────────────────────────
function edgeStyle(e: GraphEdge): { color: string; marker: string; dash?: string; width: number } {
  if (e.inCycle) return { color: '#ef4444', marker: 'arr-red', width: 3 };
  if (e.type === 'allocation') return { color: '#16a34a', marker: 'arr-green', width: 2 };
  if (e.type === 'request')    return { color: '#2563eb', marker: 'arr-blue', width: 2 };
  return { color: '#d97706', marker: 'arr-amber', dash: '7 4', width: 2 };
}

export default function GraphVisualizer({ refreshKey = 0, mode = 'rag' }: Props) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [animTick, setAnimTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    localApiFetch<GraphData>(`/api/graph?type=${mode}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [mode]);

  useEffect(() => {
    setLoading(true);
    load();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(load, 1200);

    // Pulse animation tick for running nodes
    if (animRef.current) clearInterval(animRef.current);
    animRef.current = setInterval(() => setAnimTick(t => t + 1), 800);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (animRef.current) clearInterval(animRef.current);
    };
  }, [load, refreshKey]);

  // ── Empty / loading state ──────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="w-full flex items-center justify-center" style={{ height: H, background: 'rgba(255,255,255,0.3)', borderRadius: 16 }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
          <span className="text-slate-500 text-sm font-medium">Loading graph…</span>
        </div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="w-full flex items-center justify-center" style={{ height: H, background: 'rgba(255,255,255,0.3)', borderRadius: 16 }}>
        <div className="text-center">
          <div className="text-4xl mb-2">🕸</div>
          <div className="text-slate-500 text-sm">No graph data yet.</div>
          <div className="text-slate-400 text-xs mt-1">Start the simulation to see processes and resources.</div>
        </div>
      </div>
    );
  }

  const nodes = layoutNodes(data.nodes);
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const deadSet = new Set(data.deadlockedPids ?? []);
  const pulse = animTick % 2 === 0; // alternates every 800ms for pulse effect

  return (
    <div className="w-full relative" style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 16, overflow: 'hidden' }}>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', minHeight: 300 }}
        aria-label={`${mode === 'rag' ? 'Resource Allocation' : 'Wait-For'} Graph`}
      >
        <defs>
          {/* Arrow markers */}
          <marker id="arr-green" markerWidth="9" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0,9 3.5,0 7" fill="#16a34a" />
          </marker>
          <marker id="arr-blue" markerWidth="9" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0,9 3.5,0 7" fill="#2563eb" />
          </marker>
          <marker id="arr-amber" markerWidth="9" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0,9 3.5,0 7" fill="#d97706" />
          </marker>
          <marker id="arr-red" markerWidth="9" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0,9 3.5,0 7" fill="#ef4444" />
          </marker>

          {/* Glow filters */}
          <filter id="glow-red" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-blue" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-green" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>

          {/* Gradient fills */}
          <radialGradient id="grad-process" cx="35%" cy="35%">
            <stop offset="0%" stopColor="#dbeafe" />
            <stop offset="100%" stopColor="#93c5fd" />
          </radialGradient>
          <radialGradient id="grad-process-active" cx="35%" cy="35%">
            <stop offset="0%" stopColor="#bbf7d0" />
            <stop offset="100%" stopColor="#4ade80" />
          </radialGradient>
          <radialGradient id="grad-process-dead" cx="35%" cy="35%">
            <stop offset="0%" stopColor="#fecaca" />
            <stop offset="100%" stopColor="#f87171" />
          </radialGradient>
          <radialGradient id="grad-resource" cx="35%" cy="35%">
            <stop offset="0%" stopColor="#fef9c3" />
            <stop offset="100%" stopColor="#fde047" />
          </radialGradient>
        </defs>

        {/* ── Background grid (subtle) ── */}
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
        </pattern>
        <rect width={W} height={H} fill="url(#grid)" />

        {/* ── Edges ── */}
        {data.edges.map((edge, i) => {
          const s = nodeMap[edge.source];
          const t = nodeMap[edge.target];
          // Use nullish check — x can legitimately be 0
          if (s == null || t == null || s.x == null || t.x == null || s.y == null || t.y == null) return null;

          const dx = t.x - s.x;
          const dy = (t.y ?? 0) - (s.y ?? 0);
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len, uy = dy / len;

          // Offset start/end to node edge — use ?? 0 to handle x=0 correctly
          const startR = s.type === 'process' ? NODE_R : NODE_R - 2;
          const endR = t.type === 'process' ? NODE_R + 10 : NODE_R + 8;
          const x1 = (s.x ?? 0) + ux * startR;
          const y1 = (s.y ?? 0) + uy * startR;
          const x2 = (t.x ?? 0) - ux * endR;
          const y2 = (t.y ?? 0) - uy * endR;

          // Slight curve for parallel edges
          const mx = (x1 + x2) / 2 - uy * 18;
          const my = (y1 + y2) / 2 + ux * 18;

          const es = edgeStyle(edge);

          return (
            <g key={i}>
              <path
                d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                fill="none"
                stroke={es.color}
                strokeWidth={es.width}
                strokeDasharray={es.dash}
                markerEnd={`url(#${es.marker})`}
                opacity={edge.inCycle ? 1 : 0.75}
                style={{ transition: 'stroke 0.4s, opacity 0.4s' }}
              />
              {/* Animated dot on cycle edges */}
              {edge.inCycle && (
                <circle r="4" fill="#ef4444" opacity="0.9">
                  <animateMotion
                    dur="1.8s"
                    repeatCount="indefinite"
                    path={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                  />
                </circle>
              )}
            </g>
          );
        })}

        {/* ── Nodes ── */}
        {nodes.map((node) => {
          const isProcess = node.type === 'process';
          const isDead = deadSet.has(node.id) || node.deadlocked;
          const isActive = node.status === 'RUNNING' || node.id === data.currentPid;
          const isBlocked = node.status === 'BLOCKED';
          const isTerminated = node.status === 'TERMINATED';

          const gradId = isDead
            ? 'grad-process-dead'
            : isActive
            ? 'grad-process-active'
            : isProcess
            ? 'grad-process'
            : 'grad-resource';

          const strokeColor = isDead
            ? '#ef4444'
            : isActive
            ? '#16a34a'
            : isBlocked
            ? '#f59e0b'
            : isProcess
            ? '#3b82f6'
            : '#ca8a04';

          const filterAttr = isDead
            ? 'url(#glow-red)'
            : isActive
            ? 'url(#glow-green)'
            : undefined;

          const strokeW = isDead || isActive ? 3.5 : 2;
          // Pulse: active nodes grow slightly — use SVG-native scale around node center
          const scaleVal = isActive && pulse ? 1.08 : 1;

          const nx = node.x ?? 0;
          const ny = node.y ?? 0;

          return (
            <g
              key={node.id}
              transform={`translate(${nx}, ${ny}) scale(${scaleVal})`}
              style={{ transition: 'transform 0.4s ease' }}
              filter={filterAttr}
            >
              {isProcess ? (
                <>
                  {/* Outer pulse ring for active/dead */}
                  {(isActive || isDead) && (
                    <circle
                      r={NODE_R + 8}
                      fill="none"
                      stroke={isDead ? '#ef4444' : '#16a34a'}
                      strokeWidth="1.5"
                      opacity={pulse ? 0.5 : 0.15}
                      style={{ transition: 'opacity 0.8s ease' }}
                    />
                  )}
                  <circle
                    r={NODE_R}
                    fill={`url(#${gradId})`}
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                    style={{ transition: 'fill 0.4s, stroke 0.4s' }}
                  />
                </>
              ) : (
                <>
                  {/* Resource = rounded rectangle */}
                  <rect
                    x={-NODE_R}
                    y={-NODE_R}
                    width={NODE_R * 2}
                    height={NODE_R * 2}
                    rx={10}
                    fill="url(#grad-resource)"
                    stroke={strokeColor}
                    strokeWidth={strokeW}
                    style={{ transition: 'fill 0.4s, stroke 0.4s' }}
                  />
                </>
              )}

              {/* Label */}
              <text
                textAnchor="middle"
                dy="0.35em"
                fontSize={isProcess ? 13 : 11}
                fontWeight="700"
                fill={isDead ? '#991b1b' : isActive ? '#14532d' : '#1e293b'}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {node.label}
              </text>

              {/* Status sub-label */}
              {node.status && !isTerminated && (
                <text
                  textAnchor="middle"
                  dy={NODE_R + 14}
                  fontSize={9}
                  fontWeight="600"
                  fill={
                    isActive ? '#16a34a'
                    : isDead ? '#ef4444'
                    : isBlocked ? '#d97706'
                    : '#64748b'
                  }
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {node.status}
                </text>
              )}
              {isTerminated && (
                <text textAnchor="middle" dy={NODE_R + 14} fontSize={9} fill="#94a3b8"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  DONE
                </text>
              )}
            </g>
          );
        })}

        {/* ── Cycle labels ── */}
        {(data.cycles ?? []).map((cycle, i) => (
          <text
            key={i}
            x={W - 10}
            y={20 + i * 18}
            textAnchor="end"
            fontSize={10}
            fontWeight="700"
            fill="#ef4444"
          >
            🔴 {cycle.join('→')}
          </text>
        ))}
      </svg>

      {/* Loading overlay (subtle) */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.4)', borderRadius: 16 }}>
          <div className="w-6 h-6 border-3 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
