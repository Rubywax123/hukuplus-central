import React, { useEffect, useState } from "react";

interface KioskAgreement {
  id: number;
  customerName: string;
  loanAmount: number;
  loanProduct: string;
  signingUrl: string;
  createdAt: string;
}

interface KioskData {
  branch: { id: number; name: string; retailerName: string } | null;
  agreement: KioskAgreement | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function formatAmount(n: number) {
  return `USD ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function KioskPage({ branchId }: { branchId: string }) {
  const [data, setData] = useState<KioskData | null>(null);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch(`${BASE}/api/kiosk/${branchId}`);
      if (res.ok) setData(await res.json());
    } catch {}
    setLastChecked(new Date());
    if (manual) setTimeout(() => setRefreshing(false), 800);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), 30_000);
    return () => clearInterval(interval);
  }, [branchId]);

  // Build the full signing URL, appending a ?return= so after signing
  // the customer can tap "Return to Store Screen" back to this kiosk.
  const buildSignUrl = (): string | null => {
    if (!data?.agreement) return null;
    const raw = data.agreement.signingUrl;
    const returnPath = encodeURIComponent(`/kiosk/${branchId}`);
    if (raw.startsWith("http")) return `${raw}?return=${returnPath}`;
    // Relative path — make absolute
    const origin = window.location.origin;
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    return `${origin}${BASE}${path}?return=${returnPath}`;
  };

  const signUrl = buildSignUrl();
  const { branch, agreement } = data ?? { branch: null, agreement: null };

  if (!data) {
    return (
      <div className="min-h-screen bg-[#04080f] flex items-center justify-center">
        <p className="text-white/20 text-lg tracking-widest animate-pulse">LOADING…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#04080f] flex flex-col" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <div>
            <p className="text-white/30 text-xs tracking-widest uppercase">HukuPlus Central</p>
            <p className="text-white font-semibold leading-tight">
              {branch?.retailerName ?? "Novafeeds"} · {branch?.name ?? `Branch ${branchId}`}
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchData(true)}
          className={`text-xs text-white/25 hover:text-white/50 border border-white/10 hover:border-white/25 rounded-lg px-3 py-1.5 transition-all ${refreshing ? "animate-pulse" : ""}`}
        >
          {refreshing ? "Checking…" : "↻ Refresh now"}
        </button>
      </div>

      {/* ── Main body ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center px-6 py-10">

        {!agreement ? (
          /* ── IDLE: no pending agreements ────────────────────────────────── */
          <div className="text-center max-w-sm">
            <div className="w-20 h-20 rounded-full border border-white/[0.06] flex items-center justify-center mx-auto mb-8">
              <svg className="w-9 h-9 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h2 className="text-white/30 text-xl font-light mb-2">No pending agreements</h2>
            <p className="text-white/15 text-sm">
              This screen updates automatically when a loan agreement is ready to sign.
            </p>
          </div>

        ) : (
          /* ── ACTIVE: agreement awaiting signature ─────────────────────── */
          <div className="w-full max-w-md">

            {/* Pulse badge */}
            <div className="flex justify-center mb-8">
              <div className="flex items-center gap-2 px-5 py-2 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-sm font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Agreement ready — signature required
              </div>
            </div>

            {/* Customer card */}
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-8 mb-6 text-center">
              <p className="text-white/30 text-xs tracking-widest uppercase mb-3">{agreement.loanProduct} Loan Agreement</p>
              <h1 className="text-4xl font-bold text-white leading-tight mb-2">{agreement.customerName}</h1>
              <p className="text-white/40 text-2xl font-light mb-8">{formatAmount(agreement.loanAmount)}</p>

              <p className="text-white/25 text-sm mb-6">
                Please review the agreement on the next screen and sign using your finger or stylus.
              </p>

              {signUrl ? (
                <a
                  href={signUrl}
                  className="block w-full py-6 rounded-2xl text-white text-2xl font-bold text-center transition-all active:scale-95"
                  style={{
                    background: "linear-gradient(135deg, #5b21b6 0%, #7c3aed 50%, #9333ea 100%)",
                    boxShadow: "0 0 60px rgba(124, 58, 237, 0.35), inset 0 1px 0 rgba(255,255,255,0.1)"
                  }}
                >
                  TAP HERE TO SIGN
                </a>
              ) : (
                <div className="w-full py-6 rounded-2xl bg-white/5 text-white/20 text-xl text-center">
                  Signing link unavailable
                </div>
              )}
            </div>

            <p className="text-center text-white/10 text-xs">
              Agreement #{agreement.id} · Auto-refreshes every 30 seconds · Last checked {lastChecked.toLocaleTimeString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
