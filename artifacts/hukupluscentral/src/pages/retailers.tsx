import React, { useState } from "react";
import { useListRetailers, useCreateRetailer, useListBranches, useCreateBranch } from "@workspace/api-client-react";
import { PageHeader, GlassCard, GradientButton, Badge, Modal, Input, Label } from "@/components/ui-extras";
import { Plus, Building, MapPin, Phone, Mail, ChevronDown, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

function BranchesList({ retailerId }: { retailerId: number }) {
  const { data: branches, isLoading } = useListBranches(retailerId);
  const queryClient = useQueryClient();
  const createMutation = useCreateBranch();
  
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      retailerId,
      data: { name, location }
    }, {
      onSuccess: () => {
        setIsAdding(false);
        setName("");
        setLocation("");
        queryClient.invalidateQueries({ queryKey: [`/api/retailers/${retailerId}/branches`] });
        queryClient.invalidateQueries({ queryKey: [`/api/retailers`] });
      }
    });
  };

  if (isLoading) return <div className="p-4 text-center text-sm text-muted-foreground animate-pulse">Loading branches...</div>;

  return (
    <div className="bg-black/20 p-4 border-t border-white/5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Branches</h4>
        <button onClick={() => setIsAdding(!isAdding)} className="text-xs text-primary hover:text-white flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add Branch
        </button>
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.form 
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            onSubmit={handleAdd} 
            className="flex gap-3 mb-4 bg-white/5 p-3 rounded-lg border border-white/5 overflow-hidden"
          >
            <Input placeholder="Branch Name" value={name} onChange={e => setName(e.target.value)} required className="py-2 text-sm" />
            <Input placeholder="Location (City/Area)" value={location} onChange={e => setLocation(e.target.value)} className="py-2 text-sm" />
            <GradientButton type="submit" isLoading={createMutation.isPending} className="py-2 whitespace-nowrap">Save</GradientButton>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {branches?.map(b => (
          <div key={b.id} className="bg-card border border-white/5 p-3 rounded-lg flex items-start gap-3 hover:border-white/20 transition-colors">
            <div className="p-2 bg-white/5 rounded-md text-primary"><MapPin className="w-4 h-4" /></div>
            <div>
              <p className="text-sm font-medium text-white">{b.name}</p>
              {b.location && <p className="text-xs text-muted-foreground mt-0.5">{b.location}</p>}
            </div>
          </div>
        ))}
        {branches?.length === 0 && !isAdding && (
          <p className="text-sm text-muted-foreground italic col-span-full">No branches created yet.</p>
        )}
      </div>
    </div>
  );
}

export default function RetailersPage() {
  const { data: retailers, isLoading } = useListRetailers();
  const queryClient = useQueryClient();
  const createMutation = useCreateRetailer();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Form State
  const [name, setName] = useState("");
  const [contactEmail, setEmail] = useState("");
  const [contactPhone, setPhone] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      data: { name, contactEmail, contactPhone }
    }, {
      onSuccess: () => {
        setIsModalOpen(false);
        queryClient.invalidateQueries({ queryKey: [`/api/retailers`] });
      }
    });
  };

  return (
    <div className="pb-10">
      <PageHeader 
        title="Retailers Directory" 
        description="Manage partner stores, POS locations, and branch networks."
        action={<GradientButton onClick={() => setIsModalOpen(true)}><Plus className="w-4 h-4" /> New Retailer</GradientButton>}
      />

      <GlassCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center animate-pulse">Loading directory...</div>
        ) : (
          <div className="divide-y divide-white/5">
            {retailers?.map((r) => {
              const isExpanded = expandedId === r.id;
              return (
                <div key={r.id} className="group">
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
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {r.branchCount || 0} Branches</span>
                          {r.contactPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {r.contactPhone}</span>}
                          {r.contactEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {r.contactEmail}</span>}
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
                  {isExpanded && <BranchesList retailerId={r.id} />}
                </div>
              );
            })}
            {retailers?.length === 0 && (
              <div className="p-10 text-center text-muted-foreground">No retailers found. Add one to get started.</div>
            )}
          </div>
        )}
      </GlassCard>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Register New Retailer">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label>Registered Name</Label>
            <Input required placeholder="e.g. Novafeeds Ltd" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Contact Phone</Label>
              <Input placeholder="+254..." value={contactPhone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div>
              <Label>Contact Email</Label>
              <Input type="email" placeholder="admin@retailer.com" value={contactEmail} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-white">Cancel</button>
            <GradientButton type="submit" isLoading={createMutation.isPending}>Create Retailer</GradientButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
