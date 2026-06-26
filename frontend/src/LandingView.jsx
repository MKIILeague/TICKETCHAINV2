import React from 'react';
import { useTicketWallet } from './useTicketWallet';

const LandingView = ({ setRole }) => {
  const { login, authenticated, user, address } = useTicketWallet();

  const featuredEvents = [
    { id: 1, title: 'Web3 Global Summit', date: 'Oct 15, 2026', price: '0.05 ETH', category: 'Conference', image: 'https://images.unsplash.com/photo-1540575861501-7ce0514e1ff1?auto=format&fit=crop&w=800&q=80' },
    { id: 2, title: 'Neon Night Ravers', date: 'Nov 02, 2026', price: '0.02 ETH', category: 'Concert', image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=800&q=80' },
    { id: 3, title: 'Blockchain Masters', date: 'Dec 12, 2026', price: '0.08 ETH', category: 'Workshop', image: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=800&q=80' },
  ];

  return (
    <div className="flex flex-col">
      {/* Organizer entry banner (spec §2 — prominent organizer switch, visible to everyone) */}
      <button
        onClick={() => setRole('organizer')}
        className="group w-full bg-gradient-to-r from-cyan-600/20 to-indigo-600/20 border-b border-cyan-500/20 py-3 px-6 flex items-center justify-center gap-2 sm:gap-3 hover:from-cyan-600/30 hover:to-indigo-600/30 transition-all cursor-pointer"
      >
        <span className="text-[11px] sm:text-sm font-bold text-cyan-300 uppercase tracking-wider">
          Are you an Organizer?
        </span>
        <span className="text-[11px] sm:text-sm font-black text-white inline-flex items-center gap-1.5">
          Switch to Organizer Dashboard
          <span className="group-hover:translate-x-1 transition-transform">→</span>
        </span>
      </button>

      {/* Hero Section */}
      <section className="relative h-[80vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-b from-indigo-900/20 via-[#0b0f19] to-[#0b0f19]"></div>
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/10 rounded-full blur-[120px]"></div>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-6 text-center">
          <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-6">
            THE FUTURE OF <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">TICKETING</span>
          </h1>
          <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto mb-10 font-medium">
            A decentralized, secure, and transparent secondary marketplace for event tickets. 
            No more fakes. No more scams. Just pure access.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {authenticated ? (
              <button 
                onClick={() => setRole('events')}
                className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-lg transition-all shadow-xl shadow-indigo-500/25"
              >
                Explore Marketplace
              </button>
            ) : (
              <button 
                onClick={login}
                className="px-8 py-4 bg-white text-black hover:bg-slate-100 rounded-2xl font-bold text-lg transition-all shadow-xl"
              >
                Get Started Now
              </button>
            )}
            <button className="px-8 py-4 bg-slate-800/50 hover:bg-slate-800 text-white border border-slate-700 rounded-2xl font-bold text-lg transition-all backdrop-blur-sm">
              How it Works
            </button>
          </div>

          {authenticated && (
            <div className="mt-8 p-4 bg-slate-900/50 border border-slate-800 rounded-2xl inline-flex items-center gap-4 backdrop-blur-md">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center font-bold text-sm">
                {user?.email?.address?.charAt(0).toUpperCase() || 'W'}
              </div>
              <div className="text-left">
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Authenticated as</p>
                <p className="text-sm font-mono text-indigo-400">{address?.substring(0, 6)}...{address?.substring(38)}</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Discovery Grid */}
      <section className="max-w-7xl mx-auto px-6 py-20 w-full">
        <div className="flex justify-between items-end mb-12">
          <div>
            <h2 className="text-3xl font-black tracking-tight mb-2 uppercase italic">Live Events</h2>
            <p className="text-slate-500 font-medium">Discover trending events secured by TicketChain</p>
          </div>
          <button className="text-indigo-400 font-bold text-sm hover:text-indigo-300 transition-colors uppercase tracking-widest">
            View All Events &rarr;
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {featuredEvents.map((event) => (
            <div key={event.id} className="group relative bg-[#161b2c] border border-slate-800 rounded-3xl overflow-hidden hover:border-indigo-500/50 transition-all hover:shadow-2xl hover:shadow-indigo-500/10">
              <div className="h-48 overflow-hidden">
                <img 
                  src={event.image} 
                  alt={event.title} 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
              </div>
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <span className="px-3 py-1 bg-indigo-500/10 text-indigo-400 text-[10px] font-black uppercase tracking-widest rounded-full border border-indigo-500/20">
                    {event.category}
                  </span>
                  <span className="text-cyan-400 font-bold text-sm">{event.price}</span>
                </div>
                <h3 className="text-xl font-bold mb-2 group-hover:text-indigo-400 transition-colors">{event.title}</h3>
                <p className="text-slate-500 text-sm mb-6">{event.date}</p>
                <button className="w-full py-3 bg-slate-800 group-hover:bg-indigo-600 text-white font-bold rounded-xl transition-all">
                  Get Tickets
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Trust & Tech */}
      <section className="bg-slate-900/30 border-y border-slate-800/50 py-16">
        <div className="max-w-7xl mx-auto px-6 flex flex-wrap justify-center gap-12 md:gap-24 opacity-50 grayscale hover:grayscale-0 transition-all duration-700">
          <div className="flex items-center gap-2 font-black text-xl italic text-slate-400">HARDHAT</div>
          <div className="flex items-center gap-2 font-black text-xl italic text-slate-400">PRIVY</div>
          <div className="flex items-center gap-2 font-black text-xl italic text-slate-400">ETHERS.JS</div>
          <div className="flex items-center gap-2 font-black text-xl italic text-slate-400">TAILWIND</div>
        </div>
      </section>
    </div>
  );
};

export default LandingView;
