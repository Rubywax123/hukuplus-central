import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Leaf, UserX, Eye, EyeOff, Loader2, X, Store, User, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

interface Agronomist {
  id: number;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  retailer_id: number;
  retailer_name: string | null;
  branch_id: number | null;
  branch_name: string | null;
  created_at: string;
}

interface Retailer {
  id: number;
  name: string;
}

interface Branch {
  id: number;
  name: string;
  retailer_id: number;
}

export default function AgronomistsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", retailerId: "", branchId: "" });
  const [formError, setFormError] = useState("");
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);

  const { data: agronomists = [], isLoading } = useQuery<Agronomist[]>({
    queryKey: ["/api/portal/agronomists"],
    queryFn: () => apiFetch("/api/portal/agronomists"),
  });

  const { data: retailers = [] } = useQuery<Retailer[]>({
    queryKey: ["/api/retailers"],
    queryFn: () => apiFetch("/api/retailers"),
  });

  const { data: filteredBranches = [] } = useQuery<Branch[]>({
    queryKey: ["/api/retailers", form.retailerId, "branches"],
    queryFn: () => apiFetch(`/api/retailers/${form.retailerId}/branches`),
    enabled: !!form.retailerId,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiFetch("/api/portal/agronomists", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/portal/agronomists"] });
      setShowCreate(false);
      setForm({ name: "", email: "", password: "", retailerId: "", branchId: "" });
      setFormError("");
    },
    onError: (err: any) => setFormError(err.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/portal/agronomists/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/portal/agronomists"] });
      setDeactivatingId(null);
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/portal/agronomists/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/portal/agronomists"] }),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!form.name || !form.email || !form.password || !form.retailerId) {
      setFormError("Name, email, password and retailer are required");
      return;
    }
    createMutation.mutate({
      name: form.name,
      email: form.email,
      password: form.password,
      retailerId: form.retailerId,
      branchId: form.branchId || undefined,
    });
  };

  const activeCount = agronomists.filter(a => a.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Agronomist Accounts</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeCount} active · {agronomists.length} total — agronomists can only submit leads
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setFormError(""); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-semibold transition-colors"
        >
          <Plus className="w-4 h-4" />Add Agronomist
        </button>
      </div>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="w-full max-w-md bg-card border border-white/10 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Leaf className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-bold text-white">New Agronomist</h3>
                </div>
                <button onClick={() => setShowCreate(false)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Full Name</label>
                  <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                    required placeholder="e.g. John Banda"
                    className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    required placeholder="agronomist@example.com"
                    className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Temporary Password</label>
                  <div className="relative">
                    <input type={showPass ? "text" : "password"} value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      required placeholder="Min 6 characters"
                      className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors" />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors">
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">The agronomist will be prompted to change this on first login.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Retailer *</label>
                  <select value={form.retailerId}
                    onChange={e => setForm({ ...form, retailerId: e.target.value, branchId: "" })}
                    required
                    className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors">
                    <option value="">Select retailer...</option>
                    {retailers.map((r: Retailer) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>

                {filteredBranches.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-white mb-1.5">Branch (optional)</label>
                    <select value={form.branchId} onChange={e => setForm({ ...form, branchId: e.target.value })}
                      className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors">
                      <option value="">All branches</option>
                      {filteredBranches.map((b: Branch) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {formError && (
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                    {formError}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setShowCreate(false)}
                    className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-muted-foreground hover:text-white transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={createMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                    {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create Account
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground animate-pulse">Loading agronomists...</div>
      ) : agronomists.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-center">
          <Leaf className="w-10 h-10 mb-3 opacity-20 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No agronomist accounts yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">Click "Add Agronomist" to create the first one</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agronomists.map((ag, i) => (
            <motion.div key={ag.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className={cn(
                "bg-card/40 backdrop-blur-sm border rounded-2xl p-5",
                ag.is_active ? "border-white/10" : "border-white/5 opacity-60"
              )}
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                    ag.is_active ? "bg-primary/10 border border-primary/20" : "bg-white/5 border border-white/10"
                  )}>
                    <Leaf className={cn("w-5 h-5", ag.is_active ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white text-sm">{ag.name}</p>
                      {!ag.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">Inactive</span>
                      )}
                      {ag.must_change_password && ag.is_active && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">Password not set</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{ag.email}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Store className="w-3 h-3" />{ag.retailer_name ?? `Retailer #${ag.retailer_id}`}
                      </span>
                      {ag.branch_name && <span>· {ag.branch_name}</span>}
                      <span>· Added {format(new Date(ag.created_at), "d MMM yyyy")}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {ag.is_active ? (
                    deactivatingId === ag.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Deactivate?</span>
                        <button
                          onClick={() => deactivateMutation.mutate(ag.id)}
                          disabled={deactivateMutation.isPending}
                          className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium transition-colors"
                        >
                          Confirm
                        </button>
                        <button onClick={() => setDeactivatingId(null)}
                          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-muted-foreground transition-colors">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeactivatingId(ag.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 border border-white/10 text-xs text-muted-foreground transition-colors"
                      >
                        <UserX className="w-3.5 h-3.5" /> Deactivate
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => reactivateMutation.mutate(ag.id)}
                      disabled={reactivateMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Reactivate
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
