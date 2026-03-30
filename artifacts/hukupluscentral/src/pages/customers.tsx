import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Users, X, Phone, CreditCard, Building2, FileSignature, Edit2, Check, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ActiveAppBanner } from "@/components/layout";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Customer {
  id: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  nationalId: string | null;
  address: string | null;
  notes: string | null;
  formitizeCrmId: string | null;
  xeroContactId: string | null;
  createdAt: string;
  updatedAt: string;
  agreementCount: number;
}

interface Agreement {
  id: number;
  loanProduct: string;
  loanAmount: number | null;
  status: string;
  createdAt: string;
  signedAt: string | null;
  branchName: string | null;
  retailerName: string | null;
}

interface CustomerDetail {
  customer: Customer;
  agreements: Agreement[];
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    signed: "bg-green-500/10 text-green-400 border-green-500/20",
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    expired: "bg-red-500/10 text-red-400 border-red-500/20",
    disbursed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  };
  return `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${map[status] ?? "bg-white/5 text-muted-foreground border-white/10"}`;
}

function formatUSD(v: number | null) {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-ZW", { year: "numeric", month: "short", day: "numeric" });
}

// ── Customer Detail Drawer ──────────────────────────────────────────────────

function CustomerDrawer({ customerId, onClose }: { customerId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Customer>>({});

  const { data, isLoading } = useQuery<CustomerDetail>({
    queryKey: ["customer", customerId],
    queryFn: () => fetch(`${BASE}/api/customers/${customerId}`, { credentials: "include" }).then(r => r.json()),
  });

  const mutation = useMutation({
    mutationFn: (body: Partial<Customer>) =>
      fetch(`${BASE}/api/customers/${customerId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setEditMode(false);
    },
  });

  const handleEdit = () => {
    if (!data) return;
    setEditForm({
      fullName: data.customer.fullName,
      phone: data.customer.phone ?? "",
      email: data.customer.email ?? "",
      nationalId: data.customer.nationalId ?? "",
      address: data.customer.address ?? "",
      notes: data.customer.notes ?? "",
      xeroContactId: data.customer.xeroContactId ?? "",
    });
    setEditMode(true);
  };

  const handleSave = () => mutation.mutate(editForm);

  const c = data?.customer;
  const agreements = data?.agreements ?? [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex"
    >
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full max-w-md bg-card border-l border-white/10 flex flex-col h-full overflow-y-auto shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <h2 className="text-lg font-bold text-white">Customer Profile</h2>
          <div className="flex items-center gap-2">
            {!editMode && (
              <button onClick={handleEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white text-xs font-medium transition-colors">
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            {editMode && (
              <>
                <button onClick={handleSave} disabled={mutation.isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors">
                  <Check className="w-3.5 h-3.5" /> {mutation.isPending ? "Saving..." : "Save"}
                </button>
                <button onClick={() => setEditMode(false)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground text-xs font-medium transition-colors">
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !c ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">Customer not found</div>
        ) : (
          <div className="flex-1 p-6 space-y-6">
            {/* Avatar + name */}
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/30 to-accent/30 border border-primary/20 flex items-center justify-center text-2xl font-bold text-primary">
                {c.fullName[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                {editMode ? (
                  <input
                    value={editForm.fullName ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))}
                    className="w-full text-xl font-bold bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <h3 className="text-xl font-bold text-white truncate">{c.fullName}</h3>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">Customer #{c.id} &middot; Since {formatDate(c.createdAt)}</p>
              </div>
            </div>

            {/* Fields */}
            {[
              { label: "Phone", field: "phone" as keyof Customer, icon: Phone },
              { label: "Email", field: "email" as keyof Customer, icon: null },
              { label: "National ID", field: "nationalId" as keyof Customer, icon: CreditCard },
              { label: "Address", field: "address" as keyof Customer, icon: Building2 },
              { label: "Xero Contact ID", field: "xeroContactId" as keyof Customer, icon: null },
            ].map(({ label, field, icon: Icon }) => (
              <div key={field}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{label}</p>
                {editMode ? (
                  <input
                    value={(editForm[field] as string) ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, [field]: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder={`Enter ${label.toLowerCase()}…`}
                  />
                ) : (
                  <p className="text-sm text-white flex items-center gap-2">
                    {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    {(c[field] as string) || <span className="text-muted-foreground italic">Not recorded</span>}
                  </p>
                )}
              </div>
            ))}

            {/* Notes */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Notes</p>
              {editMode ? (
                <textarea
                  value={(editForm.notes as string) ?? ""}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Internal notes…"
                />
              ) : (
                <p className="text-sm text-white whitespace-pre-wrap">
                  {c.notes || <span className="text-muted-foreground italic">None</span>}
                </p>
              )}
            </div>

            {c.formitizeCrmId && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Formitize CRM ID</p>
                <p className="text-xs text-muted-foreground font-mono">{c.formitizeCrmId}</p>
              </div>
            )}

            {/* Agreements */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <FileSignature className="w-3.5 h-3.5" /> Agreement History ({agreements.length})
              </p>
              {agreements.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No agreements on record</p>
              ) : (
                <div className="space-y-2">
                  {agreements.map(a => (
                    <div key={a.id} className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white">{a.loanProduct}</span>
                        <span className={statusBadge(a.status)}>{a.status}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{formatUSD(a.loanAmount)}</span>
                        {a.retailerName && <><span>&middot;</span><span>{a.retailerName}</span></>}
                        {a.branchName && <><span>&middot;</span><span>{a.branchName}</span></>}
                      </div>
                      <p className="text-xs text-muted-foreground">{formatDate(a.createdAt)}{a.signedAt ? ` — Signed ${formatDate(a.signedAt)}` : ""}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </motion.aside>
    </motion.div>
  );
}

// ── Main Customers Page ─────────────────────────────────────────────────────

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>();

  const handleSearch = useCallback((v: string) => {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 350);
  }, []);

  const { data, isLoading } = useQuery<{ customers: Customer[]; total: number }>({
    queryKey: ["customers", debouncedSearch],
    queryFn: () =>
      fetch(`${BASE}/api/customers?search=${encodeURIComponent(debouncedSearch)}&limit=100`, { credentials: "include" })
        .then(r => r.json()),
  });

  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <ActiveAppBanner />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-white">Customer Database</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Unified customer records across all loan products</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20">
            <Users className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-primary">{total.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">total customers</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search by name, phone, national ID or email…"
          className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
        />
        {search && (
          <button onClick={() => handleSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customer</th>
                <th className="text-left px-4 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Phone</th>
                <th className="text-left px-4 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">National ID</th>
                <th className="text-left px-4 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agreements</th>
                <th className="text-left px-4 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Joined</th>
                <th className="px-4 py-4" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="border-b border-white/5">
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-6 py-4"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">No customers found</p>
                    {debouncedSearch && <p className="text-xs text-muted-foreground/60 mt-1">Try a different search term</p>}
                  </td>
                </tr>
              ) : (
                customers.map((c, i) => (
                  <motion.tr
                    key={c.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    onClick={() => setSelectedId(c.id)}
                    className="border-b border-white/5 hover:bg-white/3 cursor-pointer transition-colors group"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                          {c.fullName[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{c.fullName}</p>
                          {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-white font-mono">{c.phone ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-4 text-sm text-white font-mono">{c.nationalId ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                        c.agreementCount > 0
                          ? "bg-primary/10 text-primary border-primary/20"
                          : "bg-white/5 text-muted-foreground border-white/10"
                      }`}>
                        <FileSignature className="w-3 h-3" />
                        {c.agreementCount}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">{formatDate(c.createdAt)}</td>
                    <td className="px-4 py-4">
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-white transition-colors ml-auto" />
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Detail Drawer */}
      <AnimatePresence>
        {selectedId !== null && (
          <CustomerDrawer customerId={selectedId} onClose={() => setSelectedId(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
