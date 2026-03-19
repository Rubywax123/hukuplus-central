import React, { useState, useRef } from "react";
import { useGetSigningSession, useVerifySigningIdentity, useSubmitSignature } from "@workspace/api-client-react";
import { GlassCard, GradientButton, Input, Label, Badge } from "@/components/ui-extras";
import { Zap, ShieldCheck, PenTool, CheckCircle, FileX } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import SignatureCanvas from "react-signature-canvas";

export default function PublicSigningPage({ token }: { token: string }) {
  const { data: session, isLoading, error } = useGetSigningSession(token);
  const verifyMutation = useVerifySigningIdentity();
  const submitMutation = useSubmitSignature();
  
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [details, setDetails] = useState<any>(null);
  const sigCanvas = useRef<any>(null);

  // Form Step 1
  const [rName, setRName] = useState("");
  const [bName, setBName] = useState("");
  const [cName, setCName] = useState("");

  if (isLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center text-primary animate-pulse">
      Verifying secure link...
    </div>
  );

  if (error || !session) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <GlassCard className="p-8 max-w-md text-center">
        <FileX className="w-16 h-16 text-destructive mx-auto mb-4" />
        <h2 className="text-xl font-display font-bold mb-2">Invalid or Expired Link</h2>
        <p className="text-muted-foreground">This secure signing link is no longer valid or does not exist. Please request a new one.</p>
      </GlassCard>
    </div>
  );

  if (session.status === 'signed') return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <GlassCard className="p-8 max-w-md text-center border-emerald-500/30">
        <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-xl font-display font-bold mb-2 text-white">Agreement Signed</h2>
        <p className="text-muted-foreground">This document has already been fully executed and locked. Thank you.</p>
      </GlassCard>
    </div>
  );

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    verifyMutation.mutate({
      token,
      data: { retailerName: rName, branchName: bName, customerName: cName }
    }, {
      onSuccess: (res) => {
        setDetails(res);
        setStep(2);
      }
    });
  };

  const handleSubmitSignature = () => {
    if (sigCanvas.current?.isEmpty()) {
      alert("Please provide a signature first.");
      return;
    }
    const signatureData = sigCanvas.current.toDataURL();
    submitMutation.mutate({
      token,
      data: { signatureData }
    }, {
      onSuccess: () => setStep(3)
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col py-10 px-4 items-center">
      {/* Brand Header */}
      <div className="mb-8 flex flex-col items-center">
        <div className="w-12 h-12 mb-3 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
          <Zap className="w-7 h-7 text-white" />
        </div>
        <h1 className="font-display font-bold text-2xl text-gradient">HukuPlus Central</h1>
        <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase mt-1">Secure Signing Gateway</p>
      </div>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-md">
            <GlassCard className="p-8">
              <div className="flex items-center gap-3 mb-6 pb-6 border-b border-white/5">
                <ShieldCheck className="w-8 h-8 text-primary" />
                <div>
                  <h2 className="text-xl font-display font-bold text-white">Identity Verification</h2>
                  <p className="text-sm text-muted-foreground">Please confirm location details.</p>
                </div>
              </div>

              {verifyMutation.isError && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive-foreground p-3 rounded-lg text-sm mb-6">
                  Verification failed. Please check the details and try again.
                </div>
              )}

              <form onSubmit={handleVerify} className="space-y-5">
                <div>
                  <Label>Retailer Name</Label>
                  <Input required placeholder={`e.g. ${session.retailerName}`} value={rName} onChange={e => setRName(e.target.value)} />
                </div>
                <div>
                  <Label>Branch Name</Label>
                  <Input required placeholder={`e.g. ${session.branchName}`} value={bName} onChange={e => setBName(e.target.value)} />
                </div>
                <div>
                  <Label>Customer Name</Label>
                  <Input required placeholder="Exact full name" value={cName} onChange={e => setCName(e.target.value)} />
                </div>
                <GradientButton type="submit" isLoading={verifyMutation.isPending} className="w-full py-3.5 mt-4 text-base">
                  Verify & Access Document
                </GradientButton>
              </form>
            </GlassCard>
          </motion.div>
        )}

        {step === 2 && details && (
          <motion.div key="step2" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-4xl">
            <GlassCard className="p-0 overflow-hidden">
              <div className="p-6 md:p-8 bg-black/20 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-2xl font-display font-bold text-white">{details.customerName}</h2>
                  <p className="text-muted-foreground mt-1">Loan Agreement Execution</p>
                </div>
                <div className="text-left md:text-right">
                  <Badge status="success">{details.loanProduct}</Badge>
                  <p className="text-xl font-bold text-white mt-1">KES {details.loanAmount.toLocaleString()}</p>
                </div>
              </div>

              <div className="p-6 md:p-8">
                {details.formitizeFormUrl ? (
                  <div className="w-full rounded-xl overflow-hidden border border-white/10 mb-8 bg-white shadow-inner">
                    <iframe src={details.formitizeFormUrl} className="w-full h-[60vh] border-0" title="Loan Document" />
                  </div>
                ) : (
                  <div className="w-full py-20 flex flex-col items-center justify-center rounded-xl border border-white/10 mb-8 bg-black/20">
                    <FileX className="w-12 h-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground text-center max-w-md">The document visualizer is currently unavailable, but the agreement details above are confirmed.</p>
                  </div>
                )}

                <div className="max-w-2xl mx-auto">
                  <div className="flex items-center gap-2 mb-3">
                    <PenTool className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold text-white">Digital Signature</h3>
                  </div>
                  <div className="bg-card border-2 border-white/10 rounded-xl overflow-hidden mb-3 relative group focus-within:border-primary/50 transition-colors">
                    <SignatureCanvas 
                      ref={sigCanvas}
                      penColor="white"
                      canvasProps={{ className: 'w-full h-48 cursor-crosshair' }}
                    />
                    <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => sigCanvas.current?.clear()} className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-md text-xs font-medium backdrop-blur-md">Clear</button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-8 text-center">I confirm that I have read and agree to the terms of this loan product.</p>

                  <GradientButton onClick={handleSubmitSignature} isLoading={submitMutation.isPending} className="w-full py-4 text-lg shadow-xl shadow-primary/20">
                    Sign & Submit Agreement
                  </GradientButton>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-md">
            <GlassCard className="p-10 text-center border-emerald-500/30 shadow-2xl shadow-emerald-500/10">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.5 }}>
                <CheckCircle className="w-20 h-20 text-emerald-500 mx-auto mb-6" />
              </motion.div>
              <h2 className="text-3xl font-display font-bold mb-3 text-white">Success!</h2>
              <p className="text-muted-foreground">The loan agreement has been successfully signed and secured in the central register.</p>
              <p className="text-xs text-muted-foreground mt-8">You may now close this window.</p>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
