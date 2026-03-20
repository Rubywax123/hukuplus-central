import React, { useEffect, useState } from "react";
import { format } from "date-fns";
import { Printer, ExternalLink, ArrowLeft, CheckCircle, AlertCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function formatAmount(n: number) {
  return `USD ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface ExecutionData {
  id: number;
  customerName: string;
  loanProduct: string;
  loanAmount: number;
  status: string;
  signedAt: string | null;
  createdAt: string;
  formitizeJobId: string | null;
  formitizeFormUrl: string | null;
  retailerName: string;
  branchName: string;
  signatures: {
    customer1: string | null;
    customer2: string | null;
    customer3: string | null;
    manager: string | null;
  };
}

function SigBox({ label, sublabel, data }: { label: string; sublabel: string; data: string | null }) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden print:border-gray-300">
      <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200 print:bg-gray-100">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</p>
        <p className="text-xs text-gray-400">{sublabel}</p>
      </div>
      <div className="h-28 flex items-center justify-center bg-white">
        {data ? (
          <img src={data} alt={label} className="max-h-full max-w-full object-contain p-2" />
        ) : (
          <p className="text-xs text-gray-300 italic">Not yet signed</p>
        )}
      </div>
    </div>
  );
}

export default function ExecutionCertificatePage({ agreementId }: { agreementId: string }) {
  const [data, setData] = useState<ExecutionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/agreements/${agreementId}/execution`, { credentials: "include" })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `Error ${r.status}`);
        }
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [agreementId]);

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error || !data) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
        <p className="text-white/60">{error || "Agreement not found"}</p>
        <button onClick={() => history.back()} className="mt-4 text-sm text-primary hover:underline">← Go back</button>
      </div>
    </div>
  );

  const allSigned = data.signatures.customer1 && data.signatures.customer2 && data.signatures.customer3 && data.signatures.manager;

  return (
    <div className="min-h-screen bg-background print:bg-white">
      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; }
          body, html { background: white !important; color: black !important; }
          .print-cert { background: white !important; color: black !important; }
          .print-cert * { color: inherit !important; }
          .print-cert h1, .print-cert h2, .print-cert p, .print-cert span, .print-cert a {
            color: black !important;
          }
          .print-cert .text-gray-400, .print-cert .text-gray-500 { color: #6b7280 !important; }
          .print-cert .text-gray-900 { color: #111827 !important; }
          .print-cert .text-emerald-600 { color: #059669 !important; }
          .print-cert .text-amber-600 { color: #d97706 !important; }
          .print-cert .border-gray-200, .print-cert .border-gray-300 { border-color: #e5e7eb !important; }
          .print-cert .bg-gray-50 { background: #f9fafb !important; }
          .print-cert .bg-white { background: white !important; }
        }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="print:hidden bg-card/50 border-b border-white/10 px-6 py-3 flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm">
        <button onClick={() => history.back()} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Agreements
        </button>
        <div className="flex items-center gap-3">
          {data.formitizeFormUrl && (
            <a
              href={data.formitizeFormUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white hover:bg-white/10 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> View Formitize PDF
            </a>
          )}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
          >
            <Printer className="w-4 h-4" /> Print / Save PDF
          </button>
        </div>
      </div>

      {/* Certificate — white page, works for screen & print */}
      <div className="print-cert max-w-3xl mx-auto p-8 print:p-6 print:max-w-none bg-white">

        {/* Header */}
        <div className="flex items-start justify-between mb-8 pb-6 border-b border-gray-200 print:border-gray-300">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 print:text-black">Loan Agreement Execution Certificate</h1>
            <p className="text-sm text-gray-500 mt-1">Tefco Finance (Pvt) Ltd — HukuPlus Central</p>
          </div>
          <div className="text-right">
            {allSigned ? (
              <div className="flex items-center gap-1.5 text-emerald-600 font-semibold text-sm">
                <CheckCircle className="w-4 h-4" /> Fully Executed
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-amber-600 font-semibold text-sm">
                <AlertCircle className="w-4 h-4" /> Partially Signed
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1">Agreement #{data.id}</p>
          </div>
        </div>

        {/* Agreement details */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Customer</p>
            <p className="text-lg font-bold text-gray-900 print:text-black">{data.customerName}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Retailer / Branch</p>
            <p className="text-base font-semibold text-gray-900 print:text-black">{data.retailerName}</p>
            <p className="text-sm text-gray-500">{data.branchName}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Loan Product</p>
            <p className="text-base font-semibold text-gray-900 print:text-black">{data.loanProduct}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Loan Amount</p>
            <p className="text-base font-semibold text-gray-900 print:text-black">{formatAmount(data.loanAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Agreement Issued</p>
            <p className="text-sm text-gray-700">{format(new Date(data.createdAt), "d MMMM yyyy, h:mm a")}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Executed On</p>
            <p className="text-sm text-gray-700">
              {data.signedAt ? format(new Date(data.signedAt), "d MMMM yyyy, h:mm a") : "—"}
            </p>
          </div>
          {data.formitizeJobId && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Formitize Job ID</p>
              <p className="text-sm font-mono text-gray-700">#{data.formitizeJobId}</p>
            </div>
          )}
          {data.formitizeFormUrl && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Source Document</p>
              <a href={data.formitizeFormUrl} target="_blank" rel="noreferrer"
                className="text-sm text-blue-600 underline underline-offset-2 hover:text-blue-700 print:text-blue-700">
                View Formitize PDF ↗
              </a>
            </div>
          )}
        </div>

        {/* Signatures */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Signatures</h2>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <SigBox
              label="Customer Signature 1 of 3"
              sublabel="Acknowledgement of loan agreement terms"
              data={data.signatures.customer1}
            />
            <SigBox
              label="Customer Signature 2 of 3"
              sublabel="Confirmation of repayment schedule"
              data={data.signatures.customer2}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SigBox
              label="Customer Signature 3 of 3"
              sublabel="Final authorization"
              data={data.signatures.customer3}
            />
            <SigBox
              label="Store Manager Signature"
              sublabel="Authorized store representative — Counter-signature"
              data={data.signatures.manager}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 print:border-gray-300 pt-6 text-xs text-gray-400 text-center">
          <p>This execution certificate was generated by HukuPlus Central · Tefco Finance (Pvt) Ltd</p>
          <p className="mt-1">Generated {format(new Date(), "d MMMM yyyy, h:mm a")}</p>
        </div>
      </div>
    </div>
  );
}
