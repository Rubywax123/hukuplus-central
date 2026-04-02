import React, { useState, useCallback, useRef, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Users, X, Phone, CreditCard, Building2, FileSignature, Edit2, Check, ChevronRight, Link2, AlertCircle, RefreshCw, DollarSign, Receipt, UploadCloud, Filter, CheckCircle2, AlertTriangle, UserPlus, ShieldCheck } from "lucide-react";
import RetailersPage from "@/pages/retailers";
import TefcoStaffPage from "@/pages/team";
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
  // Extended profile fields from application form
  gender: string | null;
  dateOfBirth: string | null;
  maritalStatus: string | null;
  isEmployed: string | null;
  employerName: string | null;
  extensionOfficer: string | null;
  salesRepName: string | null;
  retailerReference: string | null;
  marketType: string | null;
  loanProduct: string | null;
  nokName: string | null;
  nokRelationship: string | null;
  nokNationalId: string | null;
  nokPhone: string | null;
  nokEmail: string | null;
  nokAddress: string | null;
  createdAt: string;
  updatedAt: string;
  agreementCount: number;
}

interface Agreement {
  id: number;
  loanProduct: string;
  loanAmount: number | null;
  facilityFeeAmount: string | null;
  interestAmount: string | null;
  monthlyInstalment: string | null;
  loanTenorMonths: number | null;
  disbursementDate: string | null;
  repaymentDate: string | null;
  repaymentAmount: number | null;
  status: string;
  createdAt: string;
  signedAt: string | null;
  signedDocuments: Array<{ url: string; name: string }> | null;
  branchName: string | null;
  retailerName: string | null;
}

interface CustomerDetail {
  customer: Customer;
  agreements: Agreement[];
}

interface XeroContact {
  contactId: string;
  name: string;
  email: string | null;
  status: string;
}

interface XeroInvoice {
  invoiceId: string;
  invoiceNumber: string;
  type: string;
  status: string;
  date: string;
  dueDate: string;
  total: number;
  amountDue: number;
  amountPaid: number;
  currencyCode: string;
}

interface XeroCustomerData {
  linked: boolean;
  xeroContactId?: string;
  contactName?: string;
  contactEmail?: string;
  invoices?: XeroInvoice[];
  totalOutstanding?: number;
}

interface XeroStatus {
  connected: boolean;
  tenantName?: string;
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

function xeroInvoiceStatusClass(status: string) {
  switch (status) {
    case "PAID": return "bg-green-500/10 text-green-400 border-green-500/20";
    case "AUTHORISED": return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "PARTIAL": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "VOIDED":
    case "DELETED": return "bg-red-500/10 text-red-400 border-red-500/20";
    default: return "bg-white/5 text-muted-foreground border-white/10";
  }
}

function formatUSD(v: number | null) {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function formatDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-ZW", { year: "numeric", month: "short", day: "numeric" });
}

// ── Xero Panel ──────────────────────────────────────────────────────────────

function XeroPanel({ customerId, xeroContactId }: { customerId: number; xeroContactId: string | null }) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>();

  const { data: xeroStatus } = useQuery<XeroStatus>({
    queryKey: ["xero-status"],
    queryFn: () => fetch(`${BASE}/api/xero/status`, { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  const { data: xeroData, isLoading: xeroLoading, refetch: refetchXero } = useQuery<XeroCustomerData>({
    queryKey: ["xero-customer", customerId],
    queryFn: () => fetch(`${BASE}/api/xero/customer/${customerId}/data`, { credentials: "include" }).then(r => r.json()),
    enabled: !!xeroStatus?.connected,
  });

  const { data: searchResults = [], isLoading: searchLoading } = useQuery<XeroContact[]>({
    queryKey: ["xero-contacts-search", debouncedSearch],
    queryFn: () =>
      fetch(`${BASE}/api/xero/contacts/search?q=${encodeURIComponent(debouncedSearch)}`, { credentials: "include" })
        .then(r => r.json()),
    enabled: debouncedSearch.length >= 2,
  });

  const linkMutation = useMutation({
    mutationFn: (contact: XeroContact) =>
      fetch(`${BASE}/api/customers/${customerId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xeroContactId: contact.contactId }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["xero-customer", customerId] });
      setSearchQuery("");
      setDebouncedSearch("");
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/customers/${customerId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xeroContactId: null }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      queryClient.invalidateQueries({ queryKey: ["xero-customer", customerId] });
    },
  });

  const handleSearchChange = (v: string) => {
    setSearchQuery(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 400);
  };

  // Xero not connected
  if (!xeroStatus?.connected) {
    return (
      <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3">
        <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">Xero not connected</p>
          <p className="text-xs text-muted-foreground/60">Connect Xero to link invoices and balances</p>
        </div>
        <a
          href={`${BASE}/api/xero/auth`}
          className="text-xs font-medium text-primary hover:underline shrink-0"
        >
          Connect
        </a>
      </div>
    );
  }

  // Loading
  if (xeroLoading) {
    return (
      <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-muted-foreground">Loading Xero data...</span>
      </div>
    );
  }

  // Linked — show data
  if (xeroData?.linked) {
    const invoices = xeroData.invoices || [];
    const outstanding = xeroData.totalOutstanding || 0;
    const activeInvoices = invoices.filter(i => ["AUTHORISED", "PARTIAL"].includes(i.status));
    const recentInvoices = invoices.slice(0, 5);

    return (
      <div className="space-y-3">
        {/* Contact link + outstanding */}
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-400">Linked to Xero</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => refetchXero()}
                className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <button
                onClick={() => unlinkMutation.mutate()}
                disabled={unlinkMutation.isPending}
                className="text-xs text-muted-foreground hover:text-red-400 transition-colors px-1"
                title="Unlink"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
          <p className="text-sm font-semibold text-white">{xeroData.contactName}</p>
          {xeroData.contactEmail && <p className="text-xs text-muted-foreground">{xeroData.contactEmail}</p>}
        </div>

        {/* Outstanding balance */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" /> Outstanding</p>
            <p className={`text-sm font-bold ${outstanding > 0 ? "text-amber-400" : "text-green-400"}`}>
              {formatUSD(outstanding)}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Receipt className="w-3 h-3" /> Active Invoices</p>
            <p className="text-sm font-bold text-white">{activeInvoices.length}</p>
          </div>
        </div>

        {/* Recent invoices */}
        {recentInvoices.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Recent Invoices</p>
            <div className="space-y-1.5">
              {recentInvoices.map(inv => (
                <div key={inv.invoiceId} className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-white">{inv.invoiceNumber}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold border ${xeroInvoiceStatusClass(inv.status)}`}>
                      {inv.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatDate(inv.date)}</span>
                    <div className="text-right">
                      <span className="text-white font-medium">{formatUSD(inv.total)}</span>
                      {inv.amountDue > 0 && <span className="ml-1 text-amber-400">({formatUSD(inv.amountDue)} due)</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {invoices.length === 0 && (
          <p className="text-xs text-muted-foreground italic text-center py-2">No invoices found in Xero</p>
        )}
      </div>
    );
  }

  // Not linked — show search
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Search Xero to link this customer to their contact record.</p>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={e => handleSearchChange(e.target.value)}
          placeholder="Search Xero contacts..."
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {searchLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {debouncedSearch.length >= 2 && !searchLoading && searchResults.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">No contacts found for "{debouncedSearch}"</p>
      )}

      {searchResults.length > 0 && (
        <div className="space-y-1.5">
          {searchResults.map(contact => (
            <button
              key={contact.contactId}
              onClick={() => linkMutation.mutate(contact)}
              disabled={linkMutation.isPending}
              className="w-full flex items-center justify-between p-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-primary/30 transition-colors text-left group"
            >
              <div>
                <p className="text-sm font-semibold text-white">{contact.name}</p>
                {contact.email && <p className="text-xs text-muted-foreground">{contact.email}</p>}
              </div>
              <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">Link</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

            {/* Personal Details — auto-populated from application form */}
            {(c.gender || c.dateOfBirth || c.maritalStatus || c.isEmployed || c.employerName) && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Personal Details</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {c.gender && (
                    <div>
                      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Gender</p>
                      <p className="text-sm text-white">{c.gender}</p>
                    </div>
                  )}
                  {c.dateOfBirth && (
                    <div>
                      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Date of Birth</p>
                      <p className="text-sm text-white">{c.dateOfBirth}</p>
                    </div>
                  )}
                  {c.maritalStatus && (
                    <div>
                      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Marital Status</p>
                      <p className="text-sm text-white">{c.maritalStatus}</p>
                    </div>
                  )}
                  {c.isEmployed && (
                    <div>
                      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Employed</p>
                      <p className="text-sm text-white">{c.isEmployed}</p>
                    </div>
                  )}
                  {c.employerName && (
                    <div className="col-span-2">
                      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">Employer</p>
                      <p className="text-sm text-white">{c.employerName}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Next of Kin */}
            {(c.nokName || c.nokRelationship || c.nokPhone || c.nokNationalId || c.nokEmail || c.nokAddress) && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Next of Kin</p>
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
                  {c.nokName && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Name</span>
                      <span className="text-sm text-white font-medium">{c.nokName}</span>
                    </div>
                  )}
                  {c.nokRelationship && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Relationship</span>
                      <span className="text-sm text-white">{c.nokRelationship}</span>
                    </div>
                  )}
                  {c.nokNationalId && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">ID / Passport</span>
                      <span className="text-sm text-white font-mono">{c.nokNationalId}</span>
                    </div>
                  )}
                  {c.nokPhone && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Mobile</span>
                      <span className="text-sm text-white">{c.nokPhone}</span>
                    </div>
                  )}
                  {c.nokEmail && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Email</span>
                      <span className="text-sm text-white">{c.nokEmail}</span>
                    </div>
                  )}
                  {c.nokAddress && (
                    <div>
                      <span className="text-xs text-muted-foreground block mb-0.5">Address</span>
                      <span className="text-sm text-white">{c.nokAddress}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Application Info */}
            {(c.salesRepName || c.retailerReference || c.marketType || c.loanProduct) && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Application Info</p>
                <div className="space-y-2">
                  {c.loanProduct && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Product</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 border border-primary/20 text-primary font-medium">{c.loanProduct}</span>
                    </div>
                  )}
                  {c.extensionOfficer && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Extension Officer</span>
                      <span className="text-sm text-white">{c.extensionOfficer}</span>
                    </div>
                  )}
                  {c.retailerReference && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Retailer Ref</span>
                      <span className="text-sm text-white font-mono">{c.retailerReference}</span>
                    </div>
                  )}
                  {c.marketType && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Market Type</span>
                      <span className="text-sm text-white">{c.marketType}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {c.formitizeCrmId && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Formitize CRM ID</p>
                <p className="text-xs text-muted-foreground font-mono">{c.formitizeCrmId}</p>
              </div>
            )}

            {/* Xero Panel */}
            {!editMode && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#13B5EA" }}>
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.527l-3.542 3.473 3.542 3.472a.836.836 0 0 1 0 1.183.836.836 0 0 1-1.182 0L13.17 13.18l-3.471 3.475a.836.836 0 0 1-1.183 0 .836.836 0 0 1 0-1.183l3.471-3.472-3.471-3.473a.836.836 0 0 1 0-1.182.836.836 0 0 1 1.183 0l3.47 3.474 3.543-3.474a.836.836 0 0 1 1.182 0 .836.836 0 0 1 0 1.182z"/>
                  </svg>
                  Xero
                </p>
                <XeroPanel customerId={c.id} xeroContactId={c.xeroContactId} />
              </div>
            )}

            {/* Loan History */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <FileSignature className="w-3.5 h-3.5" /> Loan History ({agreements.length})
              </p>
              {agreements.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No loan records on file</p>
              ) : (
                <div className="space-y-2">
                  {agreements.map(a => {
                    const isKiosk = a.loanProduct === "Novafeeds" ||
                      (a.retailerName?.toLowerCase().includes("novafeed") ?? false);
                    return (
                      <div key={a.id} className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-white">
                            {a.loanProduct === "Novafeeds" ? "HukuPlus" : a.loanProduct}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {isKiosk ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 border border-primary/20 text-primary font-medium">Kiosk</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-muted-foreground font-medium">Formitize</span>
                            )}
                            <span className={statusBadge(a.status)}>{a.status}</span>
                          </div>
                        </div>
                        {(a.retailerName || a.branchName) && (
                          <p className="text-xs text-muted-foreground">
                            {[a.retailerName, a.branchName].filter(Boolean).join(" — ")}
                          </p>
                        )}
                        {/* Financial summary row */}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Loan Amount</span>
                            <span className="text-white font-medium">{formatUSD(a.loanAmount)}</span>
                          </div>
                          {a.facilityFeeAmount && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Facility Fee</span>
                              <span className="text-white font-medium">{formatUSD(parseFloat(a.facilityFeeAmount))}</span>
                            </div>
                          )}
                          {a.interestAmount && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Total Interest</span>
                              <span className="text-white font-medium">{formatUSD(parseFloat(a.interestAmount))}</span>
                            </div>
                          )}
                          {a.monthlyInstalment && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Monthly Instalment</span>
                              <span className="text-white font-medium">{formatUSD(parseFloat(a.monthlyInstalment))}</span>
                            </div>
                          )}
                          {a.repaymentAmount && !a.monthlyInstalment && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Repayment</span>
                              <span className="text-white font-medium">{formatUSD(a.repaymentAmount)}</span>
                            </div>
                          )}
                          {a.loanTenorMonths && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Tenor</span>
                              <span className="text-white font-medium">{a.loanTenorMonths} months</span>
                            </div>
                          )}
                        </div>
                        {/* Dates */}
                        {(a.disbursementDate || a.repaymentDate) && (
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            {a.disbursementDate && <span>Disbursed: <span className="text-white/70">{a.disbursementDate}</span></span>}
                            {a.repaymentDate && <span>Due: <span className="text-white/70">{a.repaymentDate}</span></span>}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {formatDate(a.createdAt)}{a.signedAt ? ` — Signed ${formatDate(a.signedAt)}` : ""}
                        </p>
                        {/* Signed documents */}
                        {a.signedDocuments && a.signedDocuments.length > 0 && (
                          <div className="pt-1 border-t border-white/5 space-y-1">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Signed Documents</p>
                            {a.signedDocuments.map((doc, i) => {
                              const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";
                              const isPdf = ext === "pdf";
                              const label = isPdf ? doc.name : `Photo ${i + 1}`;
                              return (
                                <a
                                  key={i}
                                  href={doc.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                                >
                                  {isPdf ? (
                                    <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 2a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H4zm6 1v5h5M7 13h6M7 16h4"/></svg>
                                  ) : (
                                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                                  )}
                                  <span className="truncate">{label}</span>
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </motion.aside>
    </motion.div>
  );
}

// ── Completeness helper ──────────────────────────────────────────────────────

function completeness(c: Customer): "complete" | "partial" | "empty" {
  const filled = [c.phone, c.nationalId, c.email].filter(Boolean).length;
  if (filled === 3) return "complete";
  if (filled === 0) return "empty";
  return "partial";
}

function CompletenessDot({ c }: { c: Customer }) {
  const level = completeness(c);
  const missing = [
    !c.phone && "phone",
    !c.nationalId && "national ID",
    !c.email && "email",
  ].filter(Boolean).join(", ");
  const title = level === "complete" ? "All contact details recorded" : `Missing: ${missing}`;
  return (
    <span
      title={title}
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${
        level === "complete" ? "bg-green-400" :
        level === "partial"  ? "bg-amber-400" : "bg-red-400"
      }`}
    />
  );
}

// ── CSV Enrichment Modal ─────────────────────────────────────────────────────

interface EnrichResult {
  total: number; matched: number; enriched: number; created: number; notFound: number; skipped: number;
  columnHeaders?: string[];
  firstLine?: string;
  details: { name: string; status: string; fields: string[] }[];
}

function EnrichModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState(false);
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ f, mode }: { f: File; mode: boolean }) => {
      const fd = new FormData();
      fd.append("file", f);
      const url = `${BASE}/api/customers/enrich-csv${mode ? "?mode=import" : ""}`;
      const r = await fetch(url, { method: "POST", credentials: "include", body: fd });
      if (!r.ok) throw new Error((await r.json()).error || "Upload failed");
      return r.json() as Promise<EnrichResult>;
    },
    onSuccess: (data) => { setResult(data); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg bg-card border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-white">Enrich Customer Records from CSV</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {!result ? (
            <>
              {/* Instructions */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-white">How to use:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Export contacts from <strong className="text-white">Formitize</strong> as CSV — no column renaming needed</li>
                  <li>Choose whether to only fill in missing details, or also create new customer records</li>
                  <li>Upload — the system matches by phone first, then name, and never overwrites existing data</li>
                </ol>
              </div>

              {/* Import mode toggle */}
              <button
                type="button"
                onClick={() => setImportMode(m => !m)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                  importMode
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "bg-white/5 border-white/10 text-muted-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <UserPlus className="w-4 h-4" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-white">Create new records</p>
                    <p className="text-xs">Contacts not yet in the system will be added as new customers</p>
                  </div>
                </div>
                <div className={`w-10 h-5.5 rounded-full transition-colors flex items-center px-0.5 ${importMode ? "bg-primary" : "bg-white/20"}`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${importMode ? "translate-x-4.5" : "translate-x-0"}`} />
                </div>
              </button>

              {/* File picker */}
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-white/10 hover:border-primary/40 rounded-xl p-8 text-center cursor-pointer transition-colors group"
              >
                <UploadCloud className="w-8 h-8 text-muted-foreground group-hover:text-primary mx-auto mb-2 transition-colors" />
                {file ? (
                  <p className="text-sm text-white font-medium">{file.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Click to select a CSV file</p>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => { setFile(e.target.files?.[0] ?? null); setError(null); }}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-muted-foreground hover:text-white transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => file && mutation.mutate({ f: file, mode: importMode })}
                  disabled={!file || mutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <UploadCloud className="w-4 h-4" />
                  {mutation.isPending ? "Processing…" : importMode ? "Import & Enrich" : "Run Enrichment"}
                </button>
              </div>
            </>
          ) : (
            /* Results */
            <div className="space-y-4">
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: "Total", value: result.total, color: "text-white" },
                  { label: "Matched", value: result.matched, color: "text-blue-400" },
                  { label: "Enriched", value: result.enriched, color: "text-green-400" },
                  { label: "Created", value: result.created ?? 0, color: "text-violet-400" },
                  { label: "Not found", value: result.notFound, color: "text-amber-400" },
                ].map(s => (
                  <div key={s.label} className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Show column headers when nothing matched — helps diagnose format issues */}
              {result.matched === 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                  <p className="text-xs font-semibold text-amber-400">No customers matched — diagnostic info:</p>
                  {result.columnHeaders && result.columnHeaders.length > 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground">Columns detected in your CSV:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {result.columnHeaders.map((h, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-white/10 text-xs font-mono text-white">{h || "(empty)"}</span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No column headers could be read from the file.</p>
                  )}
                  {result.firstLine && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Raw first line of file:</p>
                      <pre className="text-xs font-mono text-amber-300 bg-black/30 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">{result.firstLine}</pre>
                    </div>
                  )}
                </div>
              )}

              {result.details.filter(d => d.status === "enriched").length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Updated records</p>
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {result.details.filter(d => d.status === "enriched").map((d, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-green-500/10 border border-green-500/20">
                        <span className="text-sm text-white font-medium">{d.name}</span>
                        <span className="text-xs text-green-400">{d.fields.join(", ")} added</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.details.filter(d => d.status === "created").length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">New records created</p>
                  <div className="max-h-48 overflow-y-auto space-y-1.5">
                    {result.details.filter(d => d.status === "created").map((d, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                        <div className="flex items-center gap-2">
                          <UserPlus className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                          <span className="text-sm text-white font-medium">{d.name}</span>
                        </div>
                        <span className="text-xs text-violet-400">{d.fields.filter(f => f !== "name").join(", ") || "name only"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.notFound > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Not matched</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {result.details.filter(d => d.status === "not_found").map((d, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="text-sm text-muted-foreground">{d.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button onClick={onClose} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors">
                  <CheckCircle2 className="w-4 h-4" /> Done
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Customers Page ─────────────────────────────────────────────────────

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [enrichOpen, setEnrichOpen] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ enriched: number; total: number } | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>();
  const queryClient = useQueryClient();

  // ── Tab routing ─────────────────────────────────────────────────────────────
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr ?? "");
  const activeTab = (urlParams.get("tab") ?? "customers") as "customers" | "retailers" | "staff";

  function switchTab(tab: string) {
    navigate(tab === "customers" ? "/customers" : `/customers?tab=${tab}`);
  }

  const TAB_ITEMS = [
    { id: "customers",  label: "Customers",          icon: Users },
    { id: "retailers",  label: "Retailers & Stores",  icon: Building2 },
    { id: "staff",      label: "Tefco Staff",          icon: ShieldCheck },
  ] as const;

  const tabBar = (
    <div className="flex items-center gap-1 p-1 bg-white/5 rounded-xl border border-white/10 w-fit mb-6">
      {TAB_ITEMS.map(t => (
        <button
          key={t.id}
          onClick={() => switchTab(t.id)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
            activeTab === t.id
              ? "bg-primary text-white shadow-lg shadow-primary/20"
              : "text-muted-foreground hover:text-white hover:bg-white/5"
          }`}
        >
          <t.icon className="w-4 h-4" />
          {t.label}
        </button>
      ))}
    </div>
  );

  // Auto-open a customer profile when navigated here with ?customerId=XXX
  useEffect(() => {
    if (!searchStr) return;
    const params = new URLSearchParams(searchStr);
    const id = params.get("customerId");
    if (id) {
      const parsed = parseInt(id, 10);
      if (!isNaN(parsed)) setSelectedId(parsed);
      // Clear customerId but preserve other query params (e.g. tab)
      const newParams = new URLSearchParams(searchStr);
      newParams.delete("customerId");
      const qs = newParams.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, [searchStr]);

  const backfillMutation = useMutation({
    mutationFn: () =>
      fetch(`${BASE}/api/customers/backfill-from-form-data`, {
        method: "POST", credentials: "include",
      }).then(r => r.json()),
    onSuccess: (data) => {
      setBackfillResult({ enriched: data.enriched, total: data.total });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  const handleSearch = useCallback((v: string) => {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(v), 350);
  }, []);

  const { data, isLoading } = useQuery<{ customers: Customer[]; total: number }>({
    queryKey: ["customers", debouncedSearch, incompleteOnly],
    queryFn: () =>
      fetch(`${BASE}/api/customers?search=${encodeURIComponent(debouncedSearch)}&limit=100&incompleteOnly=${incompleteOnly}`, { credentials: "include" })
        .then(r => r.json()),
  });

  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;

  // ── Non-customers tabs — render sub-pages with shared tab bar ──────────────
  if (activeTab === "retailers") {
    return (
      <div>
        {tabBar}
        <RetailersPage />
      </div>
    );
  }

  if (activeTab === "staff") {
    return (
      <div>
        {tabBar}
        <TefcoStaffPage />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      {tabBar}

      {/* Header */}
      <div>
        <ActiveAppBanner />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-white">Customer Database</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Unified customer records across all loan products</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold text-primary">{total.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground">total</span>
            </div>
            <button
              onClick={() => setIncompleteOnly(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${
                incompleteOnly
                  ? "bg-amber-500/20 border-amber-500/30 text-amber-400"
                  : "bg-white/5 border-white/10 text-muted-foreground hover:text-white"
              }`}
              title="Show only customers with missing phone, national ID or email"
            >
              <Filter className="w-3.5 h-3.5" />
              Incomplete
            </button>
            <button
              onClick={() => setEnrichOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              Enrich from CSV
            </button>
            <button
              onClick={() => { setBackfillResult(null); backfillMutation.mutate(); }}
              disabled={backfillMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-muted-foreground hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
              title="Extract personal details, next-of-kin and application info from stored application form data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${backfillMutation.isPending ? "animate-spin" : ""}`} />
              {backfillMutation.isPending ? "Enriching…" : "Enrich from Forms"}
            </button>
          </div>
        </div>
      </div>

      {/* Backfill result banner */}
      {backfillResult && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-sm text-emerald-400 font-medium">
              Enriched {backfillResult.enriched} of {backfillResult.total} customer records with extended profile data from application forms.
            </span>
          </div>
          <button onClick={() => setBackfillResult(null)} className="p-1 rounded hover:bg-white/10 text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Completeness legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> All details recorded</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Some details missing</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> No contact details</span>
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
                        <div className="relative shrink-0">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                            {c.fullName[0]?.toUpperCase()}
                          </div>
                          <span className="absolute -top-0.5 -right-0.5"><CompletenessDot c={c} /></span>
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

      {/* CSV Enrichment Modal */}
      <AnimatePresence>
        {enrichOpen && (
          <EnrichModal
            onClose={() => setEnrichOpen(false)}
            onDone={() => {
              queryClient.invalidateQueries({ queryKey: ["customers"] });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
