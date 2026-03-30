import React, { useState, useEffect } from "react";
import { Zap, ChevronRight, CheckCircle, AlertCircle, ArrowLeft, Store } from "lucide-react";
import { cn } from "@/lib/utils";

const API = import.meta.env.VITE_API_URL ?? "";

interface StoreRow { id: number; name: string; branch_id: number; branch_name: string; }
interface Customer { id: number; name: string; phone: string; retailerId: number; retailerName: string; branchId: number; branchName: string; }
interface Agreement { id: number; facilityLimit: number; facilityBalance: number; retailerId: number; retailerName: string; branchId: number; branchName: string; }

type Step = "verify" | "form" | "success";

export default function ApplyRevolverPage() {
  const [step, setStep] = useState<Step>("verify");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requestId, setRequestId] = useState<number | null>(null);

  // Verify step
  const [vName, setVName] = useState("");
  const [vPhone, setVPhone] = useState("");

  // Form step
  const [amount, setAmount] = useState("");
  const [collectionRetailerId, setCollectionRetailerId] = useState("");
  const [collectionBranchId, setCollectionBranchId] = useState("");

  useEffect(() => {
    fetch(`${API}/api/applications/retailers`)
      .then(r => r.json())
      .then(setStores)
      .catch(() => {});
  }, []);

  const amountNum = parseFloat(amount) || 0;
  const exceedsBalance = amountNum > (agreement?.facilityBalance || 0) && (agreement?.facilityBalance || 0) > 0;
  const invalidAmount = amountNum <= 0;

  const storeGroups = stores.reduce<Record<string, StoreRow[]>>((acc, s) => {
    const key = `${s.id}|${s.name}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const r = await fetch(`${API}/api/applications/customer-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: vName, phone: vPhone, product: "Revolver" }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Verification failed"); return; }
      setCustomer(data.customer);
      setAgreement(data.agreement);
      setCollectionRetailerId(String(data.agreement.retailerId || ""));
      setCollectionBranchId(String(data.agreement.branchId || ""));
      setStep("form");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (exceedsBalance || invalidAmount) return;
    setError("");
    setSubmitting(true);
    try {
      const body = {
        customerId: customer?.id,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        agreementId: agreement?.id,
        retailerId: agreement?.retailerId,
        branchId: agreement?.branchId,
        collectionRetailerId: collectionRetailerId ? parseInt(collectionRetailerId) : agreement?.retailerId,
        collectionBranchId: collectionBranchId ? parseInt(collectionBranchId) : agreement?.branchId,
        amountRequested: amountNum,
        facilityLimit: agreement?.facilityLimit,
        facilityBalance: agreement?.facilityBalance,
      };
      const r = await fetch(`${API}/api/applications/drawdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Submission failed"); return; }
      setRequestId(data.id);
      setStep("success");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Zap className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Revolver</h1>
            <p className="text-sm text-muted-foreground">Feed Credit Drawdown Request</p>
          </div>
        </div>

        {/* Step: Verify */}
        {step === "verify" && (
          <div className="bg-card border border-white/10 rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-white">Verify Your Account</h2>
              <p className="text-sm text-muted-foreground mt-1">Enter your name and phone number as registered on your Revolver facility.</p>
            </div>

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Full Name</label>
                <input
                  required value={vName} onChange={e => setVName(e.target.value)}
                  placeholder="e.g. Tendai Moyo"
                  className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Phone Number</label>
                <input
                  required value={vPhone} onChange={e => setVPhone(e.target.value)}
                  placeholder="e.g. 0771234567"
                  className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
              )}
              <button
                type="submit" disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors disabled:opacity-50"
              >
                {submitting ? "Verifying..." : "Continue"} <ChevronRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* Step: Form */}
        {step === "form" && customer && agreement && (
          <div className="bg-card border border-white/10 rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep("verify")} className="text-muted-foreground hover:text-white transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-lg font-semibold text-white">Drawdown Request</h2>
                <p className="text-sm text-muted-foreground">{customer.name}</p>
              </div>
            </div>

            {/* Facility Summary */}
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Facility Limit</p>
                <p className="text-lg font-bold text-white">${agreement.facilityLimit.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Available Balance</p>
                <p className={cn("text-lg font-bold", agreement.facilityBalance <= 0 ? "text-red-400" : "text-emerald-400")}>
                  ${agreement.facilityBalance.toFixed(2)}
                </p>
              </div>
            </div>

            {agreement.facilityBalance <= 0 ? (
              <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Your facility has no available balance at this time.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Amount */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Drawdown Amount (USD)</label>
                  <input
                    required type="number" min="1" step="0.01"
                    max={agreement.facilityBalance}
                    value={amount} onChange={e => setAmount(e.target.value)}
                    placeholder={`Up to $${agreement.facilityBalance.toFixed(2)}`}
                    className={cn(
                      "w-full rounded-xl border bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2",
                      exceedsBalance ? "border-red-500/50 focus:ring-red-500" : "border-white/10 focus:ring-blue-500"
                    )}
                  />
                  {exceedsBalance && (
                    <p className="text-xs text-red-400 mt-1">Cannot exceed available balance of ${agreement.facilityBalance.toFixed(2)}</p>
                  )}
                </div>

                {/* Collection Store */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                    <Store className="w-3 h-3 inline mr-1" />Collection Store
                  </label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Default: {agreement.retailerName}{agreement.branchName ? ` — ${agreement.branchName}` : ""}. Select a different store if needed.
                  </p>
                  <select
                    value={`${collectionRetailerId}|${collectionBranchId}`}
                    onChange={e => {
                      const [rid, bid] = e.target.value.split("|");
                      setCollectionRetailerId(rid);
                      setCollectionBranchId(bid);
                    }}
                    className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.entries(storeGroups).map(([key, branches]) => {
                      const [rid, rname] = key.split("|");
                      return branches.map(b => (
                        <option key={`${rid}|${b.branch_id}`} value={`${rid}|${b.branch_id}`}>
                          {rname} — {b.branch_name}
                        </option>
                      ));
                    })}
                  </select>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                    <AlertCircle className="w-4 h-4 shrink-0" />{error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || exceedsBalance || invalidAmount}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {submitting ? "Submitting..." : "Request Drawdown"} <ChevronRight className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        )}

        {/* Step: Success */}
        {step === "success" && (
          <div className="bg-card border border-white/10 rounded-2xl p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Drawdown Request Submitted</h2>
            <p className="text-muted-foreground text-sm">
              Your drawdown request (#{requestId}) has been submitted. The store will be notified
              and will prepare your feed credit shortly.
            </p>
            <p className="text-xs text-muted-foreground">Reference: RVD-{requestId?.toString().padStart(5, "0")}</p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          Tefco Finance (Pvt) Ltd &mdash; Revolver Layer Feed Facility
        </p>
      </div>
    </div>
  );
}
