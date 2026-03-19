import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader, GlassCard, GradientButton, Badge, Modal, Input, Label } from "@/components/ui-extras";
import { Plus, ShieldCheck, User, UserX, KeyRound, Eye, EyeOff, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useStaffAuth } from "@/hooks/useStaffAuth";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function staffFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

type StaffMember = {
  id: number;
  name: string;
  email: string;
  role: "super_admin" | "admin" | "staff";
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Principal Admin",
  admin: "Admin",
  staff: "Staff",
};

const ROLE_COLORS: Record<string, "success" | "warning" | "neutral"> = {
  super_admin: "success",
  admin: "warning",
  staff: "neutral",
};

export default function TefcoStaffPage() {
  const { user: currentUser } = useStaffAuth();
  const queryClient = useQueryClient();

  const { data: members, isLoading } = useQuery<StaffMember[]>({
    queryKey: ["/api/staff/users"],
    queryFn: () => staffFetch("/api/staff/users"),
  });

  const createMutation = useMutation({
    mutationFn: (data: object) => staffFetch("/api/staff/users", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/staff/users"] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; [k: string]: any }) =>
      staffFetch(`/api/staff/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/staff/users"] }),
  });

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "staff" });
  const [showPw, setShowPw] = useState(false);
  const [createError, setCreateError] = useState("");
  const [resetingId, setResetingId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const isSuperAdmin = currentUser?.role === "super_admin";

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    try {
      await createMutation.mutateAsync(form);
      setShowModal(false);
      setForm({ name: "", email: "", password: "", role: "staff" });
    } catch (err: any) {
      setCreateError(err.message);
    }
  };

  const handleToggleActive = (member: StaffMember) => {
    updateMutation.mutate({ id: member.id, isActive: !member.isActive });
  };

  const handleResetPassword = (id: number) => {
    if (!newPassword || newPassword.length < 6) return;
    updateMutation.mutate({ id, password: newPassword }, {
      onSuccess: () => { setResetingId(null); setNewPassword(""); }
    });
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Tefco Staff"
        description="Internal staff accounts with access to HukuPlus Central. Retailer and store users are managed under each Retailer."
        action={isSuperAdmin ? (
          <GradientButton onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4" /> Add Staff Member
          </GradientButton>
        ) : undefined}
      />

      <GlassCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center animate-pulse text-muted-foreground">Loading staff...</div>
        ) : (
          <div className="divide-y divide-white/5">
            {members?.map(member => (
              <div key={member.id} className={`p-5 flex items-start justify-between gap-4 transition-opacity ${member.isActive ? "" : "opacity-50"}`}>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/30 to-accent/20 border border-white/10 flex items-center justify-center shrink-0">
                    <span className="text-primary font-bold text-lg">{member.name[0]?.toUpperCase()}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-white">{member.name}</h3>
                      {member.id === currentUser?.staffUserId && (
                        <span className="text-xs text-muted-foreground">(you)</span>
                      )}
                      {!member.isActive && <Badge status="neutral">Inactive</Badge>}
                      {member.mustChangePassword && <Badge status="warning">Temp Password</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{member.email}</p>
                    <div className="mt-1">
                      <Badge status={ROLE_COLORS[member.role]}>
                        {ROLE_LABELS[member.role] ?? member.role}
                      </Badge>
                    </div>
                  </div>
                </div>

                {isSuperAdmin && member.id !== currentUser?.staffUserId && (
                  <div className="flex items-center gap-2 shrink-0 pt-1">
                    <button
                      onClick={() => { setResetingId(resetingId === member.id ? null : member.id); setNewPassword(""); }}
                      title="Reset password"
                      className="p-2 rounded-lg text-muted-foreground hover:text-amber-400 hover:bg-white/5 transition-colors"
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleToggleActive(member)}
                      title={member.isActive ? "Deactivate" : "Reactivate"}
                      className={`p-2 rounded-lg hover:bg-white/5 transition-colors ${member.isActive ? "text-muted-foreground hover:text-red-400" : "text-muted-foreground hover:text-green-400"}`}
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Reset password inline row */}
            <AnimatePresence>
              {resetingId && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden bg-black/20 border-t border-white/5"
                >
                  <div className="px-5 py-4 flex items-center gap-3">
                    <p className="text-sm text-muted-foreground shrink-0">New password for {members?.find(m => m.id === resetingId)?.name}:</p>
                    <div className="relative flex-1">
                      <input
                        type={showPw ? "text" : "password"}
                        placeholder="Min 6 characters"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-white/5 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary pr-9"
                      />
                      <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white">
                        {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <GradientButton onClick={() => handleResetPassword(resetingId!)} isLoading={updateMutation.isPending} className="py-2 px-3 text-xs whitespace-nowrap">
                      <RefreshCw className="w-3.5 h-3.5" /> Set Password
                    </GradientButton>
                    <button onClick={() => setResetingId(null)} className="text-xs text-muted-foreground hover:text-white transition-colors px-2">Cancel</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {members?.length === 0 && (
              <div className="p-10 text-center text-muted-foreground">No staff members found.</div>
            )}
          </div>
        )}
      </GlassCard>

      {/* Add Staff Modal */}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setCreateError(""); }} title="Add Tefco Staff Member">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label>Full Name</Label>
            <Input required placeholder="e.g. Tendai Ncube" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Email Address</Label>
            <Input required type="email" placeholder="staff@tefcofinance.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <Label>Role</Label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="w-full rounded-md border border-white/10 bg-card text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
            </select>
          </div>
          <div>
            <Label>Temporary Password</Label>
            <div className="relative">
              <Input
                required
                type={showPw ? "text" : "password"}
                placeholder="Min 6 characters"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                minLength={6}
              />
              <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">They will be prompted to change this on first login.</p>
          </div>

          {createError && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{createError}</p>
          )}

          <div className="pt-2 flex justify-end gap-3">
            <button type="button" onClick={() => { setShowModal(false); setCreateError(""); }} className="px-4 py-2 text-sm text-muted-foreground hover:text-white transition-colors">Cancel</button>
            <GradientButton type="submit" isLoading={createMutation.isPending}>Add Member</GradientButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
