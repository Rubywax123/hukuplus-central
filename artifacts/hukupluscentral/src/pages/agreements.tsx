import React, { useState } from "react";
import { useListAgreements, useCreateAgreement, useListRetailers, useListBranches } from "@workspace/api-client-react";
import { PageHeader, GlassCard, GradientButton, Badge, Modal, Input, Label, Select } from "@/components/ui-extras";
import { Plus, Link as LinkIcon, CheckCircle2, Clock, XCircle, Search } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

export default function AgreementsPage() {
  const { data: agreements, isLoading } = useListAgreements();
  const { data: retailers } = useListRetailers();
  const queryClient = useQueryClient();
  const createMutation = useCreateAgreement();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Form State
  const [retailerId, setRetailerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [loanProduct, setLoanProduct] = useState("HukuPlus");
  const [loanAmount, setLoanAmount] = useState("");

  const { data: branches } = useListBranches(Number(retailerId), { query: { enabled: !!retailerId }});

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      data: {
        retailerId: Number(retailerId),
        branchId: Number(branchId),
        customerName,
        loanProduct,
        loanAmount: Number(loanAmount)
      }
    }, {
      onSuccess: () => {
        setIsModalOpen(false);
        queryClient.invalidateQueries({ queryKey: [`/api/agreements`] });
        // Reset form
        setRetailerId(""); setBranchId(""); setCustomerName(""); setLoanAmount("");
      }
    });
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(window.location.origin + url);
    // In a real app, toast notification here
  };

  const filtered = agreements?.filter(a => a.customerName.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="pb-10">
      <PageHeader 
        title="Loan Agreements" 
        description="Monitor status, create signing gateways, and review executed contracts."
        action={<GradientButton onClick={() => setIsModalOpen(true)}><Plus className="w-4 h-4" /> Issue Agreement</GradientButton>}
      />

      <GlassCard className="p-0 overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/20">
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input 
              placeholder="Search by customer name..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 py-2 bg-transparent border-transparent focus:border-white/10"
            />
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-white/10 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                <th className="p-4">Customer</th>
                <th className="p-4">Product & Amount</th>
                <th className="p-4">Location</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading && <tr><td colSpan={5} className="p-8 text-center animate-pulse">Loading agreements...</td></tr>}
              {filtered?.map((a) => (
                <tr key={a.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="p-4">
                    <p className="font-semibold text-white">{a.customerName}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(a.createdAt), 'MMM d, yyyy')}</p>
                  </td>
                  <td className="p-4">
                    <Badge status="neutral">{a.loanProduct}</Badge>
                    <p className="text-sm font-medium mt-1">KES {a.loanAmount.toLocaleString()}</p>
                  </td>
                  <td className="p-4">
                    <p className="text-sm text-foreground">{a.retailerName}</p>
                    <p className="text-xs text-muted-foreground">{a.branchName}</p>
                  </td>
                  <td className="p-4">
                    {a.status === 'signed' ? <Badge status="success"><CheckCircle2 className="w-3 h-3 inline mr-1" />Signed</Badge> :
                     a.status === 'pending' ? <Badge status="warning"><Clock className="w-3 h-3 inline mr-1" />Pending</Badge> :
                     <Badge status="danger"><XCircle className="w-3 h-3 inline mr-1" />Expired</Badge>}
                  </td>
                  <td className="p-4 text-right">
                    <button 
                      onClick={() => a.signingUrl && copyLink(a.signingUrl)}
                      className="p-2 rounded-lg bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 transition-colors inline-flex items-center"
                      title="Copy Signing Link"
                    >
                      <LinkIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered?.length === 0 && !isLoading && (
                <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No agreements found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Issue Loan Agreement">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Retailer</Label>
              <Select required value={retailerId} onChange={e => setRetailerId(e.target.value)}>
                <option value="">Select Retailer</option>
                {retailers?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Branch</Label>
              <Select required disabled={!retailerId} value={branchId} onChange={e => setBranchId(e.target.value)}>
                <option value="">Select Branch</option>
                {branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </div>
          </div>
          
          <div>
            <Label>Customer Full Name</Label>
            <Input required placeholder="Jane Doe" value={customerName} onChange={e => setCustomerName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Loan Product</Label>
              <Select required value={loanProduct} onChange={e => setLoanProduct(e.target.value)}>
                <option value="HukuPlus">HukuPlus (Broiler)</option>
                <option value="Revolver">Revolver (Layer)</option>
                <option value="Salary">Salary (Payroll)</option>
              </Select>
            </div>
            <div>
              <Label>Amount (KES)</Label>
              <Input type="number" required placeholder="50000" min="1" value={loanAmount} onChange={e => setLoanAmount(e.target.value)} />
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-white">Cancel</button>
            <GradientButton type="submit" isLoading={createMutation.isPending}>Generate Link</GradientButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
