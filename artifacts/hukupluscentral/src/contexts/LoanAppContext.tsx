import React, { createContext, useContext, useState, useCallback } from "react";

export type LoanApp = "hukuplus" | "revolver" | "chikwereti";

export const LOAN_APPS = [
  {
    id: "hukuplus" as LoanApp,
    label: "HukuPlus",
    subtitle: "Broiler Feed Loans",
    color: "amber",
    gradient: "from-amber-500 to-yellow-600",
    ring: "ring-amber-500/40",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
    dot: "bg-amber-400",
  },
  {
    id: "revolver" as LoanApp,
    label: "Revolver",
    subtitle: "Layer Feed Wallet",
    color: "blue",
    gradient: "from-blue-500 to-cyan-600",
    ring: "ring-blue-500/40",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/20",
    dot: "bg-blue-400",
  },
  {
    id: "chikwereti" as LoanApp,
    label: "ChikweretiOne",
    subtitle: "Salary / Payroll Loans",
    color: "emerald",
    gradient: "from-emerald-500 to-green-600",
    ring: "ring-emerald-500/40",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
    dot: "bg-emerald-400",
  },
] as const;

type LoanAppContextType = {
  activeApp: LoanApp;
  activeAppConfig: typeof LOAN_APPS[number];
  setActiveApp: (app: LoanApp) => void;
};

const LoanAppContext = createContext<LoanAppContextType | null>(null);

const STORAGE_KEY = "hukuplus_active_app";

export function LoanAppProvider({ children }: { children: React.ReactNode }) {
  const [activeApp, setActiveAppState] = useState<LoanApp>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored as LoanApp) ?? "hukuplus";
  });

  const setActiveApp = useCallback((app: LoanApp) => {
    localStorage.setItem(STORAGE_KEY, app);
    setActiveAppState(app);
  }, []);

  const activeAppConfig = LOAN_APPS.find(a => a.id === activeApp)!;

  return (
    <LoanAppContext.Provider value={{ activeApp, activeAppConfig, setActiveApp }}>
      {children}
    </LoanAppContext.Provider>
  );
}

export function useLoanApp() {
  const ctx = useContext(LoanAppContext);
  if (!ctx) throw new Error("useLoanApp must be used inside LoanAppProvider");
  return ctx;
}
