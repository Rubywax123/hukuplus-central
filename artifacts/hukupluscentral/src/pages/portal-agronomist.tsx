import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut, Leaf, Send, CheckCircle2, Clock, RefreshCw, User, Phone, Egg, FileText, Loader2, ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

interface AgronomistUser {
  portalUserId: number;
  name: string;
  email: string;
  role: string;
  retailerId: number;
  retailerName: string;
  branchId: number | null;
  mustChangePassword?: boolean;
}

interface MyLead {
  id: number;
  customer_name: string;
  phone: string;
  retailer_name: string | null;
  branch_name: string | null;
  flock_size: number;
  estimated_value: number;
  status: string;
  notes: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  new:         { label: "New",         color: "text-amber-400",   bg: "bg-amber-400/10 border-amber-400/20" },
  acknowledged: { label: "In Review",  color: "text-blue-400",    bg: "bg-blue-400/10 border-blue-400/20" },
  converted:   { label: "Converted",   color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/20" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.new;
  return (
    <span className={cn("inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border", cfg.color, cfg.bg)}>
      {cfg.label}
    </span>
  );
}

function cleanPhone(raw: string): string {
  let v = raw.replace(/\D/g, "");
  if (v.startsWith("263")) v = v.slice(3);
  if (v.startsWith("0")) v = v.slice(1);
  return "+263" + v;
}

export default function PortalAgronomistPage() {
  const [, setLocation] = useLocation();
  const [me, setMe] = useState<AgronomistUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ customerName: "", phone: "", flockSize: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [changingPass, setChangingPass] = useState(false);
  const [passForm, setPassForm] = useState({ current: "", newPass: "", confirm: "" });
  const [passError, setPassError] = useState("");
  const [passLoading, setPassLoading] = useState(false);

  useEffect(() => {
    fetch("/api/portal/me").then(async r => {
      if (!r.ok) { setLocation("/portal/login"); return; }
      const data = await r.json();
      if (data.role !== "agronomist") { setLocation("/portal/login"); return; }
      setMe(data);
      if (data.mustChangePassword) setChangingPass(true);
      setAuthLoading(false);
    }).catch(() => setLocation("/portal/login"));
  }, []);

  const { data: myLeads = [], isLoading: leadsLoading, refetch } = useQuery<MyLead[]>({
    queryKey: ["agronomist-leads"],
    queryFn: async () => {
      const res = await fetch("/api/portal/agronomist/leads");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!me,
    refetchInterval: 60000,
  });

  const handleLogout = async () => {
    await fetch("/api/portal/logout", { method: "POST" });
    setLocation("/portal/login");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");
    setSubmitting(true);

    const phone = cleanPhone(form.phone);
    if (phone.length < 10) {
      setSubmitError("Please enter a valid phone number");
      setSubmitting(false);
      return;
    }

    const flockSizeNum = Math.round(parseFloat(form.flockSize) || 0);

    const body = new URLSearchParams({
      customerName: form.customerName.trim(),
      phone,
      flockSize: String(flockSizeNum),
      notes: form.notes.trim(),
    });

    try {
      const res = await fetch(window.location.origin + "/api/leads", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSubmitError(d.error || "Submission failed. Please try again.");
        return;
      }

      setForm({ customerName: "", phone: "", flockSize: "", notes: "" });
      setShowForm(false);
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 4000);
      qc.invalidateQueries({ queryKey: ["agronomist-leads"] });
      refetch();
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError("");
    if (passForm.newPass !== passForm.confirm) { setPassError("Passwords do not match"); return; }
    if (passForm.newPass.length < 6) { setPassError("Password must be at least 6 characters"); return; }
    setPassLoading(true);
    const res = await fetch("/api/portal/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: passForm.current, newPassword: passForm.newPass }),
    });
    setPassLoading(false);
    if (res.ok) {
      setChangingPass(false);
      if (me) setMe({ ...me, mustChangePassword: false });
    } else {
      const d = await res.json();
      setPassError(d.error || "Failed to change password");
    }
  };

  if (authLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!me) return null;

  if (changingPass) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Leaf className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-white">Set Your Password</h2>
          <p className="text-sm text-muted-foreground mt-1">Please set a new password before continuing.</p>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-4">
          {(["current", "newPass", "confirm"] as const).map((field, i) => (
            <div key={field}>
              <label className="block text-sm font-medium mb-1.5 text-white">
                {i === 0 ? "Temporary Password" : i === 1 ? "New Password" : "Confirm New Password"}
              </label>
              <input type="password" value={passForm[field]}
                onChange={e => setPassForm({ ...passForm, [field]: e.target.value })}
                required className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
          ))}
          {passError && <p className="text-sm text-destructive">{passError}</p>}
          <button type="submit" disabled={passLoading}
            className="w-full bg-primary text-primary-foreground font-semibold py-3 rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {passLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            Set Password & Continue
          </button>
        </form>
      </motion.div>
    </div>
  );

  const totalLeads = myLeads.length;
  const convertedLeads = myLeads.filter(l => l.status === "converted").length;
  const activeLeads = myLeads.filter(l => l.status !== "converted").length;

  return (
    <div className="min-h-screen bg-background">
      <div className="absolute top-0 left-1/3 w-96 h-96 bg-primary/5 blur-[120px] rounded-full pointer-events-none" />

      {/* Header */}
      <header className="border-b border-white/5 bg-card/30 backdrop-blur-xl px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Leaf className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white text-sm">Tefco Finance</h1>
            <p className="text-xs text-muted-foreground">Agronomist Portal</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-white">{me.name}</p>
              <p className="text-xs text-muted-foreground">{me.retailerName}</p>
            </div>
          </div>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-white/5 hover:bg-destructive/20 hover:text-destructive border border-white/10 text-muted-foreground transition-colors">
            <LogOut className="w-3.5 h-3.5" />Sign Out
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-4 pb-12">
        {/* Welcome */}
        <div className="mt-6 mb-6">
          <h2 className="text-2xl font-bold text-white">Welcome, {me.name.split(" ")[0]}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{me.retailerName}</p>
        </div>

        {/* Success toast */}
        <AnimatePresence>
          {submitSuccess && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="mb-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <p className="text-sm text-emerald-300 font-medium">Lead submitted successfully! Our team will follow up.</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "Total Leads", value: totalLeads, color: "text-primary" },
            { label: "Active", value: activeLeads, color: "text-amber-400" },
            { label: "Converted", value: convertedLeads, color: "text-emerald-400" },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="bg-card/40 backdrop-blur-sm border border-white/10 rounded-2xl p-4 text-center">
              <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Submit Lead Button / Form */}
        <div className="mb-6">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-primary hover:bg-primary/90 text-white font-semibold text-base transition-colors shadow-lg shadow-primary/20"
            >
              <Send className="w-5 h-5" />
              Submit a New Lead
            </button>
          ) : (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-white">New Lead</h3>
                <button onClick={() => { setShowForm(false); setSubmitError(""); }}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Locked retailer info */}
              <div className="mb-5 p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2">
                <Leaf className="w-4 h-4 text-primary shrink-0" />
                <div className="text-xs text-muted-foreground">
                  <span className="text-white font-medium">{me.retailerName}</span>
                  {" — your retailer is automatically attached to this lead"}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Customer Name *</label>
                  <input
                    type="text"
                    value={form.customerName}
                    onChange={e => setForm({ ...form, customerName: e.target.value })}
                    required
                    placeholder="Full name"
                    className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Phone Number *</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    required
                    placeholder="0771234567"
                    className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Flock Size (number of birds)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={form.flockSize}
                    onChange={e => setForm({ ...form, flockSize: e.target.value })}
                    placeholder="e.g. 500"
                    className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                  />
                  {form.flockSize && parseFloat(form.flockSize) > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Est. value: <span className="text-primary font-medium">${(Math.round(parseFloat(form.flockSize)) * 2.06).toFixed(2)}</span>
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Notes (optional)</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    placeholder="Any additional details..."
                    rows={3}
                    className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors resize-none"
                  />
                </div>

                {submitError && (
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                    {submitError}
                  </div>
                )}

                <div className="flex gap-3">
                  <button type="button" onClick={() => { setShowForm(false); setSubmitError(""); }}
                    className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-muted-foreground hover:text-white transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary hover:bg-primary/90 text-white font-semibold text-sm transition-colors disabled:opacity-50">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {submitting ? "Submitting..." : "Submit Lead"}
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </div>

        {/* Lead History */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-white">My Submitted Leads</h3>
            <button onClick={() => refetch()} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {leadsLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground animate-pulse text-sm">
              Loading your leads...
            </div>
          ) : myLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <FileText className="w-8 h-8 mb-2 opacity-20 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No leads submitted yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">Use the button above to submit your first lead</p>
            </div>
          ) : (
            <div className="space-y-3">
              {myLeads.map((lead, i) => (
                <motion.div key={lead.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="bg-card/40 backdrop-blur-sm border border-white/10 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-semibold text-white text-sm truncate">{lead.customer_name}</h4>
                        <StatusBadge status={lead.status} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</span>
                        {lead.flock_size > 0 && (
                          <span className="flex items-center gap-1">
                            <Egg className="w-3 h-3" />{lead.flock_size.toLocaleString()} birds
                            <span className="text-primary/70">· ${Number(lead.estimated_value).toFixed(2)}</span>
                          </span>
                        )}
                      </div>
                      {lead.notes && (
                        <p className="text-xs text-white/40 mt-1 line-clamp-1">{lead.notes}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
