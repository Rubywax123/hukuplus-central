import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, GlassCard } from "@/components/ui-extras";
import { ExternalLink, Wifi, WifiOff, Key, RefreshCw, ChevronRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import hukuplusFlyer from "@assets/HukuPlusWhatsapp_1773897032482.jpg";
import revolverFlyer from "@assets/RevolverWhatsapp_1773897032483.PNG";
import chikweretiFlyer from "@assets/ChikweretiOneWhatsapp_1773897032481.jpg";

const flyerMap: Record<string, string> = {
  hukuplus: hukuplusFlyer,
  revolver: revolverFlyer,
  chikweretion: chikweretiFlyer,
};

const colorMap: Record<string, { badge: string; ring: string; glow: string; dot: string }> = {
  orange: {
    badge: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    ring: "border-orange-500/30 hover:border-orange-400/60",
    glow: "bg-orange-500",
    dot: "bg-orange-400",
  },
  blue: {
    badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    ring: "border-blue-500/30 hover:border-blue-400/60",
    glow: "bg-blue-500",
    dot: "bg-blue-400",
  },
  gold: {
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    ring: "border-amber-500/30 hover:border-amber-400/60",
    glow: "bg-amber-500",
    dot: "bg-amber-400",
  },
};

interface LoanApp {
  id: string;
  name: string;
  description: string;
  url: string;
  product: string;
  color: string;
  hasApiKey: boolean;
  status: "connected" | "api_key_required";
}

function PingButton({ appId }: { appId: string }) {
  const [pinging, setPinging] = useState(false);
  const [result, setResult] = useState<{ status: string; httpStatus?: number } | null>(null);

  const ping = async () => {
    setPinging(true);
    setResult(null);
    try {
      const res = await fetch(`/api/integrations/apps/${appId}/ping`);
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ status: "unreachable" });
    } finally {
      setPinging(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={ping}
        disabled={pinging}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-50 text-muted-foreground hover:text-foreground"
      >
        {pinging ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Ping
      </button>
      {result && (
        <span className={cn("text-xs font-medium", result.status === "ok" ? "text-emerald-400" : result.status === "unauthorized" ? "text-amber-400" : "text-red-400")}>
          {result.status === "ok" ? "Reachable ✓" : result.status === "unauthorized" ? "Needs API Key" : "Unreachable"}
          {result.httpStatus ? ` (${result.httpStatus})` : ""}
        </span>
      )}
    </div>
  );
}

export default function LoanAppsPage() {
  const { data: apps, isLoading } = useQuery<LoanApp[]>({
    queryKey: ["integrations-apps"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/apps");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  return (
    <div className="pb-10">
      <PageHeader
        title="Loan Apps"
        description="Quick access to all three Tefco Finance loan products. Connect via API key for live data sync."
      />

      {isLoading && (
        <div className="flex items-center justify-center h-48 text-muted-foreground animate-pulse">
          Loading apps...
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {apps?.map((app, i) => {
          const colors = colorMap[app.color] ?? colorMap.blue;
          const flyer = flyerMap[app.id];
          return (
            <motion.div
              key={app.id}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <GlassCard
                className={cn("overflow-hidden border transition-all duration-300 cursor-default", colors.ring)}
              >
                {/* Flyer thumbnail */}
                <div className="relative h-48 overflow-hidden">
                  <img
                    src={flyer}
                    alt={`${app.name} flyer`}
                    className="w-full h-full object-cover object-top"
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-card/90" />
                  {/* Status badge */}
                  <div className="absolute top-3 right-3">
                    <span className={cn("flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border backdrop-blur-sm", colors.badge)}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", app.hasApiKey ? "bg-emerald-400" : colors.dot)} />
                      {app.hasApiKey ? "API Connected" : "No API Key"}
                    </span>
                  </div>
                </div>

                <div className="p-5">
                  <h3 className="text-lg font-bold text-white mb-1">{app.name}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">{app.description}</p>

                  <div className="flex items-center justify-between">
                    <PingButton appId={app.id} />
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all",
                        colors.badge,
                        "hover:opacity-90"
                      )}
                    >
                      Open App
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          );
        })}
      </div>

      {/* API Key Instructions */}
      <GlassCard className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 shrink-0">
            <Key className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-white mb-1">Enable Live Data Sync</h3>
            <p className="text-sm text-muted-foreground mb-4">
              To pull live loan data from each app into HukuPlusCentral, each loan app needs a small update to accept a trusted API key. Once an API key is added to each app, set the corresponding secret here and data will flow automatically.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { env: "HUKUPLUS_API_KEY", label: "HukuPlus API Key", color: "text-orange-400" },
                { env: "REVOLVER_API_KEY", label: "Revolver API Key", color: "text-blue-400" },
                { env: "CHIKWERETION_API_KEY", label: "ChikweretiOne API Key", color: "text-amber-400" },
              ].map((item) => (
                <div
                  key={item.env}
                  className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10"
                >
                  <ChevronRight className={cn("w-4 h-4 shrink-0", item.color)} />
                  <div>
                    <p className="text-xs font-medium text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground font-mono">{item.env}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
