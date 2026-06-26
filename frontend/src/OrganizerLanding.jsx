import { useNavigate } from "react-router-dom";
import { Building2, LogIn, FilePlus2 } from "lucide-react";

// Organizer entry: choose Register (new) or Login (existing/approved).
export default function OrganizerLanding() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center p-8 bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="w-14 h-14 mx-auto mb-5 bg-indigo-600 rounded-2xl flex items-center justify-center">
          <Building2 className="text-white w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-2">Organizer portal</h1>
        <p className="text-slate-500 text-sm mb-6 leading-relaxed">
          Register your organisation to start issuing tickets, or sign in to your approved organizer account.
        </p>
        <div className="space-y-3">
          <button onClick={() => navigate("/organizer/register")} className="w-full px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2">
            <FilePlus2 size={16} /> Register as organizer
          </button>
          <button onClick={() => navigate("/organizer/login")} className="w-full px-8 py-3.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2">
            <LogIn size={16} /> Organizer login
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-5">
          New organisers must be approved by an admin before accessing the dashboard.
        </p>
      </div>
    </div>
  );
}
