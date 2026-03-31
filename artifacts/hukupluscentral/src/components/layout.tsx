import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useStaffAuth } from "@/hooks/useStaffAuth";
import { LayoutDashboard, Store, FileSignature, Users, LogOut, Loader2, Zap, AppWindow, Eye, EyeOff, ShieldCheck, KeyRound, ContactRound, CheckCircle2, AlertCircle, ClipboardList, Bell } from "lucide-react";
import hukuplusLogo from "@assets/Chicken_on_a_pile_of_gold_coins_1773914874504.png";
import { motion, AnimatePresence } from "framer-motion";
import { useLoanApp, LOAN_APPS } from "@/contexts/LoanAppContext";
import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/customers", label: "Customers", icon: ContactRound },
  { path: "/retailers", label: "Retailers", icon: Store },
  { path: "/agreements", label: "Agreements", icon: FileSignature },
  { path: "/applications", label: "Requests", icon: ClipboardList },
  { path: "/notifications", label: "Notifications", icon: Bell, badge: true },
  { path: "/loan-apps", label: "Loan Apps", icon: AppWindow },
  { path: "/team", label: "Tefco Staff", icon: Users },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Principal Admin",
  admin: "Admin",
  staff: "Staff",
};

// ─── Change Password Modal ────────────────────────────────────────────────────

function ChangePasswordModal({ onSuccess }: { onSuccess: () => void }) {
  const { changePassword, isChangingPassword, changePasswordError } = useStaffAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [localError, setLocalError] = useState("");

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    if (next !== confirm) { setLocalError("Passwords do not match"); return; }
    if (next.length < 6) { setLocalError("Password must be at least 6 characters"); return; }
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      onSuccess();
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-card border border-white/10 rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Set Your Password</h2>
            <p className="text-xs text-muted-foreground">Please choose a permanent password to continue.</p>
          </div>
        </div>

        <form onSubmit={handle} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Current / Temporary Password</label>
            <div className="relative">
              <input
                required type={showPw ? "text" : "password"} value={current} onChange={e => setCurrent(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary pr-9"
              />
              <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">New Password</label>
            <input
              required type={showPw ? "text" : "password"} value={next} onChange={e => setNext(e.target.value)} minLength={6}
              className="w-full rounded-lg border border-white/10 bg-white/5 text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Confirm New Password</label>
            <input
              required type={showPw ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} minLength={6}
              className="w-full rounded-lg border border-white/10 bg-white/5 text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {(localError || changePasswordError) && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {localError || changePasswordError}
            </p>
          )}

          <button
            type="submit"
            disabled={isChangingPassword}
            className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {isChangingPassword ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Set Password & Continue"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ─── App Switcher ─────────────────────────────────────────────────────────────

function AppSwitcher() {
  const { activeApp, activeAppConfig, setActiveApp } = useLoanApp();

  return (
    <div className="px-4 mb-2">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold px-1 mb-2">Active Business</p>
      <div className="space-y-1">
        {LOAN_APPS.map(app => {
          const isActive = activeApp === app.id;
          return (
            <button
              key={app.id}
              onClick={() => setActiveApp(app.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 text-left ${
                isActive
                  ? `${app.bg} ${app.border} ${app.text}`
                  : "border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? app.dot : "bg-white/20"}`} />
              <div className="overflow-hidden">
                <p className={`text-sm font-semibold truncate ${isActive ? app.text : ""}`}>{app.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{app.subtitle}</p>
              </div>
              {isActive && (
                <motion.div
                  layoutId="app-switcher-indicator"
                  className={`ml-auto w-1.5 h-1.5 rounded-full ${app.dot}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Active App Banner ─────────────────────────────────────────────────────────

function ActiveAppBanner() {
  const { activeAppConfig } = useLoanApp();
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${activeAppConfig.bg} ${activeAppConfig.border} mb-4`}>
      <div className={`w-2 h-2 rounded-full ${activeAppConfig.dot} shrink-0`} />
      <span className={`text-xs font-semibold ${activeAppConfig.text}`}>{activeAppConfig.label}</span>
      <span className="text-xs text-muted-foreground">— {activeAppConfig.subtitle}</span>
    </div>
  );
}

export { ActiveAppBanner };

// ─── Xero Status Widget ───────────────────────────────────────────────────────

function XeroStatusWidget() {
  const { data } = useQuery<{ connected: boolean; tenantName?: string }>({
    queryKey: ["xero-status"],
    queryFn: () => fetch(`${BASE}/api/xero/status`, { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
    retry: false,
  });

  if (!data) return null;

  return (
    <div className="px-4 mb-3">
      <div className="h-px bg-white/5 mb-3" />
      {data.connected ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-emerald-400 truncate">Xero Connected</p>
            {data.tenantName && <p className="text-[10px] text-muted-foreground truncate">{data.tenantName}</p>}
          </div>
        </div>
      ) : (
        <a
          href={`${BASE}/api/xero/auth`}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-colors cursor-pointer"
        >
          <AlertCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Xero not connected</p>
            <p className="text-[10px] text-primary">Click to connect</p>
          </div>
        </a>
      )}
    </div>
  );
}

// ─── Internal Layout ──────────────────────────────────────────────────────────

export function InternalLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useStaffAuth();
  const { activeAppConfig } = useLoanApp();

  const { data: notifCounts } = useQuery<{ newTotal: number }>({
    queryKey: ["notification-counts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/formitize/notifications/counts`, { credentials: "include" });
      if (!r.ok) return { newTotal: 0 };
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const unreadCount = notifCounts?.newTotal ?? 0;

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-72 hidden lg:flex flex-col border-r border-white/5 bg-card/30 backdrop-blur-2xl">
        <div className="p-6 pb-4 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${activeAppConfig.gradient} flex items-center justify-center shadow-lg transition-all duration-300`}>
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight text-gradient">HukuPlus</h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Central Command</p>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${activeAppConfig.bg} ${activeAppConfig.border}`}>
            <div className={`w-2 h-2 rounded-full ${activeAppConfig.dot} shrink-0 animate-pulse`} />
            <div>
              <p className={`text-xs font-bold ${activeAppConfig.text}`}>{activeAppConfig.label}</p>
              <p className="text-[10px] text-muted-foreground">{activeAppConfig.subtitle}</p>
            </div>
          </div>
        </div>

        <div className="h-px bg-white/5 mx-4 mb-3" />

        <AppSwitcher />

        <div className="h-px bg-white/5 mx-4 my-3" />

        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            const badgeCount = item.badge ? unreadCount : 0;
            return (
              <Link key={item.path} href={item.path} className="block">
                <div className={`
                  flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200
                  ${isActive
                    ? `${activeAppConfig.bg} ${activeAppConfig.text} border ${activeAppConfig.border}`
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent"}
                `}>
                  <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? activeAppConfig.text : ""}`} />
                  <span className="font-medium text-sm flex-1">{item.label}</span>
                  {badgeCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-[10px] font-bold text-black">
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        <XeroStatusWidget />

        <div className="p-6 border-t border-white/5">
          <div className="flex items-center gap-3 px-2 mb-4">
            <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${activeAppConfig.gradient} flex items-center justify-center shrink-0 transition-all duration-300`}>
              <span className="text-white font-bold text-sm">
                {user?.name?.[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-semibold truncate text-white">{user?.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <ShieldCheck className={`w-3 h-3 ${activeAppConfig.text} shrink-0`} />
                <p className={`text-xs ${activeAppConfig.text} font-medium truncate`}>{ROLE_LABELS[user?.role ?? ""] ?? user?.role}</p>
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-destructive transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden p-4 border-b border-white/5 bg-card/50 backdrop-blur-xl flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${activeAppConfig.gradient} flex items-center justify-center transition-all duration-300`}>
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-display font-bold text-base text-gradient">HukuPlus Central</h1>
            </div>
          </div>
          <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${activeAppConfig.bg} ${activeAppConfig.border}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${activeAppConfig.dot}`} />
            <span className={`text-xs font-semibold ${activeAppConfig.text}`}>{activeAppConfig.label}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-10 relative">
          <div className={`absolute top-0 left-1/4 w-96 h-96 blur-[120px] rounded-full pointer-events-none opacity-20 ${activeAppConfig.dot} transition-all duration-700`} />
          <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-accent/10 blur-[120px] rounded-full pointer-events-none" />
          <div className="relative z-10 max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Auth Guard ───────────────────────────────────────────────────────────────

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, login, loginError, isLoggingIn, user } = useStaffAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwChanged, setPwChanged] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await login({ email, password }); } catch {}
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground animate-pulse">Initializing Central Command...</p>
      </div>
    );
  }

  if (isAuthenticated && user?.mustChangePassword && !pwChanged) {
    return <ChangePasswordModal onSuccess={() => setPwChanged(true)} />;
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-4">
        <img
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
          alt="Background"
          className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-screen"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-md p-8 glass-panel border border-white/10 rounded-3xl shadow-2xl"
        >
          <div className="text-center mb-8">
            <div className="w-36 h-36 mx-auto mb-3">
              <img
                src={hukuplusLogo}
                alt="HukuPlus"
                className="w-full h-full object-contain"
                style={{ mixBlendMode: "screen" }}
              />
            </div>
            <h1 className="text-3xl font-display font-bold text-white mb-1">HukuPlus Central</h1>
            <p className="text-muted-foreground text-sm">Tefco Finance — Command Dashboard</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Email Address</label>
              <input
                required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@tefcofinance.com"
                className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">Password</label>
              <div className="relative">
                <input
                  required type={showPw ? "text" : "password"} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-white/10 bg-white/5 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/50 pr-11"
                />
                <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {loginError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2"
                >
                  {loginError}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-3.5 rounded-xl transition-colors shadow-xl shadow-primary/20 disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
            >
              {isLoggingIn ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : "Sign In"}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return <InternalLayout>{children}</InternalLayout>;
}
