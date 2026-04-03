import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboardStats, useGetRecentActivity, customFetch } from "@workspace/api-client-react";
import { PageHeader, GlassCard } from "@/components/ui-extras";
import { Store, FileSignature, MapPin, CheckCircle, Clock, UserPlus, RefreshCw, FileCheck } from "lucide-react";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import { motion } from "framer-motion";

interface MonthlyMetrics {
  month: string;
  newApplications: { current: number; previous: number };
  reApplications: { current: number; previous: number };
  agreementsIssued: { current: number; previous: number };
}

function useMonthlyMetrics() {
  return useQuery<MonthlyMetrics>({
    queryKey: ["/api/dashboard/monthly-metrics"],
    queryFn: () => customFetch<MonthlyMetrics>("/api/dashboard/monthly-metrics"),
    refetchInterval: 5 * 60 * 1000,
  });
}

function delta(current: number, previous: number): { label: string; positive: boolean } | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { label: `+${current} vs last month`, positive: true };
  const diff = current - previous;
  if (diff === 0) return { label: "Same as last month", positive: true };
  return { label: `${diff > 0 ? "+" : ""}${diff} vs last month`, positive: diff >= 0 };
}

function MonthlyMetricCard({
  title,
  subtitle,
  value,
  previous,
  icon: Icon,
  colorClass,
  bgClass,
  delay,
}: {
  title: string;
  subtitle: string;
  value: number;
  previous: number;
  icon: any;
  colorClass: string;
  bgClass: string;
  delay: number;
}) {
  const d = delta(value, previous);
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <GlassCard className="p-6 relative overflow-hidden group">
        <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl opacity-20 group-hover:opacity-40 transition-opacity ${bgClass}`} />
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">{subtitle}</p>
          </div>
          <div className={`p-2 rounded-lg bg-white/5 ${colorClass}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <h3 className="text-5xl font-display font-bold text-white mt-2">{value}</h3>
        {d && (
          <p className={`text-xs mt-3 font-medium ${d.positive ? "text-emerald-400" : "text-rose-400"}`}>
            {d.label}
          </p>
        )}
      </GlassCard>
    </motion.div>
  );
}

function StatCard({ title, value, icon: Icon, colorClass, delay }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
    >
      <GlassCard className="p-6 relative overflow-hidden group">
        <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl opacity-20 group-hover:opacity-40 transition-opacity ${colorClass}`} />
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className={`p-2 rounded-lg bg-white/5 ${colorClass}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <h3 className="text-4xl font-display font-bold text-white">{value}</h3>
      </GlassCard>
    </motion.div>
  );
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity();
  const { data: monthly, isLoading: monthlyLoading } = useMonthlyMetrics();

  if (statsLoading || activityLoading || monthlyLoading) {
    return <div className="h-96 flex items-center justify-center animate-pulse text-primary">Loading dashboard data...</div>;
  }

  const monthLabel = monthly?.month ?? new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="pb-10">
      <PageHeader
        title="Overview"
        description="Real-time performance across all loan products and retailers."
      />

      {/* ── Monthly Business Metrics ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.05 }}
        className="mb-2"
      >
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Monthly Totals
          </h2>
          <span className="text-xs text-muted-foreground/50 font-medium">· {monthLabel}</span>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <MonthlyMetricCard
          delay={0.08}
          title="New Applications"
          subtitle="First-time customer applications"
          value={monthly?.newApplications.current ?? 0}
          previous={monthly?.newApplications.previous ?? 0}
          icon={UserPlus}
          colorClass="text-sky-400"
          bgClass="bg-sky-400"
        />
        <MonthlyMetricCard
          delay={0.14}
          title="Re-Applications"
          subtitle="Returning customer applications"
          value={monthly?.reApplications.current ?? 0}
          previous={monthly?.reApplications.previous ?? 0}
          icon={RefreshCw}
          colorClass="text-amber-400"
          bgClass="bg-amber-400"
        />
        <MonthlyMetricCard
          delay={0.20}
          title="Agreements Issued"
          subtitle="Loan agreements generated this month"
          value={monthly?.agreementsIssued.current ?? 0}
          previous={monthly?.agreementsIssued.previous ?? 0}
          icon={FileCheck}
          colorClass="text-emerald-400"
          bgClass="bg-emerald-400"
        />
      </div>

      {/* ── Existing Stats ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <StatCard delay={0.25} title="Total Retailers" value={stats?.totalRetailers || 0} icon={Store} colorClass="text-blue-400 bg-blue-400" />
        <StatCard delay={0.30} title="Active Branches" value={stats?.totalBranches || 0} icon={MapPin} colorClass="text-purple-400 bg-purple-400" />
        <StatCard delay={0.35} title="Pending Signatures" value={stats?.pendingSignatures || 0} icon={Clock} colorClass="text-amber-400 bg-amber-400" />
        <StatCard delay={0.40} title="Signed Today" value={stats?.signedToday || 0} icon={CheckCircle} colorClass="text-emerald-400 bg-emerald-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart */}
        <GlassCard className="p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold mb-6">Agreements by Product</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.loanProducts || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="product" stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} />
                <RechartsTooltip
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  contentStyle={{ backgroundColor: '#18181b', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }} />
                <Bar dataKey="signed" name="Signed" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pending" name="Pending" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Activity Feed */}
        <GlassCard className="p-6 flex flex-col">
          <h3 className="text-lg font-semibold mb-6">Recent Activity</h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-6">
            {!activity?.length && <p className="text-muted-foreground text-sm">No recent activity.</p>}
            {activity?.map((item) => (
              <div key={item.id} className="relative pl-6 before:absolute before:left-[11px] before:top-2 before:bottom-[-24px] last:before:bottom-0 before:w-px before:bg-white/10">
                <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-card border-2 border-primary/50 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                </div>
                <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                  <p className="text-sm text-foreground">{item.description}</p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground font-medium">
                    <span>{format(new Date(item.timestamp), 'MMM d, h:mm a')}</span>
                    {item.loanProduct && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span className="text-primary">{item.loanProduct}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
