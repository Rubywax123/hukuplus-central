import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { LogOut, FileText, CheckCircle, Clock, AlertCircle, Zap, Search, ChevronDown, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface PortalUser {
  portalUserId: number;
  name: string;
  email: string;
  role: string;
  retailerId: number;
  branchId: number | null;
  mustChangePassword?: boolean;
}

interface Agreement {
  id: number;
  customerName: string;
  customerPhone: string | null;
  loanProduct: string;
  loanAmount: number;
  status: string;
  signedAt: string | null;
  createdAt: string;
  branchName: string | null;
  branchLocation: string | null;
  formitizeJobId: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  pending:  { label: "Pending",  icon: Clock,        color: "text-amber-400",  bg: "bg-amber-400/10 border-amber-400/20" },
  signed:   { label: "Signed",   icon: CheckCircle,  color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/20" },
  expired:  { label: "Expired",  icon: AlertCircle,  color: "text-red-400",     bg: "bg-red-400/10 border-red-400/20" },
  active:   { label: "Active",   icon: CheckCircle,  color: "text-blue-400",    bg: "bg-blue-400/10 border-blue-400/20" },
};

const PRODUCT_COLORS: Record<string, string> = {
  HukuPlus:      "text-orange-400 bg-orange-400/10 border-orange-400/20",
  Revolver:      "text-blue-400 bg-blue-400/10 border-blue-400/20",
  ChikweretiOne: "text-amber-400 bg-amber-400/10 border-amber-400/20",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border", cfg.color, cfg.bg)}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

export default function PortalDashboardPage() {
  const [, setLocation] = useLocation();
  const [me, setMe] = useState<PortalUser | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [changingPass, setChangingPass] = useState(false);
  const [passForm, setPassForm] = useState({ current: "", newPass: "", confirm: "" });
  const [passError, setPassError] = useState("");

  useEffect(() => {
    fetch("/api/portal/me").then(async r => {
      if (!r.ok) { setLocation("/portal/login"); return; }
      const data = await r.json();
      setMe(data);
      if (data.mustChangePassword) setChangingPass(true);
    });
  }, []);

  const { data: agreements = [], isLoading } = useQuery<Agreement[]>({
    queryKey: ["portal-agreements"],
    queryFn: async () => {
      const res = await fetch("/api/portal/agreements");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!me,
  });

  const handleLogout = async () => {
    await fetch("/api/portal/logout", { method: "POST" });
    setLocation("/portal/login");
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError("");
    if (passForm.newPass !== passForm.confirm) { setPassError("Passwords do not match"); return; }
    if (passForm.newPass.length < 6) { setPassError("Password must be at least 6 characters"); return; }
    const res = await fetch("/api/portal/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: passForm.current, newPassword: passForm.newPass }),
    });
    if (res.ok) {
      setChangingPass(false);
      if (me) setMe({ ...me, mustChangePassword: false });
    } else {
      const d = await res.json();
      setPassError(d.error || "Failed to change password");
    }
  };

  const filtered = agreements.filter(a => {
    const matchSearch = !search ||
      a.customerName.toLowerCase().includes(search.toLowerCase()) ||
      (a.branchName || "").toLowerCase().includes(search.toLowerCase()) ||
      (a.formitizeJobId || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: agreements.length,
    signed: agreements.filter(a => a.status === "signed").length,
    pending: agreements.filter(a => a.status === "pending").length,
  };

  if (!me) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (changingPass) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-card/60 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-white">Set Your Password</h2>
          <p className="text-sm text-muted-foreground mt-1">Please set a new password before continuing.</p>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-4">
          {["current", "newPass", "confirm"].map((field, i) => (
            <div key={field}>
              <label className="block text-sm font-medium mb-1.5">
                {i === 0 ? "Current Password" : i === 1 ? "New Password" : "Confirm New Password"}
              </label>
              <input type="password" value={passForm[field as keyof typeof passForm]}
                onChange={e => setPassForm({ ...passForm, [field]: e.target.value })}
                required className="w-full bg-background/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors" />
            </div>
          ))}
          {passError && <p className="text-sm text-destructive">{passError}</p>}
          <button type="submit" className="w-full bg-primary text-primary-foreground font-semibold py-3 rounded-xl hover:bg-primary/90 transition-colors">
            Set Password
          </button>
        </form>
      </motion.div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-white/5 bg-card/30 backdrop-blur-xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white text-sm">Tefco Finance Portal</h1>
            <p className="text-xs text-muted-foreground">
              {me.role === "retailer_admin" ? "All Branches" : "My Branch"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
            <User className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-white">{me.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{me.role.replace("_", " ")}</p>
            </div>
          </div>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-white/5 hover:bg-destructive/20 hover:text-destructive border border-white/10 text-muted-foreground transition-colors">
            <LogOut className="w-3.5 h-3.5" />Sign Out
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6 md:p-8">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Total Agreements", value: stats.total, color: "text-blue-400" },
            { label: "Signed", value: stats.signed, color: "text-emerald-400" },
            { label: "Pending Signature", value: stats.pending, color: "text-amber-400" },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
              className="bg-card/40 backdrop-blur-sm border border-white/10 rounded-2xl p-5">
              <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
              <p className={cn("text-3xl font-bold", s.color)}>{s.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, branch, job ID..."
              className="w-full bg-card/40 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="bg-card/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/40 transition-colors">
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="signed">Signed</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        {/* Agreements Table */}
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground animate-pulse">Loading agreements...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <FileText className="w-10 h-10 mb-3 opacity-30" />
            <p>{agreements.length === 0 ? "No agreements yet." : "No results match your filters."}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((agreement, i) => (
              <motion.div key={agreement.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-card/40 backdrop-blur-sm border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-semibold text-white truncate">{agreement.customerName}</h3>
                      <StatusBadge status={agreement.status} />
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", PRODUCT_COLORS[agreement.loanProduct] || "text-muted-foreground bg-white/5 border-white/10")}>
                        {agreement.loanProduct}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {agreement.branchName && <span>{agreement.branchName}{agreement.branchLocation ? ` · ${agreement.branchLocation}` : ""}</span>}
                      {agreement.customerPhone && <span>{agreement.customerPhone}</span>}
                      {agreement.formitizeJobId && <span className="font-mono">#{agreement.formitizeJobId}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-white">${agreement.loanAmount.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">
                      {agreement.signedAt
                        ? `Signed ${format(new Date(agreement.signedAt), "MMM d, yyyy")}`
                        : `Created ${format(new Date(agreement.createdAt), "MMM d, yyyy")}`}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
