import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";

export function GlassCard({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card/40 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl ${className}`} {...props}>
      {children}
    </div>
  );
}

export function GradientButton({ 
  children, 
  isLoading, 
  variant = "primary",
  className = "", 
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { isLoading?: boolean, variant?: "primary" | "secondary" | "danger" }) {
  
  const variants = {
    primary: "bg-gradient-to-r from-primary to-accent hover:shadow-primary/25 border-transparent text-white",
    secondary: "bg-secondary hover:bg-secondary/80 border-white/10 text-white",
    danger: "bg-gradient-to-r from-destructive to-destructive/80 hover:shadow-destructive/25 border-transparent text-white"
  };

  return (
    <button
      disabled={isLoading || props.disabled}
      className={`
        relative overflow-hidden px-6 py-2.5 rounded-xl font-medium text-sm
        transition-all duration-300 ease-out shadow-lg hover:shadow-xl hover:-translate-y-0.5
        active:translate-y-0 active:shadow-md disabled:opacity-50 disabled:cursor-not-allowed
        disabled:hover:translate-y-0 disabled:hover:shadow-none border
        flex items-center justify-center gap-2
        ${variants[variant]} ${className}
      `}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-gradient">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function Badge({ children, status }: { children: React.ReactNode, status?: "success" | "warning" | "danger" | "neutral" }) {
  const styles = {
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    danger: "bg-red-500/10 text-red-400 border-red-500/20",
    neutral: "bg-white/5 text-muted-foreground border-white/10",
  };
  return (
    <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${styles[status || "neutral"]}`}>
      {children}
    </span>
  );
}

export function Modal({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <React.Fragment>
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg z-50 p-6 glass-panel rounded-2xl"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-display font-bold">{title}</h2>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X className="w-5 h-5 text-muted-foreground hover:text-white" />
              </button>
            </div>
            {children}
          </motion.div>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input 
      {...props}
      className={`w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all ${props.className || ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select 
      {...props}
      className={`w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all appearance-none ${props.className || ""}`}
    >
      {props.children}
    </select>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-muted-foreground mb-1.5">{children}</label>;
}
