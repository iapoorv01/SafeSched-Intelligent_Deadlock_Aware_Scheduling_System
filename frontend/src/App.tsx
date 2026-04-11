
import React, { useState, useEffect } from 'react';
import './App.css';

const initialMatrix = (rows: number, cols: number) => Array.from({ length: rows }, () => Array(cols).fill(0));

function App() {
  const [processes, setProcesses] = useState(3);
  const [resources, setResources] = useState(2);
  const [allocation, setAllocation] = useState(initialMatrix(3, 2));
  const [max, setMax] = useState(initialMatrix(3, 2));
  const [available, setAvailable] = useState(Array(2).fill(0));
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ deadlock: number; confidence: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAllocation(initialMatrix(processes, resources));
    setMax(initialMatrix(processes, resources));
    setAvailable(Array(resources).fill(0));
  }, [processes, resources]);

  const handleMatrixChange = (setter: (val: number[][]) => void, matrix: number[][], i: number, j: number, value: number) => {
    const updated = matrix.map((row, rowIdx) =>
      rowIdx === i ? row.map((col, colIdx) => (colIdx === j ? value : col)) : row
    );
    setter(updated);
  };

  const handleAvailableChange = (j: number, value: number) => {
    const updated = available.map((v: number, idx: number) => (idx === j ? value : v));
    setAvailable(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(import.meta.env.VITE_API_BASE_URL + '/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processes,
          resources,
          allocation_matrix: allocation,
          max_matrix: max,
          available,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Validation failed. Check your logic.');
      }
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#e0e5ec] text-slate-700 py-10 px-4 md:px-8">
      {/* Header Section */}
      <header className="max-w-4xl mx-auto mb-12 text-center fade-in">
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-slate-800 mb-4 uppercase">
          Safe<span className="text-blue-600">Sched</span>
        </h1>
        <div className="skeuo-pressed inline-block px-6 py-2 rounded-full text-sm font-medium text-blue-600/80 mb-6">
          v1.0 AI Engine • Research Toolkit
        </div>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed px-4">
          Intelligent simulation platform for deadlock analysis. 
          Move from <span className="font-semibold">reactive detection</span> to 
          <span className="bg-white/50 px-1 rounded mx-1 italic">predictive management</span>.
        </p>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Main Panel: Analysis Engine */}
        <section className="lg:col-span-8 glass-card rounded-[2.5rem] p-6 md:p-10 shadow-inner fade-in">
          <div className="flex flex-wrap items-center justify-between mb-8 gap-4">
            <h2 className="text-xl md:text-2xl font-bold text-slate-800 flex items-center gap-3">
              <span className="w-10 h-10 skeuo-flat rounded-full flex items-center justify-center text-blue-500 text-lg">⚙</span>
              Analysis Engine
            </h2>
            <div className="flex items-center gap-1 md:gap-2 skeuo-pressed p-1 rounded-2xl w-full sm:w-auto mt-2 sm:mt-0">
              {[1, 2, 3, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => setStep(s)}
                  className={`flex-1 sm:flex-none px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-bold transition-all ${
                    step === s ? 'skeuo-flat text-blue-600 scale-105' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Step {s}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8 min-h-[400px]">
            {step === 1 && (
              <div className="space-y-6 fade-in">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <label className="block text-sm font-bold text-slate-500 mb-3 uppercase tracking-wider ml-1">Processes (P)</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={processes === 0 ? '' : processes}
                      onChange={(e) => setProcesses(e.target.value === '' ? 0 : Number(e.target.value))}
                      className="skeuo-input text-xl h-16"
                    />
                    <p className="mt-2 text-xs text-slate-400 ml-1 italic">Number of active tasks in the system</p>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-500 mb-3 uppercase tracking-wider ml-1">Resources (R)</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={resources === 0 ? '' : resources}
                      onChange={(e) => setResources(e.target.value === '' ? 0 : Number(e.target.value))}
                      className="skeuo-input text-xl h-16"
                    />
                    <p className="mt-2 text-xs text-slate-400 ml-1 italic">Different classes of system resources</p>
                  </div>
                </div>
                <div className="bg-blue-50/50 p-6 rounded-3xl border border-blue-100 flex items-center gap-4">
                  <span className="text-2xl">💡</span>
                  <p className="text-sm text-blue-700/80 leading-snug">
                    <b>Beginner Tip:</b> Most classic systems start with 3 processes and 2-3 resource types (e.g., CPU, Memory).
                  </p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="fade-in">
                <h3 className="text-sm font-bold text-slate-500 mb-4 uppercase tracking-wider">Allocation Matrix</h3>
                <div className="overflow-x-auto pb-4 custom-scroll">
                  <table className="border-separate border-spacing-4">
                    <tbody>
                      {allocation.map((row, i) => (
                        <tr key={i}>
                          <td className="text-xs font-bold text-slate-400 uppercase pr-2">P{i}</td>
                          {row.map((val: number, j: number) => (
                            <td key={j}>
                              <input
                                type="number"
                                placeholder="0"
                                value={val === 0 ? '' : val}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleMatrixChange(setAllocation, allocation, i, j, e.target.value === '' ? 0 : Number(e.target.value))}
                                className="skeuo-input w-20 h-14 text-center ring-inset"
                              />
                              {i === 0 && <p className="text-[10px] text-center mt-2 font-bold text-slate-400 uppercase tracking-tighter">Res {j}</p>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="fade-in">
                <h3 className="text-sm font-bold text-slate-500 mb-4 uppercase tracking-wider">Max Requirements Matrix</h3>
                <div className="overflow-x-auto pb-4 custom-scroll">
                  <table className="border-separate border-spacing-4">
                    <tbody>
                      {max.map((row, i) => (
                        <tr key={i}>
                          <td className="text-xs font-bold text-slate-400 uppercase pr-2">P{i}</td>
                          {row.map((val: number, j: number) => (
                            <td key={j}>
                              <input
                                type="number"
                                placeholder="0"
                                value={val === 0 ? '' : val}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleMatrixChange(setMax, max, i, j, e.target.value === '' ? 0 : Number(e.target.value))}
                                className="skeuo-input w-20 h-14 text-center border-2 border-transparent focus:border-blue-300"
                              />
                              {i === 0 && <p className="text-[10px] text-center mt-2 font-bold text-slate-400 uppercase tracking-tighter">Res {j}</p>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="fade-in space-y-10">
                <div>
                  <h3 className="text-sm font-bold text-slate-500 mb-6 uppercase tracking-wider">Available Resources Vector</h3>
                  <div className="flex flex-wrap gap-4 md:gap-6 justify-center sm:justify-start">
                    {available.map((val: number, j: number) => (
                      <div key={j} className="text-center group flex-1 min-w-[80px] max-w-[120px]">
                        <label className="block text-[10px] font-bold text-slate-400 mb-2 uppercase group-hover:text-blue-500 transition-colors">Res {j}</label>
                        <input
                          type="number"
                          placeholder="0"
                          value={val === 0 ? '' : val}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleAvailableChange(j, e.target.value === '' ? 0 : Number(e.target.value))}
                          className="skeuo-input w-full h-16 md:h-20 text-center text-xl md:text-2xl font-black text-blue-600"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-200/50">
                  <button 
                    type="submit" 
                    disabled={loading}
                    className={`w-full h-16 rounded-[1.5rem] font-black text-lg tracking-widest uppercase transition-all flex items-center justify-center gap-3 ${
                      loading ? 'bg-slate-200 text-slate-400' : 'bg-blue-600 text-white shadow-[0_10px_30px_-10px_rgba(37,99,235,0.6)] hover:scale-[1.02] active:scale-95'
                    }`}
                  >
                    {loading ? (
                      <span className="w-6 h-6 border-4 border-slate-300 border-t-slate-600 rounded-full animate-spin"></span>
                    ) : (
                      <>⚡ Run Prediction ⚡</>
                    )}
                  </button>
                </div>

                {error && (
                  <div className="p-5 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium flex gap-3 fade-in">
                    <span>⚠️</span> {error}
                  </div>
                )}

                {result && (
                  <div className={`p-8 rounded-[2rem] text-center fade-in bg-white/40 border border-white/60 shadow-xl ${
                    result.deadlock ? 'ring-4 ring-red-400/20' : 'ring-4 ring-green-400/20'
                  }`}>
                    <div className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">AI Prediction Result</div>
                    <div className={`text-4xl font-black mb-3 ${result.deadlock ? 'text-red-500' : 'text-green-600'}`}>
                      {result.deadlock ? 'DEADLOCK DETECTED' : 'SYSTEM IS SAFE'}
                    </div>
                    <div className="text-slate-500 text-sm">
                      Model Confidence: 
                      <span className="ml-2 px-3 py-1 skeuo-pressed rounded-full text-blue-600 font-bold">
                        {(result.confidence * 100).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </form>

          {/* Nav Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between mt-12 bg-white/30 backdrop-blur p-4 rounded-3xl gap-4">
            <button 
              onClick={() => setStep(s => Math.max(1, s-1))}
              disabled={step === 1}
              className={`skeuo-button h-12 w-full sm:w-auto flex items-center justify-center gap-2 ${step === 1 ? 'opacity-30 cursor-not-allowed' : ''}`}
            >
              ← Back
            </button>

            <div className="text-slate-400 text-[10px] md:text-xs font-bold uppercase self-center tracking-widest order-first sm:order-none">
              Progress: {Math.round((step/4)*100)}%
            </div>

            {step < 4 ? (
              <button 
                onClick={() => setStep(s => Math.min(4, s+1))}
                className="skeuo-button h-12 w-full sm:w-auto bg-blue-500 !text-white flex items-center justify-center gap-2"
              >
                Proceed →
              </button>
            ) : (
              <div className="hidden sm:block w-32"></div>
            )}
          </div>
        </section>

        {/* Sidebar: Pipeline & Roadmap */}
        <aside className="lg:col-span-4 space-y-8 fade-in" style={{ animationDelay: '0.2s' }}>
          {/* Status Card */}
          <div className="glass-card rounded-[2rem] p-8 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              Live Pipeline
            </h3>
            <div className="space-y-6">
              {[
                { title: 'AI Prediction', status: 'Active', desc: 'Predictive Neural Analysis' },
                { title: 'Simulation Engine', status: 'Coming Soon', desc: 'Real-time resource flow' },
                { title: 'Visual RAG', status: 'Coming Soon', desc: 'Graph-based visualization' },
              ].map((item, idx) => (
                <div key={idx} className={`p-4 rounded-2xl transition-all ${item.status === 'Active' ? 'skeuo-pressed border-l-4 border-blue-500' : 'opacity-50'}`}>
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-bold text-sm text-slate-700">{item.title}</span>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                      item.status === 'Active' ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-500'
                    }`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Info Card */}
          <div className="skeuo-flat rounded-[2rem] p-8">
            <h4 className="font-black text-slate-400 text-xs uppercase tracking-[0.2em] mb-4">Architecture</h4>
            <p className="text-sm leading-relaxed text-slate-600 italic">
              "Merging classical banker safety algorithms with deep predictive modeling to create a self-healing resource management framework."
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['FastAPI', 'PyTorch', 'React 19', 'Vite'].map(tech => (
                <span key={tech} className="px-3 py-1 skeuo-pressed rounded-full text-[10px] font-bold text-slate-500">{tech}</span>
              ))}
            </div>
          </div>
        </aside>
      </main>

      <footer className="mt-20 text-center text-slate-400 text-xs font-bold uppercase tracking-widest pb-10">
        SafeSched Protocol © 2026 // Research & Engineering Deployment
      </footer>
    </div>
  );
}

export default App;

