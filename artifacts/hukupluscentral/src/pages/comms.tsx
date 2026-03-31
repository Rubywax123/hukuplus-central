import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare, ArrowDownCircle, ChevronDown, ChevronRight,
  Send, Store, Clock, CheckCircle2, AlertCircle, Loader2, Plus, X
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DrawdownRequest {
  id: number;
  customer_name: string;
  customer_phone: string | null;
  amount_requested: string;
  facility_limit: string | null;
  facility_balance: string | null;
  status: string;
  retailer_name: string | null;
  branch_name: string | null;
  collection_retailer_name: string | null;
  collection_branch_name: string | null;
  notes: string | null;
  store_notified_at: string | null;
  store_actioned_at: string | null;
  store_actioned_by: string | null;
  created_at: string;
}

interface StoreMessage {
  id: number;
  retailer_id: number;
  branch_id: number | null;
  reference_type: string | null;
  reference_id: number | null;
  subject: string;
  body: string;
  is_read: boolean;
  retailer_name: string | null;
  branch_name: string | null;
  created_at: string;
}

interface Retailer {
  id: number;
  name: string;
  branch_id: number;
  branch_name: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const DRAWDOWN_STATUS: Record<string, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  pending:  { label: "Pending",  bg: "bg-yellow-500/15", text: "text-yellow-300", icon: <Clock className="w-3 h-3" /> },
  notified: { label: "Notified", bg: "bg-blue-500/15",   text: "text-blue-300",   icon: <Send className="w-3 h-3" /> },
  actioned: { label: "Actioned", bg: "bg-green-500/15",  text: "text-green-300",  icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected: { label: "Rejected", bg: "bg-red-500/15",    text: "text-red-300",    icon: <AlertCircle className="w-3 h-3" /> },
};

function fmt(d: string) {
  try { return format(new Date(d), "d MMM yyyy, HH:mm"); } catch { return d; }
}
function ago(d: string) {
  try { return formatDistanceToNow(new Date(d), { addSuffix: true }); } catch { return ""; }
}

// ─── Drawdown Row ──────────────────────────────────────────────────────────────

function DrawdownRow({ dr, onUpdate }: { dr: DrawdownRequest; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(dr.notes || "");
  const qc = useQueryClient();

  const update = useMutation({
    mutationFn: async (payload: { status?: string; notes?: string }) => {
      const r = await fetch(`${BASE}/api/applications/drawdown/${dr.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("Failed to update");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["drawdowns"] }); qc.invalidateQueries({ queryKey: ["drawdown-pending-count"] }); onUpdate(); },
  });

  const s = DRAWDOWN_STATUS[dr.status] ?? DRAWDOWN_STATUS.pending;
  const amount = parseFloat(dr.amount_requested).toFixed(2);

  return (
    <div className="border border-white/10 rounded-xl bg-white/[0.03] overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
          {s.icon}
          {s.label}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{dr.customer_name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {dr.retailer_name}{dr.branch_name ? ` — ${dr.branch_name}` : ""}
            {dr.collection_retailer_name && dr.collection_retailer_name !== dr.retailer_name
              ? <> · Collecting from <span className="text-foreground/70">{dr.collection_retailer_name}{dr.collection_branch_name ? ` — ${dr.collection_branch_name}` : ""}</span></>
              : null}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-amber-300">${amount}</p>
          <p className="text-[10px] text-muted-foreground">{ago(dr.created_at)}</p>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="border-t border-white/10 px-4 py-4 space-y-4"
          >
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground mb-0.5">Customer Phone</p><p className="text-foreground">{dr.customer_phone || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground mb-0.5">Amount Requested</p><p className="text-foreground font-semibold">${amount}</p></div>
              {dr.facility_limit && <div><p className="text-xs text-muted-foreground mb-0.5">Facility Limit</p><p className="text-foreground">${parseFloat(dr.facility_limit).toFixed(2)}</p></div>}
              {dr.facility_balance && <div><p className="text-xs text-muted-foreground mb-0.5">Facility Balance</p><p className="text-foreground">${parseFloat(dr.facility_balance).toFixed(2)}</p></div>}
              <div><p className="text-xs text-muted-foreground mb-0.5">Submitted</p><p className="text-foreground">{fmt(dr.created_at)}</p></div>
              {dr.store_notified_at && <div><p className="text-xs text-muted-foreground mb-0.5">Store Notified</p><p className="text-foreground">{fmt(dr.store_notified_at)}</p></div>}
              {dr.store_actioned_at && <div><p className="text-xs text-muted-foreground mb-0.5">Actioned By</p><p className="text-foreground">{dr.store_actioned_by} · {fmt(dr.store_actioned_at)}</p></div>}
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Internal Notes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Add internal notes…"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/40"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {dr.status === "pending" && (
                <button
                  onClick={() => update.mutate({ status: "notified", notes })}
                  disabled={update.isPending}
                  className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 text-xs font-semibold hover:bg-blue-500/30 transition-colors flex items-center gap-1.5"
                >
                  <Send className="w-3 h-3" /> Mark Notified
                </button>
              )}
              {dr.status !== "actioned" && (
                <button
                  onClick={() => update.mutate({ status: "actioned", notes })}
                  disabled={update.isPending}
                  className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-300 text-xs font-semibold hover:bg-green-500/30 transition-colors flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3 h-3" /> Mark Actioned
                </button>
              )}
              {dr.status !== "rejected" && dr.status !== "actioned" && (
                <button
                  onClick={() => update.mutate({ status: "rejected", notes })}
                  disabled={update.isPending}
                  className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 text-xs font-semibold hover:bg-red-500/30 transition-colors flex items-center gap-1.5"
                >
                  <AlertCircle className="w-3 h-3" /> Reject
                </button>
              )}
              <button
                onClick={() => update.mutate({ notes })}
                disabled={update.isPending}
                className="px-3 py-1.5 rounded-lg bg-white/10 text-foreground text-xs font-semibold hover:bg-white/15 transition-colors"
              >
                {update.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save Notes"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Compose Message Modal ─────────────────────────────────────────────────────

function ComposeModal({ retailers, onClose, onSent }: {
  retailers: Retailer[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [retailerId, setRetailerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  const branches = retailers.filter(r => String(r.id) === retailerId);
  const retailerOptions = Array.from(new Map(retailers.map(r => [r.id, r.name])).entries());

  const send = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/applications/messages/admin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retailer_id: parseInt(retailerId),
          branch_id: branchId ? parseInt(branchId) : null,
          subject,
          body,
        }),
      });
      if (!r.ok) throw new Error("Failed to send");
      return r.json();
    },
    onSuccess: () => { onSent(); onClose(); },
    onError: () => setError("Failed to send message. Please try again."),
  });

  const handleSend = () => {
    setError("");
    if (!retailerId) { setError("Please select a store."); return; }
    if (!subject.trim()) { setError("Subject is required."); return; }
    if (!body.trim()) { setError("Message body is required."); return; }
    send.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#1a1b23] border border-white/10 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-foreground">New Message to Store</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Retailer</label>
            <select
              value={retailerId}
              onChange={e => { setRetailerId(e.target.value); setBranchId(""); }}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/40"
            >
              <option value="">— Select retailer —</option>
              {retailerOptions.map(([id, name]) => (
                <option key={id} value={String(id)}>{name}</option>
              ))}
            </select>
          </div>

          {branches.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Branch (optional — leave blank to message all branches)</label>
              <select
                value={branchId}
                onChange={e => setBranchId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/40"
              >
                <option value="">All branches</option>
                {branches.map(b => (
                  <option key={b.branch_id} value={String(b.branch_id)}>{b.branch_name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Message subject…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/40"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={4}
              placeholder="Write your message…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/40"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl border border-white/10 text-sm text-muted-foreground hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={send.isPending}
            className="flex-1 px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-2"
          >
            {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Message Row ───────────────────────────────────────────────────────────────

function MessageRow({ msg }: { msg: StoreMessage }) {
  const [expanded, setExpanded] = useState(false);
  const storeName = [msg.retailer_name, msg.branch_name].filter(Boolean).join(" — ") || "Unknown Store";

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${msg.is_read ? "border-white/10 bg-white/[0.02]" : "border-amber-500/20 bg-amber-500/[0.04]"}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${msg.is_read ? "bg-white/20" : "bg-amber-400"}`} />
        <Store className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{msg.subject}</p>
          <p className="text-xs text-muted-foreground truncate">To: {storeName}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-[10px] font-semibold ${msg.is_read ? "text-muted-foreground" : "text-amber-400"}`}>{msg.is_read ? "Read" : "Unread"}</p>
          <p className="text-[10px] text-muted-foreground">{ago(msg.created_at)}</p>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="border-t border-white/10 px-4 py-4 space-y-3"
          >
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground mb-0.5">Store</p><p className="text-foreground">{storeName}</p></div>
              <div><p className="text-xs text-muted-foreground mb-0.5">Sent</p><p className="text-foreground">{fmt(msg.created_at)}</p></div>
              {msg.reference_type && <div><p className="text-xs text-muted-foreground mb-0.5">Reference</p><p className="text-foreground capitalize">{msg.reference_type} #{msg.reference_id}</p></div>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Message</p>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap">{msg.body}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "drawdowns" | "messages";

const DRAWDOWN_FILTERS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "notified", label: "Notified" },
  { value: "actioned", label: "Actioned" },
  { value: "rejected", label: "Rejected" },
];

export default function CommsPage() {
  const [tab, setTab] = useState<Tab>("drawdowns");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const qc = useQueryClient();

  const { data: drawdowns = [], isLoading: ddLoading, refetch: refetchDD } = useQuery<DrawdownRequest[]>({
    queryKey: ["drawdowns", statusFilter],
    queryFn: async () => {
      const url = `${BASE}/api/applications/drawdown${statusFilter ? `?status=${statusFilter}` : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const { data: messages = [], isLoading: msgLoading, refetch: refetchMsg } = useQuery<StoreMessage[]>({
    queryKey: ["admin-messages"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/applications/messages/admin`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const { data: retailers = [] } = useQuery<Retailer[]>({
    queryKey: ["retailers-list"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/applications/retailers`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const pendingCount = drawdowns.filter(d => d.status === "pending").length;
  const unreadMessages = messages.filter(m => !m.is_read).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Communications</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Drawdown requests and store messages in one place</p>
        </div>
        {tab === "messages" && (
          <button
            onClick={() => setShowCompose(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Message
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab("drawdowns")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === "drawdowns" ? "bg-amber-500 text-black" : "text-muted-foreground hover:text-foreground"}`}
        >
          <ArrowDownCircle className="w-4 h-4" />
          Drawdowns
          {pendingCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] font-bold text-white">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("messages")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === "messages" ? "bg-amber-500 text-black" : "text-muted-foreground hover:text-foreground"}`}
        >
          <MessageSquare className="w-4 h-4" />
          Store Messages
          {unreadMessages > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] font-bold text-white">
              {unreadMessages}
            </span>
          )}
        </button>
      </div>

      {/* Drawdowns Tab */}
      {tab === "drawdowns" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {DRAWDOWN_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${statusFilter === f.value ? "bg-amber-500 text-black" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}
              >
                {f.label}
                {f.value === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
              </button>
            ))}
          </div>

          {ddLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading drawdowns…
            </div>
          ) : drawdowns.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <ArrowDownCircle className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No drawdown requests{statusFilter ? ` with status "${statusFilter}"` : ""}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {drawdowns.map(dr => (
                <DrawdownRow key={dr.id} dr={dr} onUpdate={() => refetchDD()} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages Tab */}
      {tab === "messages" && (
        <div className="space-y-2">
          {msgLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading messages…
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No messages sent to stores yet</p>
              <button
                onClick={() => setShowCompose(true)}
                className="mt-4 px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Send First Message
              </button>
            </div>
          ) : (
            messages.map(msg => <MessageRow key={msg.id} msg={msg} />)
          )}
        </div>
      )}

      {/* Compose Modal */}
      <AnimatePresence>
        {showCompose && (
          <ComposeModal
            retailers={retailers}
            onClose={() => setShowCompose(false)}
            onSent={() => { refetchMsg(); qc.invalidateQueries({ queryKey: ["admin-messages"] }); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
