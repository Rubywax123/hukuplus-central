import React, { useState, useEffect } from "react";
import { format, addDays, parseISO, differenceInDays } from "date-fns";
import { Egg, ChevronRight, CheckCircle, AlertCircle, ArrowLeft, Store } from "lucide-react";
import { cn } from "@/lib/utils";

const API = import.meta.env.VITE_API_URL ?? "";

interface Store { id: number; name: string; branch_id: number; branch_name: string; }
interface Customer { id: number; name: string; phone: string; retailerId: number; retailerName: string; branchId: number; branchName: string; }

type Step = "verify" | "form" | "success";

export default function ApplyHukuPlusPage() {
  const [step, setStep] = useState<Step>("verify");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [appId, setAppId] = useState<number | null>(null);

  // Verify step
  const [vName, setVName] = useState("");
  const [vPhone, setVPhone] = useState("");

  // Form step
  const [chickCount, setChickCount] = useState("");
  const [chickDate, setChickDate] = useState("");
  const [collectionDate, setCollectionDate] = useState("");
  const [amount, setAmount] = useState("");
  const [collectionRetailerId, setCollectionRetailerId] = useState("");
  const [collectionBranchId, setCollectionBranchId] = useState("");

  useEffect(() => {
    fetch(`${API}/api/applications/retailers`)
      .then(r => r.json())
      .then(setStores)
      .catch(() => {});
  }, []);

  // Auto-set collection date when chick date changes
  useEffect(() => {
    if (chickDate) {
      const minDate = addDays(parseISO(chickDate), 12);
      setCollectionDate(format(minDate, "yyyy-MM-dd"));
    }
  }, [chickDate]);

  const amountLimit = chickCount ? parseFloat((parseInt(chickCount) * 2.06).toFixed(2)) : 0;
  const amountNum = parseFloat(amount) || 0;
  const exceedsLimit = amountNum > amountLimit && amountLimit > 0;

  const collectionDaysDiff = chickDate && collectionDate
    ? differenceInDays(parseISO(collectionDate), parseISO(chickDate))
    : 0;
  const tooEarly = collectionDaysDiff < 12 && collectionDate && chickDate;

  // Group stores by retailer
  const storeGroups = stores.reduce<Record<string, Store[]>>((acc, s) => {
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
        body: JSON.stringify({ name: vName, phone: vPhone, product: "HukuPlus" }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Verification failed"); return; }
      setCustomer(data.customer);
      setCollectionRetailerId(String(data.customer.retailerId || ""));
      setCollectionBranchId(String(data.customer.branchId || ""));
      setStep("form");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (exceedsLimit) return;
    if (tooEarly) return;
    setError("");
    setSubmitting(true);
    try {
      const body = {
        customerId: customer?.id,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        retailerId: customer?.retailerId,
        branchId: customer?.branchId,
        collectionRetailerId: collectionRetailerId ? parseInt(collectionRetailerId) : customer?.retailerId,
        collectionBranchId: collectionBranchId ? parseInt(collectionBranchId) : customer?.branchId,
        chickCount: parseInt(chickCount),
        chickPurchaseDate: chickDate,
        expectedCollectionDate: collectionDate,
        amountRequested: parseFloat(amount),
      };
      const r = await fetch(`${API}/api/applications/loan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Submission failed"); return; }
      setAppId(data.id);
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
          <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
            <Egg className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">HukuPlus</h1>
            <p className="text-sm text-muted-foreground">Repeat Loan Application</p>
          </div>
        </div>

        {/* Step: Verify */}
        {step === "verify" && (
          <div className="bg-card border border-white/10 rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-white">Verify Your Account</h2>
              <p className="text-sm text-muted-foreground mt-1">Enter your name and phone number as registered with us.</p>
            </div>

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Full Name</label>
                <input
                  required value={vName} onChange={e => setVName(e.target.value)}
                  placeholder="e.g. Tendai Moyo"
                  className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Phone Number</label>
                <input
                  required value={vPhone} onChange={e => setVPhone(e.target.value)}
                  placeholder="e.g. 0771234567"
                  className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 shrink-0" />{error}
                </div>
              )}
              <button
                type="submit" disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition-colors disabled:opacity-50"
              >
                {submitting ? "Verifying..." : "Continue"} <ChevronRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* Step: Form */}
        {step === "form" && customer && (
          <div className="bg-card border border-white/10 rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep("verify")} className="text-muted-foreground hover:text-white transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-lg font-semibold text-white">Loan Application</h2>
                <p className="text-sm text-muted-foreground">{customer.name}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Chick Count */}
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Number of Chicks Purchased</label>
                <input
                  required type="number" min="1" value={chickCount} onChange={e => setChickCount(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                {amountLimit > 0 && (
                  <p className="text-xs text-orange-400 mt-1">Maximum credit limit: ${amountLimit.toFixed(2)}</p>
                )}
              </div>

              {/* Chick Purchase Date */}
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Date of Chick & Starter Purchase</label>
                <input
                  required type="date" value={chickDate} onChange={e => setChickDate(e.target.value)}
                  max={format(new Date(), "yyyy-MM-dd")}
                  className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {/* Expected Collection Date */}
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Expected Stock Collection Date</label>
                <input
                  required type="date" value={collectionDate} onChange={e => setCollectionDate(e.target.value)}
                  min={chickDate ? format(addDays(parseISO(chickDate), 12), "yyyy-MM-dd") : undefined}
                  className={cn(
                    "w-full rounded-xl border bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2",
                    tooEarly ? "border-red-500/50 focus:ring-red-500" : "border-white/10 focus:ring-orange-500"
                  )}
                />
                {tooEarly && (
                  <p className="text-xs text-red-400 mt-1">Must be at least 12 days after chick purchase date</p>
                )}
                {chickDate && collectionDate && !tooEarly && (
                  <p className="text-xs text-muted-foreground mt-1">{collectionDaysDiff} days after purchase</p>
                )}
              </div>

              {/* Amount */}
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Credit Amount Requested (USD)</label>
                <input
                  required type="number" min="1" step="0.01"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  max={amountLimit || undefined}
                  placeholder="e.g. 850.00"
                  className={cn(
                    "w-full rounded-xl border bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2",
                    exceedsLimit ? "border-red-500/50 focus:ring-red-500" : "border-white/10 focus:ring-orange-500"
                  )}
                />
                {exceedsLimit && (
                  <p className="text-xs text-red-400 mt-1">Cannot exceed ${amountLimit.toFixed(2)} for {chickCount} chicks</p>
                )}
              </div>

              {/* Collection Store */}
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                  <Store className="w-3 h-3 inline mr-1" />Collection Store
                </label>
                <p className="text-xs text-muted-foreground mb-2">Default: {customer.retailerName}{customer.branchName ? ` — ${customer.branchName}` : ""}. Select a different store if needed.</p>
                <select
                  value={`${collectionRetailerId}|${collectionBranchId}`}
                  onChange={e => {
                    const [rid, bid] = e.target.value.split("|");
                    setCollectionRetailerId(rid);
                    setCollectionBranchId(bid);
                  }}
                  className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
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
                disabled={submitting || exceedsLimit || !!tooEarly}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition-colors disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "Submit Application"} <ChevronRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* Step: Success */}
        {step === "success" && (
          <div className="bg-card border border-white/10 rounded-2xl p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Application Submitted</h2>
            <p className="text-muted-foreground text-sm">
              Your repeat loan application (#{appId}) has been received and is under review.
              We will contact you shortly.
            </p>
            <p className="text-xs text-muted-foreground">Reference: HKP-{appId?.toString().padStart(5, "0")}</p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          Tefco Finance (Pvt) Ltd &mdash; HukuPlus Broiler Feed Finance
        </p>
      </div>
    </div>
  );
}
