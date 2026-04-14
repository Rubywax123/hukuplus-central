import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStaffAuth } from "@/hooks/useStaffAuth";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import {
  Users, Phone, FileSignature, ChevronDown, ChevronUp,
  CheckCircle2, Clock, XCircle, Banknote, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AssignedAgreement {
  id: number;
  customerId: number | null;
  loanProduct: string;
  loanAmount: number | null;
  status: string;
  createdAt: string;
  disbursementDate: string | null;
  repaymentDate: string | null;
  branchName: string | null;
  retailerName: string | null;
}

interface AssignedCustomer {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  nationalId: string | null;
  salesRepName: string | null;
  createdAt: string;
  agreements: AssignedAgreement[];
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  signed:      { label: "Active",       icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  disbursed:   { label: "Disbursed",    icon: Banknote,     color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  pending:     { label: "Pending",      icon: Clock,        color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20" },
  application: { label: "Application",  icon: Clock,        color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
  expired:     { label: "Expired",      icon: XCircle,      color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
  completed:   { label: "Completed",    icon: CheckCircle2, color: "text-slate-400",   bg: "bg-slate-500/10 border-slate-500/20" },
  written_off: { label: "Written Off",  icon: XCircle,      color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20" },
};

function statusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, icon: Clock, color: "text-muted-foreground", bg: "bg-white/5 border-white/10" };
}

function formatDate(d: string | null) {
  if (!d) return "—";
  try { return format(new Date(d), "d MMM yyyy"); } catch { return d; }
}

function formatAmount(n: number | null) {
  if (n == null) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function CustomerRow({ customer }: { customer: AssignedCustomer }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-white/3 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
          {customer.fullName[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{customer.fullName}</p>
          <p className="text-xs text-muted-foreground">{customer.phone ?? customer.email ?? "No contact info"}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border",
            customer.agreements.length > 0
              ? "bg-primary/10 text-primary border-primary/20"
              : "bg-white/5 text-muted-foreground border-white/10"
          )}>
            <FileSignature className="w-3 h-3" />
            {customer.agreements.length} loan{customer.agreements.length !== 1 ? "s" : ""}
          </span>
          {open
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 space-y-2">
              {customer.agreements.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">No loan agreements on record.</p>
              ) : (
                customer.agreements.map(a => {
                  const cfg = statusConfig(a.status);
                  const Icon = cfg.icon;
                  return (
                    <div key={a.id} className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-xl border",
                      cfg.bg
                    )}>
                      <Icon className={cn("w-4 h-4 shrink-0", cfg.color)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-white">{a.loanProduct}</span>
                          <span className={cn("text-xs font-medium", cfg.color)}>{cfg.label}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {a.loanAmount != null && (
                            <span className="text-xs text-muted-foreground">{formatAmount(a.loanAmount)}</span>
                          )}
                          {a.retailerName && (
                            <span className="text-xs text-muted-foreground">{a.retailerName}</span>
                          )}
                          {a.disbursementDate && (
                            <span className="text-xs text-muted-foreground">Disbursed {formatDate(a.disbursementDate)}</span>
                          )}
                          {a.repaymentDate && (
                            <span className="text-xs text-muted-foreground">Due {formatDate(a.repaymentDate)}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{formatDate(a.createdAt)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MyCustomersPage() {
  const { user } = useStaffAuth();
  const [search, setSearch] = useState("");

  const { data: customers, isLoading } = useQuery<AssignedCustomer[]>({
    queryKey: ["my-assigned-customers"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/customers/assigned/mine`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const filtered = (customers ?? []).filter(c =>
    !search ||
    c.fullName.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone ?? "").includes(search) ||
    (c.nationalId ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalLoans = filtered.reduce((sum, c) => sum + c.agreements.length, 0);

  return (
    <div className="pb-10 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-white">My Customers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customers assigned to you as {user?.name ?? "sales agent"}, with their full loan history.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-panel rounded-2xl border border-white/5 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{customers?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">Customers</p>
            </div>
          </div>
        </div>
        <div className="glass-panel rounded-2xl border border-white/5 p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <FileSignature className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{totalLoans}</p>
              <p className="text-xs text-muted-foreground">Total Loans</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone or ID…"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Customer list */}
      <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-muted-foreground animate-pulse">Loading your customers…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {search ? "No customers match your search." : "No customers are currently assigned to you."}
            </p>
            {!search && (
              <p className="text-xs text-muted-foreground mt-1">
                Ask an administrator to set the Sales Agent field on customer records.
              </p>
            )}
          </div>
        ) : (
          <div>
            {filtered.map(c => <CustomerRow key={c.id} customer={c} />)}
          </div>
        )}
      </div>
    </div>
  );
}
