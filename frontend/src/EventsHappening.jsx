import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { MapPin, Clock, Ticket, Search, Tag, CalendarX } from "lucide-react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { EVENT_STATUS, effectiveStatus } from "./eventStatus";
import { ipfsToHttp } from "./ipfs";

const USD_PER_ETH = 3500;
const usd = (eth) =>
  `$${(parseFloat(eth || 0) * USD_PER_ETH).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// UNIX seconds -> "Saturday, Oct 14 at 8:00 PM"
export function formatEventWindow(unixSec) {
  if (!unixSec) return "Date to be announced";
  const d = new Date(unixSec * 1000);
  const date = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} at ${time}`;
}

/**
 * Public "Events Happening" storefront grid — reads the Firestore `events`
 * collection LIVE (onSnapshot) and renders only status === "published" events
 * that haven't finished. Status changes (e.g. an emergency cancel) update the
 * grid instantly. Each card routes to /event/:eventId for checkout.
 */
export default function EventsHappening() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    // Strict state filter at the query level: only published documents.
    const qy = query(collection(db, "events"), where("status", "==", EVENT_STATUS.PUBLISHED));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          // Drafts/canceled/deleted are excluded by the query; drop derived-finished too.
          .filter((ev) => effectiveStatus(ev) === EVENT_STATUS.PUBLISHED)
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        setEvents(list);
        setLoading(false);
      },
      (err) => {
        console.error("Events stream failed:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const filtered = events.filter((ev) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      (ev.headline || "").toLowerCase().includes(needle) ||
      (ev.venue || "").toLowerCase().includes(needle) ||
      (ev.category || "").toLowerCase().includes(needle)
    );
  });

  return (
    <section id="events" className="max-w-7xl mx-auto px-6 sm:px-10 py-14 scroll-mt-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Events happening</h2>
          <p className="text-slate-500 mt-1">Discover events and grab your tickets.</p>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Search events"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm animate-pulse">
              <div className="h-44 bg-slate-100" />
              <div className="p-5 space-y-3">
                <div className="h-5 bg-slate-100 rounded w-3/4" />
                <div className="h-4 bg-slate-100 rounded w-1/2" />
                <div className="h-10 bg-slate-100 rounded-xl mt-4" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-slate-300 rounded-2xl p-20 text-center bg-slate-50">
          <CalendarX className="w-12 h-12 text-slate-300 mx-auto mb-5" />
          <p className="text-slate-600 font-semibold">{q ? "No events match your search" : "No events on sale yet"}</p>
          <p className="text-slate-400 text-sm mt-1">{q ? "Try a different keyword." : "Check back soon — new events appear here automatically."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((ev) => (
            <EventCard key={ev.id} ev={ev} onOpen={() => navigate(`/event/${ev.id}`)} />
          ))}
        </div>
      )}
    </section>
  );
}

const EventCard = ({ ev, onOpen }) => {
  const banner = ev.imageHash ? ipfsToHttp(ev.imageHash) : "";
  // Availability mirrors the same Firestore counter checkout uses, so the
  // storefront, the purchase page, and the organizer dashboard all agree.
  const supply = Number(ev.aggregateSupply) || 0;
  const sold = Number(ev.sold) || 0;
  const remaining = Math.max(0, supply - sold);
  const soldPct = supply > 0 ? Math.min(100, Math.round((sold / supply) * 100)) : 0;
  const soldOut = supply > 0 && remaining <= 0;

  return (
    <motion.div
      whileHover={{ y: -3 }}
      onClick={onOpen}
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col cursor-pointer"
    >
      <div className="relative h-44 overflow-hidden bg-slate-100">
        {banner ? (
          <>
            {/* blurred fill so any poster aspect ratio looks clean */}
            <img src={banner} aria-hidden="true" className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-40" />
            {/* full poster, never cropped */}
            <img src={banner} alt={ev.headline} className="relative w-full h-full object-contain" loading="lazy" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300"><Ticket size={34} /></div>
        )}
        {ev.category && (
          <span className="absolute top-3 left-3 inline-flex px-2.5 py-1 bg-white/90 backdrop-blur text-indigo-700 text-xs font-semibold rounded-full border border-indigo-200">
            {ev.category}
          </span>
        )}
      </div>

      <div className="p-5 flex-1 flex flex-col">
        <h3 className="text-lg font-semibold text-slate-900 leading-snug line-clamp-1">{ev.headline}</h3>
        <div className="mt-2 space-y-1.5 text-sm text-slate-500">
          <p className="inline-flex items-center gap-1.5"><Clock size={14} className="text-slate-400 shrink-0" /> {formatEventWindow(ev.timestamp)}</p>
          <p className="inline-flex items-center gap-1.5"><MapPin size={14} className="text-slate-400 shrink-0" /> <span className="truncate">{ev.venue || "Venue TBA"}</span></p>
        </div>

        {/* Availability */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
            <span className="inline-flex items-center gap-1.5"><Tag size={13} className="text-slate-400" /> Availability</span>
            <span className={`font-medium ${soldOut ? "text-red-600" : "text-slate-700"}`}>
              {soldOut ? "Sold out" : <>{remaining.toLocaleString()} of {supply.toLocaleString()} left</>}
            </span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${soldOut ? "bg-red-500" : "bg-indigo-500"}`} style={{ width: `${soldPct}%` }} />
          </div>
        </div>

        <div className="flex items-end justify-between mt-4 pt-4 border-t border-slate-100">
          <div>
            <p className="text-xs text-slate-500">From</p>
            <p className="text-xl font-bold text-slate-900">{parseFloat(ev.priceEth || 0).toFixed(3)} <span className="text-sm font-medium text-slate-400">ETH</span></p>
            <p className="text-xs text-slate-400">≈ {usd(ev.priceEth)}</p>
          </div>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="mt-4 w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
          disabled={soldOut}
        >
          <Ticket size={16} /> {soldOut ? "Sold out" : "Buy tickets"}
        </button>
      </div>
    </motion.div>
  );
};
