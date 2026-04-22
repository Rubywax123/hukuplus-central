import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { PageHeader, GlassCard } from "@/components/ui-extras";
import { KeyRound, Eye, EyeOff, Copy, Check, AlertTriangle, Server } from "lucide-react";
import { motion } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ApiKey {
  name: string;
  description: string;
  header: string;
  envVar: string;
  value: string | null;
}

// ─── Single Key Card ─────────────────────────────────────────────────────────

function ApiKeyCard({ apiKey }: { apiKey: ApiKey }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!apiKey.value) return;
    await navigator.clipboard.writeText(apiKey.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <GlassCard className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <KeyRound className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{apiKey.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{apiKey.description}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Header</span>
          <code className="text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5 text-amber-300">{apiKey.header}</code>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Env Var</span>
          <code className="text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5 text-blue-300">{apiKey.envVar}</code>
        </div>
      </div>

      {apiKey.value ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 flex items-center gap-3">
          <code className="flex-1 text-sm text-white font-mono break-all select-all">
            {revealed ? apiKey.value : "•".repeat(Math.min(apiKey.value.length, 40))}
          </code>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setRevealed(r => !r)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
              title={revealed ? "Hide" : "Reveal"}
            >
              {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
              title="Copy to clipboard"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 flex items-center gap-2 text-orange-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Not configured — this environment variable is not set on the server.</span>
        </div>
      )}
    </GlassCard>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data, isLoading, error } = useQuery<{ keys: ApiKey[] }>({
    queryKey: ["admin-api-keys"],
    queryFn: () => customFetch(`${BASE}/api/admin/api-keys`),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="System configuration and API keys for inter-app communication."
      />

      <section className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">External API Keys</h2>
        </div>

        <p className="text-sm text-muted-foreground max-w-2xl">
          These keys authenticate external apps that connect to HukuPlusCentral. Share them securely with the developers of those apps — treat them like passwords.
        </p>

        {isLoading && (
          <div className="space-y-4">
            {[0, 1].map(i => (
              <GlassCard key={i} className="p-6 animate-pulse">
                <div className="h-4 bg-white/10 rounded w-1/3 mb-3" />
                <div className="h-3 bg-white/5 rounded w-2/3" />
              </GlassCard>
            ))}
          </div>
        )}

        {error && (
          <GlassCard className="p-6">
            <p className="text-sm text-red-400">Failed to load API keys. Make sure you are logged in as Principal Admin.</p>
          </GlassCard>
        )}

        {data && (
          <motion.div
            className="space-y-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {data.keys.map(k => (
              <ApiKeyCard key={k.envVar} apiKey={k} />
            ))}
          </motion.div>
        )}
      </section>
    </div>
  );
}
