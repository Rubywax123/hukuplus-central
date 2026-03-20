import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface KioskAgreement {
  id: number;
  customerName: string;
  loanAmount: number;
  loanProduct: string;
  branchName: string;
  retailerName: string;
  signingUrl: string;
  createdAt: string;
}

interface KioskData {
  branch: { id: number; name: string; retailerName: string } | null;
  agreement: KioskAgreement | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function KioskPage({ branchId }: { branchId: string }) {
  const [data, setData] = useState<KioskData | null>(null);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());
  const [pulse, setPulse] = useState(false);

  const fetchData = async () => {
    try {
      const res = await fetch(`${BASE}/api/kiosk/${branchId}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setPulse(true);
        setTimeout(() => setPulse(false), 600);
      }
    } catch {}
    setLastChecked(new Date());
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [branchId]);

  const signingFullUrl = data?.agreement?.signingUrl
    ? `${window.location.origin}${BASE}/sign/${data.agreement.signingUrl}`
    : null;

  // If the signing URL is already absolute, use it directly
  const finalUrl = data?.agreement?.signingUrl?.startsWith("http")
    ? data.agreement.signingUrl
    : signingFullUrl;

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-white/40 text-lg animate-pulse">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex flex-col items-center justify-center p-6 font-sans">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="text-white/40 text-sm uppercase tracking-widest mb-2">
          {data.branch?.retailerName ?? "Novafeeds"} — {data.branch?.name ?? `Branch ${branchId}`}
        </div>
        <h1 className="text-white text-3xl font-bold">Loan Agreement Signing</h1>
      </div>

      {data.agreement && finalUrl ? (
        <div className={`w-full max-w-lg transition-all duration-300 ${pulse ? "scale-[1.01]" : "scale-100"}`}>
          {/* Customer card */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 text-center">
            <p className="text-white/50 text-xs uppercase tracking-wider mb-1">Customer</p>
            <p className="text-white text-2xl font-bold mb-4">{data.agreement.customerName}</p>
            <div className="flex justify-center gap-8 text-sm">
              <div>
                <p className="text-white/40 text-xs">Product</p>
                <p className="text-white font-semibold">{data.agreement.loanProduct}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs">Amount</p>
                <p className="text-white font-semibold">
                  USD {Number(data.agreement.loanAmount).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* QR Code */}
          <div className="bg-white rounded-2xl p-6 flex flex-col items-center mb-6">
            <QRCodeSVG
              value={finalUrl}
              size={220}
              bgColor="#ffffff"
              fgColor="#0a0e1a"
              level="M"
            />
            <p className="text-[#0a0e1a]/50 text-xs mt-4 text-center">
              Scan QR code or click the button below to sign
            </p>
          </div>

          {/* Sign button */}
          <a
            href={finalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center py-4 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold text-lg hover:opacity-90 transition-opacity"
          >
            Open Signing Link →
          </a>

          <p className="text-white/20 text-xs text-center mt-4">
            Agreement #{data.agreement.id} · Created {new Date(data.agreement.createdAt).toLocaleString()}
          </p>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center max-w-md w-full">
          <div className="text-6xl mb-4">📋</div>
          <h2 className="text-white text-xl font-bold mb-2">No Pending Agreements</h2>
          <p className="text-white/40 text-sm">
            This screen will automatically update when a new loan agreement is submitted.
          </p>
        </div>
      )}

      {/* Status bar */}
      <div className="fixed bottom-4 right-4 flex items-center gap-2 text-white/20 text-xs">
        <span className={`w-2 h-2 rounded-full ${pulse ? "bg-green-400" : "bg-white/20"} transition-colors`} />
        Refreshes every 30s · Last: {lastChecked.toLocaleTimeString()}
      </div>
    </div>
  );
}
