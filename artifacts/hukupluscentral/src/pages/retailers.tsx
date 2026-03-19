import React, { useState } from "react";
import { useListRetailers, useCreateRetailer, useListBranches, useCreateBranch } from "@workspace/api-client-react";
import { PageHeader, GlassCard, GradientButton, Badge, Modal, Input, Label } from "@/components/ui-extras";
import { Plus, Building, MapPin, Users, ShieldCheck, Store, KeyRound, UserX, RefreshCw, ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { customFetch } from "@workspace/api-client-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type PortalUser = {
  id: number;
  name: string;
  email: string;
  role: "retailer_admin" | "store_staff";
  retailerId: number;
  branchId: number | null;
  branchName: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

// ─── Portal User Hooks ───────────────────────────────────────────────────────

function usePortalUsers(retailerId: number) {
  return useQuery<PortalUser[]>({
    queryKey: [`/api/portal/users`, retailerId],
    queryFn: () => customFetch(`/api/portal/users?retailerId=${retailerId}`),
  });
}

function useCreatePortalUser() {
  return useMutation({
    mutationFn: (data: { name: string; email: string; password: string; retailerId: number; branchId?: number | null; role: string }) =>
      customFetch("/api/portal/users", { method: "POST", body: JSON.stringify(data) }),
  });
}

function useUpdatePortalUser() {
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; isActive?: boolean; password?: string; name?: string }) =>
      customFetch(`/api/portal/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  });
}

// ─── Branches Panel ───────────────────────────────────────────────────────────

function BranchesPanel({ retailerId }: { retailerId: number }) {
  const { data: branches, isLoading } = useListBranches(retailerId);
  const queryClient = useQueryClient();
  const createMutation = useCreateBranch();
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ retailerId, data: { name, location } }, {
      onSuccess: () => {
        setIsAdding(false);
        setName("");
        setLocation("");
        queryClient.invalidateQueries({ queryKey: [`/api/retailers/${retailerId}/branches`] });
        queryClient.invalidateQueries({ queryKey: [`/api/retailers`] });
      }
    });
  };

  if (isLoading) return <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">Loading branches...</div>;

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Store Locations</p>
        <button onClick={() => setIsAdding(!isAdding)} className="text-xs text-primary hover:text-white flex items-center gap-1 transition-colors">
          <Plus className="w-3 h-3" /> Add Branch
        </button>
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.form
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            onSubmit={handleAdd}
            className="flex gap-3 mb-4 bg-white/5 p-3 rounded-lg border border-white/10 overflow-hidden"
          >
            <Input placeholder="Branch Name" value={name} onChange={e => setName(e.target.value)} required className="py-2 text-sm" />
            <Input placeholder="Location / City" value={location} onChange={e => setLocation(e.target.value)} className="py-2 text-sm" />
            <GradientButton type="submit" isLoading={createMutation.isPending} className="py-2 whitespace-nowrap text-sm">Save</GradientButton>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {branches?.map(b => (
          <div key={b.id} className="bg-white/5 border border-white/10 p-3 rounded-lg flex items-center gap-3">
            <div className="p-2 bg-white/5 rounded-md text-primary"><MapPin className="w-4 h-4" /></div>
            <div>
              <p className="text-sm font-medium text-white">{b.name}</p>
              {b.location && <p className="text-xs text-muted-foreground mt-0.5">{b.location}</p>}
            </div>
          </div>
        ))}
        {branches?.length === 0 && !isAdding && (
          <p className="text-sm text-muted-foreground italic col-span-full">No branches yet. Add one above.</p>
        )}
      </div>
    </div>
  );
}

// ─── Portal Access Panel ──────────────────────────────────────────────────────

function PortalAccessPanel({ retailerId, retailerName }: { retailerId: number; retailerName: string }) {
  const { data: branches } = useListBranches(retailerId);
  const { data: users, isLoading, refetch } = usePortalUsers(retailerId);
  const createMutation = useCreatePortalUser();
  const updateMutation = useUpdatePortalUser();
  const [showModal, setShowModal] = useState(false);
  const [resetingId, setResetingId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  // Form state
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "retailer_admin", branchId: "" });

  const admins = users?.filter(u => u.role === "retailer_admin") ?? [];
  const staff = users?.filter(u => u.role === "store_staff") ?? [];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: form.name,
      email: form.email,
      password: form.password,
      retailerId,
      role: form.role,
      branchId: form.role === "store_staff" && form.branchId ? parseInt(form.branchId) : null,
    }, {
      onSuccess: () => {
        setShowModal(false);
        setForm({ name: "", email: "", password: "", role: "retailer_admin", branchId: "" });
        refetch();
      }
    });
  };

  const handleToggleActive = (user: PortalUser) => {
    updateMutation.mutate({ id: user.id, isActive: !user.isActive }, { onSuccess: () => refetch() });
  };

  const handleResetPassword = (id: number) => {
    if (!newPassword.trim() || newPassword.length < 6) return;
    updateMutation.mutate({ id, password: newPassword }, {
      onSuccess: () => { setResetingId(null); setNewPassword(""); refetch(); }
    });
  };

  if (isLoading) return <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">Loading portal users...</div>;

  return (
    <div className="p-5 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Portal Access Accounts</p>
        <GradientButton onClick={() => setShowModal(true)} className="py-1.5 px-3 text-xs">
          <Plus className="w-3 h-3" /> Add User
        </GradientButton>
      </div>

      {/* Retailer Admins */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-amber-400">Retailer Admins</span>
          <span className="text-xs text-muted-foreground">(see all branches & accounts)</span>
        </div>
        {admins.length === 0 ? (
          <p className="text-sm text-muted-foreground italic pl-6">No admin accounts yet.</p>
        ) : (
          <div className="space-y-2">
            {admins.map(u => (
              <UserRow
                key={u.id}
                user={u}
                isResetting={resetingId === u.id}
                newPassword={resetingId === u.id ? newPassword : ""}
                showPw={showPw}
                onTogglePwVis={() => setShowPw(p => !p)}
                onToggleActive={() => handleToggleActive(u)}
                onStartReset={() => { setResetingId(u.id); setNewPassword(""); }}
                onCancelReset={() => setResetingId(null)}
                onNewPasswordChange={setNewPassword}
                onSavePassword={() => handleResetPassword(u.id)}
                isSaving={updateMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Store Staff */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Store className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-blue-400">Store Staff</span>
          <span className="text-xs text-muted-foreground">(see only their branch)</span>
        </div>
        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground italic pl-6">No store staff accounts yet.</p>
        ) : (
          <div className="space-y-2">
            {staff.map(u => (
              <UserRow
                key={u.id}
                user={u}
                isResetting={resetingId === u.id}
                newPassword={resetingId === u.id ? newPassword : ""}
                showPw={showPw}
                onTogglePwVis={() => setShowPw(p => !p)}
                onToggleActive={() => handleToggleActive(u)}
                onStartReset={() => { setResetingId(u.id); setNewPassword(""); }}
                onCancelReset={() => setResetingId(null)}
                onNewPasswordChange={setNewPassword}
                onSavePassword={() => handleResetPassword(u.id)}
                isSaving={updateMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create User Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={`Add Portal User — ${retailerName}`}>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label>Full Name</Label>
            <Input required placeholder="e.g. Tendai Moyo" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Email Address</Label>
            <Input required type="email" placeholder="tendai@novafeeds.co.zw" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <Label>Role</Label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value, branchId: "" }))}
              className="w-full rounded-md border border-white/10 bg-card text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="retailer_admin">Retailer Admin — sees all branches</option>
              <option value="store_staff">Store Staff — sees one branch only</option>
            </select>
          </div>
          {form.role === "store_staff" && (
            <div>
              <Label>Assign Branch</Label>
              <select
                required
                value={form.branchId}
                onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}
                className="w-full rounded-md border border-white/10 bg-card text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select a branch...</option>
                {branches?.map(b => (
                  <option key={b.id} value={b.id}>{b.name}{b.location ? ` — ${b.location}` : ""}</option>
                ))}
              </select>
            </div>
          )}
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
            <p className="text-xs text-muted-foreground mt-1">User will be prompted to change this on first login.</p>
          </div>
          <div className="pt-2 flex justify-end gap-3">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-white transition-colors">Cancel</button>
            <GradientButton type="submit" isLoading={createMutation.isPending}>Create Account</GradientButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── User Row ─────────────────────────────────────────────────────────────────

type UserRowProps = {
  user: PortalUser;
  isResetting: boolean;
  newPassword: string;
  showPw: boolean;
  onTogglePwVis: () => void;
  onToggleActive: () => void;
  onStartReset: () => void;
  onCancelReset: () => void;
  onNewPasswordChange: (v: string) => void;
  onSavePassword: () => void;
  isSaving: boolean;
};

function UserRow({ user, isResetting, newPassword, showPw, onTogglePwVis, onToggleActive, onStartReset, onCancelReset, onNewPasswordChange, onSavePassword, isSaving }: UserRowProps) {
  return (
    <div className={`rounded-lg border px-4 py-3 transition-colors ${user.isActive ? "bg-white/5 border-white/10" : "bg-white/[0.02] border-white/5 opacity-60"}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white truncate">{user.name}</span>
            {!user.isActive && <Badge status="neutral">Inactive</Badge>}
            {user.mustChangePassword && <Badge status="warning">Temp Password</Badge>}
            {user.branchName && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" />{user.branchName}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onStartReset}
            title="Reset password"
            className="p-1.5 rounded-md text-muted-foreground hover:text-amber-400 hover:bg-white/5 transition-colors"
          >
            <KeyRound className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleActive}
            title={user.isActive ? "Deactivate" : "Reactivate"}
            className={`p-1.5 rounded-md hover:bg-white/5 transition-colors ${user.isActive ? "text-muted-foreground hover:text-red-400" : "text-muted-foreground hover:text-green-400"}`}
          >
            <UserX className="w-4 h-4" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isResetting && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mt-3"
          >
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Input
                  type={showPw ? "text" : "password"}
                  placeholder="New password (min 6 chars)"
                  value={newPassword}
                  onChange={e => onNewPasswordChange(e.target.value)}
                  className="py-1.5 text-sm pr-9"
                />
                <button type="button" onClick={onTogglePwVis} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white">
                  {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <GradientButton onClick={onSavePassword} isLoading={isSaving} className="py-1.5 px-3 text-xs whitespace-nowrap">
                <RefreshCw className="w-3.5 h-3.5" /> Set Password
              </GradientButton>
              <button onClick={onCancelReset} className="text-xs text-muted-foreground hover:text-white px-2 transition-colors">Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RetailersPage() {
  const { data: retailers, isLoading } = useListRetailers();
  const queryClient = useQueryClient();
  const createMutation = useCreateRetailer();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Record<number, "branches" | "portal">>({}); 

  const [name, setName] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ data: { name } }, {
      onSuccess: () => {
        setIsModalOpen(false);
        setName("");
        queryClient.invalidateQueries({ queryKey: [`/api/retailers`] });
      }
    });
  };

  const getTab = (id: number) => activeTab[id] ?? "branches";
  const setTab = (id: number, tab: "branches" | "portal") => setActiveTab(prev => ({ ...prev, [id]: tab }));

  return (
    <div className="pb-10">
      <PageHeader
        title="Retailers Directory"
        description="Manage partner stores, branch networks, and portal access accounts."
        action={<GradientButton onClick={() => setIsModalOpen(true)}><Plus className="w-4 h-4" /> New Retailer</GradientButton>}
      />

      <GlassCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center animate-pulse text-muted-foreground">Loading directory...</div>
        ) : (
          <div className="divide-y divide-white/5">
            {retailers?.map((r) => {
              const isExpanded = expandedId === r.id;
              const tab = getTab(r.id);
              return (
                <div key={r.id} className="group">
                  {/* Retailer Header Row */}
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="p-5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-white/5 to-white/10 border border-white/10 flex items-center justify-center">
                        <Building className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg text-white">{r.name}</h3>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {r.branchCount ?? 0} {r.branchCount === 1 ? "branch" : "branches"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge status={r.isActive ? "success" : "neutral"}>{r.isActive ? "Active" : "Inactive"}</Badge>
                      <button className="p-2 text-muted-foreground group-hover:text-white transition-colors">
                        {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Panel */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-white/5 bg-black/20"
                      >
                        {/* Tab Bar */}
                        <div className="flex border-b border-white/5">
                          <button
                            onClick={() => setTab(r.id, "branches")}
                            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors ${tab === "branches" ? "text-white border-b-2 border-primary" : "text-muted-foreground hover:text-white"}`}
                          >
                            <MapPin className="w-4 h-4" /> Branches
                          </button>
                          <button
                            onClick={() => setTab(r.id, "portal")}
                            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors ${tab === "portal" ? "text-white border-b-2 border-primary" : "text-muted-foreground hover:text-white"}`}
                          >
                            <Users className="w-4 h-4" /> Portal Access
                          </button>
                        </div>

                        {/* Tab Content */}
                        {tab === "branches" ? (
                          <BranchesPanel retailerId={r.id} />
                        ) : (
                          <PortalAccessPanel retailerId={r.id} retailerName={r.name} />
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            {retailers?.length === 0 && (
              <div className="p-10 text-center text-muted-foreground">No retailers found. Add one to get started.</div>
            )}
          </div>
        )}
      </GlassCard>

      {/* New Retailer Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Register New Retailer">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label>Retailer Name</Label>
            <Input required placeholder="e.g. Novafeeds Ltd" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-white transition-colors">Cancel</button>
            <GradientButton type="submit" isLoading={createMutation.isPending}>Create Retailer</GradientButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
