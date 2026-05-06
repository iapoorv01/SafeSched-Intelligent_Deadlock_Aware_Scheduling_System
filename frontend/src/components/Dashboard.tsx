
import { glassmorphism, skeuomorphism, colors } from '../designSystem';
import GraphVisualizer from './GraphVisualizer';
import { useState, useEffect, useCallback } from 'react';


export default function Dashboard() {
  // Simulation playback state (synced with API)
  const [isPlaying, setIsPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // Fetch current simulation state from API
  const fetchState = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/simulation');
      if (res.ok) {
        const data = await res.json();
        setIsPlaying(data.isPlaying);
        setStep(data.step);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    // Optionally poll for updates if playing
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isPlaying) {
      interval = setInterval(fetchState, 1000);
    }
    return () => interval && clearInterval(interval);
  }, [isPlaying, fetchState]);

  // Handlers for controls (call API)
  const sendAction = async (action: 'play' | 'pause' | 'step' | 'reset') => {
    setLoading(true);
    try {
      const res = await fetch('/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsPlaying(data.isPlaying);
        setStep(data.step);
      }
    } finally {
      setLoading(false);
    }
  };
  const handlePlay = () => sendAction('play');
  const handlePause = () => sendAction('pause');
  const handleStep = () => sendAction('step');
  const handleReset = () => sendAction('reset');

  // Analytics state
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Fetch analytics from API
  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch('/api/analytics');
      if (res.ok) {
        setAnalytics(await res.json());
      }
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics, step]); // refetch on step change

  return (
    <div className="min-h-screen flex flex-col gap-8 p-8" style={{ background: colors.background }}>
      {/* Header */}
      <header className={`glass-card ${glassmorphism.background} ${glassmorphism.border} ${glassmorphism.shadow} ${glassmorphism.radius} p-8 mb-6 flex flex-col items-center`}> 
        <h1 className="text-5xl font-black tracking-tighter text-slate-800 mb-2 uppercase drop-shadow-lg">Safe<span className="text-blue-600">Sched</span></h1>
        <div className="skeuo-pressed inline-block px-6 py-2 rounded-full text-sm font-medium text-blue-600/80 mb-2">AI Deadlock Simulator</div>
        <p className="text-lg text-slate-500 max-w-2xl text-center">Visualize, simulate, and analyze deadlocks with a beautiful, interactive UI.</p>
      </header>

      {/* Main Panels */}
      <main className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Simulation Controls & Scenario Import/Export */}
        <section className={`skeuo-flat ${skeuomorphism.card} flex flex-col items-center justify-center w-full`}>
          <h2 className="text-xl font-bold mb-4 text-slate-700">Simulation Controls</h2>
          <div className="flex gap-4 mt-2 mb-6">
            <button
              className={`skeuo-pressed px-6 py-2 rounded-2xl font-bold text-blue-700 shadow transition-all hover:scale-105 active:scale-95 ${isPlaying ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={handlePlay}
              disabled={isPlaying || loading}
            >
              Play
            </button>
            <button
              className={`skeuo-pressed px-6 py-2 rounded-2xl font-bold text-blue-700 shadow transition-all hover:scale-105 active:scale-95 ${!isPlaying ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={handlePause}
              disabled={!isPlaying || loading}
            >
              Pause
            </button>
            <button
              className="skeuo-pressed px-6 py-2 rounded-2xl font-bold text-blue-700 shadow transition-all hover:scale-105 active:scale-95"
              onClick={handleStep}
              disabled={loading}
            >
              Step
            </button>
            <button
              className="skeuo-pressed px-6 py-2 rounded-2xl font-bold text-blue-700 shadow transition-all hover:scale-105 active:scale-95"
              onClick={handleReset}
              disabled={loading}
            >
              Reset
            </button>
          </div>
          {/* Scenario Import/Export Controls */}
          <div className="w-full flex flex-col md:flex-row gap-4 items-center justify-center mt-2">
            {/* Import */}
            <label className="skeuo-pressed px-4 py-2 rounded-2xl font-bold text-blue-700 shadow cursor-pointer transition-all hover:scale-105 active:scale-95">
              Import Scenario
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  try {
                    const scenario = JSON.parse(text);
                    await fetch('/api/scenario', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(scenario),
                    });
                    alert('Scenario imported!');
                  } catch {
                    alert('Invalid scenario file.');
                  }
                }}
              />
            </label>
            {/* Export */}
            <button
              className="skeuo-pressed px-4 py-2 rounded-2xl font-bold text-blue-700 shadow transition-all hover:scale-105 active:scale-95"
              onClick={async () => {
                const res = await fetch('/api/scenario');
                if (res.ok) {
                  const scenario = await res.json();
                  const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'scenario.json';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } else {
                  alert('No scenario to export.');
                }
              }}
            >
              Export Scenario
            </button>
            {/* Reset */}
            <button
              className="skeuo-pressed px-4 py-2 rounded-2xl font-bold text-red-600 shadow transition-all hover:scale-105 active:scale-95"
              onClick={async () => {
                await fetch('/api/scenario', { method: 'DELETE' });
                alert('Scenario reset.');
              }}
            >
              Reset Scenario
            </button>
          </div>
          <div className="mt-4 text-slate-500 text-sm">Current Step: <span className="font-bold text-blue-700">{step}</span></div>
        </section>
        {/* Graph Visualizer */}
        <section className={`glass-card ${glassmorphism.background} ${glassmorphism.border} ${glassmorphism.shadow} ${glassmorphism.radius} flex flex-col items-center justify-center`}>
          <h2 className="text-xl font-bold mb-4 text-slate-700">Graph Visualizer</h2>
          <div className="w-full flex items-center justify-center">
            <GraphVisualizer />
          </div>
        </section>
        {/* Analytics Panel */}
        <section className={`skeuo-flat ${skeuomorphism.card} flex flex-col items-center justify-center`}>
          <h2 className="text-xl font-bold mb-4 text-slate-700">Analytics</h2>
          {analyticsLoading ? (
            <div className="text-slate-400 text-sm">Loading metrics...</div>
          ) : analytics ? (
            <div className="w-full flex flex-col gap-2 items-center">
              <div className="flex gap-4 flex-wrap justify-center">
                <div className="bg-white/70 rounded-xl px-4 py-2 shadow text-center">
                  <div className="text-xs text-slate-400">Steps</div>
                  <div className="text-lg font-bold text-blue-700">{analytics.steps}</div>
                </div>
                <div className="bg-white/70 rounded-xl px-4 py-2 shadow text-center">
                  <div className="text-xs text-slate-400">Grants</div>
                  <div className="text-lg font-bold text-green-600">{analytics.grants}</div>
                </div>
                <div className="bg-white/70 rounded-xl px-4 py-2 shadow text-center">
                  <div className="text-xs text-slate-400">Denials</div>
                  <div className="text-lg font-bold text-red-500">{analytics.denials}</div>
                </div>
                <div className="bg-white/70 rounded-xl px-4 py-2 shadow text-center">
                  <div className="text-xs text-slate-400">Deadlocks</div>
                  <div className="text-lg font-bold text-rose-600">{analytics.deadlocks}</div>
                </div>
                <div className="bg-white/70 rounded-xl px-4 py-2 shadow text-center">
                  <div className="text-xs text-slate-400">Recoveries</div>
                  <div className="text-lg font-bold text-amber-600">{analytics.recoveries}</div>
                </div>
                <div className="bg-white/70 rounded-xl px-4 py-2 shadow text-center">
                  <div className="text-xs text-slate-400">Checkpoints</div>
                  <div className="text-lg font-bold text-sky-600">{analytics.checkpoints}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-slate-400 text-sm">No analytics available.</div>
          )}
        </section>
      </main>
    </div>
  );
}
