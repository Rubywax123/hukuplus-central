import React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { LayoutDashboard, Store, FileSignature, Users, LogOut, Loader2, Zap } from "lucide-react";
import { motion } from "framer-motion";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/retailers", label: "Retailers", icon: Store },
  { path: "/agreements", label: "Agreements", icon: FileSignature },
  { path: "/team", label: "Team", icon: Users },
];

export function InternalLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-72 hidden lg:flex flex-col border-r border-white/5 bg-card/30 backdrop-blur-2xl">
        <div className="p-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight text-gradient">HukuPlus</h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Central Command</p>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {navItems.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            return (
              <Link key={item.path} href={item.path} className="block">
                <div className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                  ${isActive 
                    ? "bg-primary/10 text-primary border border-primary/20 shadow-inner" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent"}
                `}>
                  <item.icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
                  <span className="font-medium text-sm">{item.label}</span>
                  {isActive && (
                    <motion.div layoutId="sidebar-indicator" className="absolute left-0 w-1 h-8 bg-primary rounded-r-full" />
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-6 border-t border-white/5">
          <div className="flex items-center gap-3 px-2 mb-6">
            <div className="w-10 h-10 rounded-full bg-secondary overflow-hidden border border-white/10">
              {user?.profileImageUrl ? (
                <img src={user.profileImageUrl} alt="User" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-primary font-bold">
                  {user?.firstName?.[0] || "U"}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-semibold truncate text-white">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-destructive transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="lg:hidden p-4 border-b border-white/5 bg-card/50 backdrop-blur-xl flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-display font-bold text-lg text-gradient">HukuPlus</h1>
          </div>
          <button onClick={logout} className="p-2 text-muted-foreground hover:text-destructive rounded-lg hover:bg-white/5">
            <LogOut className="w-5 h-5" />
          </button>
        </header>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-10 relative">
          {/* Subtle background glow */}
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
          <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-accent/10 blur-[120px] rounded-full pointer-events-none" />
          
          <div className="relative z-10 max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, login } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground animate-pulse">Initializing Central Command...</p>
      </div>
    );
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
          className="relative z-10 w-full max-w-md p-8 glass-panel border border-white/10 rounded-3xl text-center shadow-2xl"
        >
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary to-accent p-0.5 shadow-2xl shadow-primary/30">
            <div className="w-full h-full bg-card rounded-[14px] flex items-center justify-center">
              <Zap className="w-10 h-10 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">HukuPlus Central</h1>
          <p className="text-muted-foreground mb-8">Secure portal for team members. Sign in to access the command dashboard.</p>
          
          <button 
            onClick={login}
            className="w-full bg-white text-black font-semibold py-3.5 px-4 rounded-xl hover:bg-white/90 transition-colors shadow-xl shadow-white/10"
          >
            Sign in with Replit
          </button>
        </motion.div>
      </div>
    );
  }

  return <InternalLayout>{children}</InternalLayout>;
}
