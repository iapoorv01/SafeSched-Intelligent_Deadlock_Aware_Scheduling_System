// SafeSched Design System (Glassmorphism + Skeuomorphism)
// Use these variables and classes in Tailwind config and CSS modules

export const colors = {
  background: '#e0e5ec',
  glass: 'rgba(255,255,255,0.25)',
  glassBorder: 'rgba(255,255,255,0.35)',
  accent: '#2563eb', // blue-600
  accentSoft: '#60a5fa', // blue-400
  text: '#1e293b', // slate-800
  textSoft: '#64748b', // slate-400
  shadow: 'rgba(30,41,59,0.12)',
  shadowStrong: 'rgba(30,41,59,0.18)',
  nodeProcess: '#38bdf8', // sky-400
  nodeResource: '#fbbf24', // amber-400
  error: '#ef4444',
  success: '#22c55e',
};

export const glassmorphism = {
  background: 'backdrop-blur-md bg-white/30',
  border: 'border border-white/40',
  shadow: 'shadow-[0_8px_32px_0_rgba(31,38,135,0.18)]',
  radius: 'rounded-3xl',
};

export const skeuomorphism = {
  pressed: 'shadow-inner bg-gradient-to-br from-white/80 to-slate-200',
  flat: 'bg-gradient-to-br from-slate-100 to-slate-300 shadow',
  button: 'active:shadow-inner hover:scale-105 transition-all',
  card: 'rounded-[2.5rem] p-6 md:p-10',
};

export const animation = {
  transition: 'transition-all duration-300',
  bounce: 'animate-bounce',
  pulse: 'animate-pulse',
  fadeIn: 'animate-fade-in',
};

export const graph = {
  node: 'rounded-full shadow-lg border-2 border-white/60',
  edge: 'stroke-[3] stroke-blue-300',
  active: 'ring-4 ring-blue-400',
  deadlocked: 'ring-4 ring-red-400',
};

// Example usage in Tailwind: className={`glass-card ${glassmorphism.background} ${glassmorphism.border} ${glassmorphism.shadow} ${glassmorphism.radius}`}
