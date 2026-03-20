import React, { useState, useRef } from "react";
import { useListAgreements, useCreateAgreement, useListRetailers, useListBranches } from "@workspace/api-client-react";
import { PageHeader, GlassCard, GradientButton, Badge, Modal, Input, Label, Select } from "@/components/ui-extras";
import { Plus, Link as LinkIcon, CheckCircle2, Clock, XCircle, Search, Upload, FileText, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function AgreementsPage() {
  const { data: agreements, isLoading } = useListAgreements();
  const { data: retailers } = useListRetailers();
  const queryClient = useQueryClient();
  const createMutation = useCreateAgreement();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Create form state
  const [retailerId, setRetailerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [loanProduct, setLoanProduct] = useState("HukuPlus");
  const [loanAmount, setLoanAmount] = useState("");

  // PDF URL field for quick-entry
  const [pdfUrl, setPdfUrl] = useState("");

  // CSV import state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number; skipped: number; errors: string[];
    detectedColumns?: string[];
    agreements: { customerName: string; branch: string; signingUrl: string }[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: branches } = useListBranches(Number(retailerId), { query: { enabled: !!retailerId }});

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      data: {
        retailerId: Number(retailerId),
        branchId: Number(branchId),
        customerName,
        loanProduct,
        loanAmount: Number(loanAmount),
        formitizeFormUrl: pdfUrl.trim() || null,
      }
    }, {
      onSuccess: () => {
        setIsModalOpen(false);
        queryClient.invalidateQueries({ queryKey: [`/api/agreements`] });
        setRetailerId(""); setBranchId(""); setCustomerName(""); setLoanAmount(""); setPdfUrl("");
      }
    });
  };

  const handleImport = async () => {
    if (!csvFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      const res = await fetch(`${BASE}/api/formitize/import-csv`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResult(data);
      if (data.imported > 0) {
        queryClient.invalidateQueries({ queryKey: [`/api/agreements`] });
      }
    } catch (err: any) {
      setImportResult({ imported: 0, skipped: 0, errors: [err.message], agreements: [] });
    } finally {
      setImporting(false);
    }
  };

  const resetImport = () => {
    setCsvFile(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const copyLink = (url: string) => { navigator.clipboard.writeText(url); };

  const filtered = agreements?.filter(a => a.customerName.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="pb-10">
      <PageHeader
        title="Loan Agreements"
        description="Monitor status, create signing gateways, and review executed contracts."
        action={
          <div className="flex gap-2">
            <button
              onClick={() => { setIsImportOpen(true); resetImport(); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-white transition-colors border border-white/10"
            >
              <Upload className="w-4 h-4" /> Import Formitize CSV
            </button>
            <GradientButton onClick={() => setIsModalOpen(true)}>
              <Plus className="w-4 h-4" /> Issue Agreement
            </GradientButton>
          </div>
        }
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
                    {a.status === 'signed'  ? <Badge status="success"><CheckCircle2 className="w-3 h-3 inline mr-1" />Signed</Badge>  :
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

      {/* ── Create Agreement Modal ── */}
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
                <option value="Novafeeds">Novafeeds</option>
              </Select>
            </div>
            <div>
              <Label>Amount (USD)</Label>
              <Input type="number" required placeholder="500" min="1" value={loanAmount} onChange={e => setLoanAmount(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Formitize PDF URL <span className="text-muted-foreground font-normal">(optional — paste from the notification email)</span></Label>
            <Input
              type="url"
              placeholder="https://service.formitize.com/..."
              value={pdfUrl}
              onChange={e => setPdfUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">If provided, the kiosk QR code will open this PDF directly so the customer can view and sign it on screen.</p>
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-white">Cancel</button>
            <GradientButton type="submit" isLoading={createMutation.isPending}>Add to Kiosk</GradientButton>
          </div>
        </form>
      </Modal>

      {/* ── Import Formitize CSV Modal ── */}
      <Modal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} title="Import from Formitize CSV">
        <div className="space-y-5">
          {/* Instructions */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium text-blue-300 flex items-center gap-2"><FileText className="w-4 h-4" /> How to export from Formitize</p>
            <ol className="text-blue-200/80 space-y-1 list-decimal list-inside">
              <li>Go to <strong>Forms → Form Reporting</strong></li>
              <li>Select <strong>NOVAFEED AGREEMENT</strong> as the form</li>
              <li>Click <strong>Add All</strong> to include all fields</li>
              <li>Click <strong>Export CSV</strong> to download the file</li>
              <li>Upload that file here</li>
            </ol>
          </div>

          {!importResult ? (
            <>
              {/* File drop zone */}
              <div
                className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center cursor-pointer hover:border-white/40 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f && f.name.endsWith(".csv")) setCsvFile(f);
                }}
              >
                <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                {csvFile ? (
                  <div>
                    <p className="font-medium text-white">{csvFile.name}</p>
                    <p className="text-sm text-muted-foreground">{(csvFile.size / 1024).toFixed(1)} KB — ready to import</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-white font-medium">Click to select CSV file</p>
                    <p className="text-sm text-muted-foreground mt-1">or drag and drop here</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && setCsvFile(e.target.files[0])}
                />
              </div>

              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setIsImportOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-white">Cancel</button>
                <GradientButton onClick={handleImport} isLoading={importing} disabled={!csvFile}>
                  {importing ? "Importing…" : "Import Agreements"}
                </GradientButton>
              </div>
            </>
          ) : (
            /* Results view */
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-400">{importResult.imported}</p>
                  <p className="text-xs text-green-300">Imported</p>
                </div>
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-400">{importResult.skipped}</p>
                  <p className="text-xs text-yellow-300">Skipped (duplicates)</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">{importResult.errors.length}</p>
                  <p className="text-xs text-red-300">Errors</p>
                </div>
              </div>

              {importResult.agreements.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Imported agreements</p>
                  {importResult.agreements.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-white">{a.customerName}</p>
                        <p className="text-xs text-muted-foreground">{a.branch}</p>
                      </div>
                      <button
                        onClick={() => copyLink(a.signingUrl)}
                        className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-muted-foreground hover:text-white transition-colors"
                        title="Copy signing link"
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {importResult.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-red-400 uppercase tracking-wider flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Errors</p>
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    {importResult.errors.map((e, i) => (
                      <p key={i} className="text-xs text-red-300/80 bg-red-500/5 rounded px-2 py-1">{e}</p>
                    ))}
                  </div>
                  {importResult.detectedColumns && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer hover:text-white">Show columns detected in your CSV ({importResult.detectedColumns.length})</summary>
                      <p className="mt-1 bg-white/5 rounded px-2 py-1 font-mono break-all">{importResult.detectedColumns.join(", ")}</p>
                    </details>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={resetImport} className="px-4 py-2 text-sm text-muted-foreground hover:text-white">Import another file</button>
                <GradientButton onClick={() => setIsImportOpen(false)}>Done</GradientButton>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
