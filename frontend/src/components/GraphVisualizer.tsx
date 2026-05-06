// ...existing code...
import { motion } from 'framer-motion';
import { glassmorphism, graph, colors } from '../designSystem';

// Types for nodes and edges
type Node = {
  id: string;
  label: string;
  type: 'process' | 'resource';
  x: number;
  y: number;
  deadlocked?: boolean;
  active?: boolean;
};
type Edge = {
  source: string;
  target: string;
  type: 'allocation' | 'request' | 'wait';
};
type GraphData = {
  nodes: Node[];
  edges: Edge[];
};

import { useEffect, useState } from 'react';

export default function GraphVisualizer() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/graph')
      .then((res) => res.json())
      .then((data) => setGraphData(data))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !graphData) {
    return <div className={`w-full h-[400px] flex items-center justify-center ${glassmorphism.background} ${glassmorphism.border} ${glassmorphism.shadow} ${glassmorphism.radius}`}>
      <span className="text-slate-400 text-lg">Loading graph...</span>
    </div>;
  }

  return (
    <div className={`w-full h-[400px] relative ${glassmorphism.background} ${glassmorphism.border} ${glassmorphism.shadow} ${glassmorphism.radius}`}>
      <svg width="100%" height="100%" viewBox="0 0 640 400" className="absolute top-0 left-0">
        {/* Edges */}
        {graphData.edges.map((edge, i) => {
          const source = graphData.nodes.find(n => n.id === edge.source);
          const target = graphData.nodes.find(n => n.id === edge.target);
          if (!source || !target) return null;
          const color = edge.type === 'allocation' ? colors.nodeResource : colors.accent;
          return (
            <motion.line
              key={i}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={color}
              strokeWidth={4}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.7, delay: i * 0.1 }}
              markerEnd="url(#arrowhead)"
            />
          );
        })}
        {/* Arrowhead marker */}
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" markerUnits="strokeWidth">
            <polygon points="0 0, 10 3.5, 0 7" fill={colors.accent} />
          </marker>
        </defs>
        {/* Nodes */}
        {graphData.nodes.map((node, i) => (
          <motion.g
            key={node.id}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 + i * 0.1, type: 'spring', stiffness: 200 }}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={36}
              className={
                `${graph.node} ` +
                (node.type === 'process' ? 'bg-sky-200' : 'bg-amber-100') +
                (node.active ? ` ${graph.active}` : '') +
                (node.deadlocked ? ` ${graph.deadlocked}` : '')
              }
              fill={node.type === 'process' ? colors.nodeProcess : colors.nodeResource}
              stroke="#fff"
              strokeWidth={node.active ? 6 : 3}
              style={{ filter: node.deadlocked ? 'drop-shadow(0 0 12px #ef4444)' : undefined }}
            />
            <text
              x={node.x}
              y={node.y + 6}
              textAnchor="middle"
              fontSize="1.3rem"
              fontWeight="bold"
              fill={colors.text}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {node.label}
            </text>
          </motion.g>
        ))}
      </svg>
    </div>
  );
}
