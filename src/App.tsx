import React, { useState, useEffect } from 'react';
import { Lock } from 'lucide-react';

export default function App() {
  const [health, setHealth] = useState('');

  useEffect(() => {
    fetch('/api/health').then(res => res.json()).then(data => setHealth(data.status));
  }, []);

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto flex flex-col gap-8">
      <header className="border-b border-slate-800 pb-4">
        <h1 className="text-3xl font-bold text-white tracking-tight">Game Lobby</h1>
        <p className="text-slate-400 mt-2">Server Status: {health === 'ok' ? 'Online' : 'Connecting...'}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <GameCard title="1–10 Room" entry="500 ETB" description="10 spots. 1st Place: 4,000 ETB. 2nd Place: 500 ETB." />
        <GameCard title="1–20 Room" entry="1,000 ETB" description="20 spots. 1st: 14,000 ETB. 2nd: 3,000 ETB. 3rd: 1,000 ETB." />
        <GameCard title="Mini-VIP Room (1–50)" entry="2,000 ETB" description="50 spots. Premium Lightning Blitz effects." />
        <GameCard title="VIP-Grand Room (1–100)" entry="500 ETB" description="100 spots. Mechanical odometer canvas." />
        <GameCard title="Even/Odd Room" entry="Custom" description="Bet Even or Odd. Win 1.9x." />
      </div>
    </div>
  );
}

function GameCard({ title, entry, description }: { title: string, entry: string, description: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-slate-600 transition-colors cursor-pointer group">
      <div className="flex justify-between items-start mb-4">
        <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
        <span className="bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full text-sm font-medium">{entry}</span>
      </div>
      <p className="text-slate-400 text-sm leading-relaxed mb-6">{description}</p>
      <button className="w-full bg-slate-800 group-hover:bg-blue-600 text-white py-2 rounded-lg font-medium transition-colors">
        Enter Room
      </button>
    </div>
  );
}
