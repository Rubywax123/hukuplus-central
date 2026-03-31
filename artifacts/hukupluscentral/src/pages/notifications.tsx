import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, CheckCheck, ChevronDown, Clock, User, Store, RefreshCw } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PRODUCTS = ["All", "HukuPlus", "Revolver", "ChikweretiOne"] as const;

const TASK_TYPES = [
  { value: "all", label: "All Types" },
  { value: "application", label: "Applications" },
  { value: "reapplication", label: "Re-Applications" },
  { value: "agreement", label: "Agreements" },
  { value: "upload", label: "Document Uploads" },
  { value: "payment", label: "Payment Notifications" },
  { value: "drawdown", label: "Drawdowns" },
  { value: "approval", label: "Approvals" },
  { value: "undertaking", label: "Undertakings" },
] as const;

const PRODUCT_COLORS: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  HukuPlus:      { bg: "bg-amber-500/10",  text: "text-amber-300",  dot: "bg-amber-400",  border: "border-amber-500/20" },
  Revolver:      { bg: "bg-blue-500/10",   text: "text-blue-300",   dot: "bg-blue-400",   border: "border-blue-500/20"  },
  ChikweretiOne: { bg: "bg-green-500/10",  text: "text-green-300",  dot: "bg-green-400",  border: "border-green-500/20" },
};

const TYPE_BADGE: Record<string, { bg: string; text: string }> = {
  application:   { bg: "bg-purple-500/15",  text: "text-purple-300"  },
  reapplication: { bg: "bg-indigo-500/15",  text: "text-indigo-300"  },
  agreement:     { bg: "bg-emerald-500/15", text: "text-emerald-300" },
  upload:        { bg: "bg-sky-500/15",     text: "text-sky-300"     },
  payment:       { bg: "bg-yellow-500/15",  text: "text-yellow-300"  },
  drawdown:      { bg: "bg-pink-500/15",    text: "text-pink-300"    },
  approval:      { bg: "bg-teal-500/15",    text: "text-teal-300"    },
  undertaking:   { bg: "bg-orange-500/15",  text: "text-orange-300"  },
};

function typeLabel(t: string) {
  return TASK_TYPES.find(x => x.value === t)?.label ?? t;
}

interface Notification {
  id: number;
  formitize_job_id: string | null;
  form_name: string;
  task_type: string;
  product: string;
  customer_name: string | null;
  customer_phone: string | null;
  branch_name: string | null;
  retailer_name: string | null;
  status: "new" | "actioned";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface CountsResponse {
  breakdown: Array<{ product: string; task_type: string; status: string; count: string }>;
  newTotal: number;
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [activeProduct, setActiveProduct] = useState<string>("All");
  const [activeType, setActiveType] = useState<string>("all");
  const [showActioned, setShowActioned] = useState(false);

  const statusFilter = showActioned ? "all" : "new";

  const { data: notifications = [], isLoading, refetch } = useQuery<Notification[]>({
    queryKey: ["notifications", activeProduct, activeType, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeProduct !== "All") params.set("product", activeProduct);
      if (activeType !== "all") params.set("task_type", activeType);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const r = await fetch(`${BASE}/api/formitize/notifications?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load notifications");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const { data: counts } = useQuery<CountsResponse>({
    queryKey: ["notification-counts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/formitize/notifications/counts`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load counts");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const markOneMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await fetch(`${BASE}/api/formitize/notifications/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Failed to update");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notification-counts"] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (activeProduct !== "All") body.product = activeProduct;
      if (activeType !== "all") body.task_type = activeType;
      const r = await fetch(`${BASE}/api/formitize/notifications/mark-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("Failed to mark all");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notification-counts"] });
    },
  });

  const newCount = counts?.newTotal ?? 0;

  const productNewCount = (product: string) => {
    if (!counts) return 0;
    if (product === "All") return newCount;
    return counts.breakdown
      .filter(r => r.product === product && r.status === "new")
      .reduce((s, r) => s + parseInt(r.count), 0);
  };

  const visibleNew = notifications.filter(n => n.status === "new").length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Bell className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Notifications</h1>
            <p className="text-sm text-white/50">
              {newCount > 0 ? `${newCount} unactioned task${newCount !== 1 ? "s" : ""}` : "All caught up"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          {visibleNew > 0 && (
            <button
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all actioned
            </button>
          )}
        </div>
      </div>

      {/* Product tabs */}
      <div className="flex gap-1 mb-4 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
        {PRODUCTS.map(p => {
          const cnt = productNewCount(p);
          return (
            <button
              key={p}
              onClick={() => setActiveProduct(p)}
              className={`relative px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeProduct === p
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              {p}
              {cnt > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-[10px] font-bold text-black">
                  {cnt > 9 ? "9+" : cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex gap-1.5 flex-wrap">
          {TASK_TYPES.slice(0, 6).map(tt => (
            <button
              key={tt.value}
              onClick={() => setActiveType(tt.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                activeType === tt.value
                  ? "bg-white/15 text-white"
                  : "text-white/40 hover:text-white/70 hover:bg-white/5"
              }`}
            >
              {tt.label}
            </button>
          ))}
          <div className="relative group">
            <button className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-white/40 hover:text-white/70 hover:bg-white/5 transition-all">
              More <ChevronDown className="w-3 h-3" />
            </button>
            <div className="absolute left-0 top-full mt-1 z-20 hidden group-hover:flex flex-col bg-card border border-white/10 rounded-xl shadow-xl p-1 min-w-[160px]">
              {TASK_TYPES.slice(6).map(tt => (
                <button
                  key={tt.value}
                  onClick={() => setActiveType(tt.value)}
                  className={`px-3 py-2 rounded-lg text-xs text-left transition-colors ${
                    activeType === tt.value ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {tt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-white/50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showActioned}
              onChange={e => setShowActioned(e.target.checked)}
              className="w-3.5 h-3.5 accent-amber-500"
            />
            Show actioned
          </label>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-white/40">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Loading notifications...
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-white/40">
          <Bell className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-base font-medium">No notifications</p>
          <p className="text-sm mt-1">
            {showActioned ? "Nothing here yet" : "No unactioned items — you're all caught up"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {notifications.map(n => (
              <NotificationCard
                key={n.id}
                n={n}
                onAction={() => markOneMutation.mutate({ id: n.id, status: n.status === "new" ? "actioned" : "new" })}
                loading={markOneMutation.isPending}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function NotificationCard({
  n,
  onAction,
  loading,
}: {
  n: Notification;
  onAction: () => void;
  loading: boolean;
}) {
  const colors = PRODUCT_COLORS[n.product] ?? PRODUCT_COLORS["HukuPlus"];
  const typeBadge = TYPE_BADGE[n.task_type] ?? { bg: "bg-white/10", text: "text-white/60" };
  const isNew = n.status === "new";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${
        isNew
          ? "bg-white/5 border-white/10 hover:bg-white/8"
          : "bg-white/[0.02] border-white/5 opacity-60 hover:opacity-80"
      }`}
    >
      {/* Product dot */}
      <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colors.bg} border ${colors.border}`}>
        <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border}`}>
            {n.product}
          </span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeBadge.bg} ${typeBadge.text}`}>
            {typeLabel(n.task_type)}
          </span>
          {isNew && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/20">
              NEW
            </span>
          )}
        </div>

        <p className="text-sm font-medium text-white truncate">{n.form_name}</p>

        <div className="flex items-center gap-3 mt-1.5 text-xs text-white/50 flex-wrap">
          {n.customer_name && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {n.customer_name}
            </span>
          )}
          {n.retailer_name && (
            <span className="flex items-center gap-1">
              <Store className="w-3 h-3" />
              {n.retailer_name}{n.branch_name ? ` — ${n.branch_name}` : ""}
            </span>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <Clock className="w-3 h-3" />
            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
          </span>
        </div>

        {n.customer_phone && (
          <p className="text-xs text-white/30 mt-1">{n.customer_phone}</p>
        )}
      </div>

      {/* Action */}
      <button
        onClick={onAction}
        disabled={loading}
        className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40 ${
          isNew
            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20"
            : "bg-white/5 border border-white/10 text-white/40 hover:text-white/60"
        }`}
      >
        <CheckCheck className="w-3.5 h-3.5" />
        {isNew ? "Mark actioned" : "Reopen"}
      </button>
    </motion.div>
  );
}
