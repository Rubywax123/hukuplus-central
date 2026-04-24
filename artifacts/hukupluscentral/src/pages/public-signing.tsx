import React, { useState, useRef, useEffect } from "react";
import { useGetSigningSession, useSubmitSignature } from "@workspace/api-client-react";
import { GradientButton } from "@/components/ui-extras";
import { CheckCircle, FileX, PenTool, RotateCcw, ChevronRight, FileText, MessageCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import SignatureCanvas from "react-signature-canvas";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

function formatAmount(n: number) {
  return `USD ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Step = "confirm" | "review" | "sig1" | "sig2" | "sig3" | "manager" | "done";

const SIGNATURE_STEPS: { key: Step; label: string; sublabel: string; signer: "customer" | "manager" }[] = [
  { key: "sig1", label: "Signature 1 of 3", sublabel: "Customer — Acknowledgement of loan agreement terms", signer: "customer" },
  { key: "sig2", label: "Signature 2 of 3", sublabel: "Customer — Confirmation of repayment schedule", signer: "customer" },
  { key: "sig3", label: "Signature 3 of 3", sublabel: "Customer — Final authorization", signer: "customer" },
  { key: "manager", label: "Store Manager Signature", sublabel: "Authorized store representative — Counter-signature", signer: "manager" },
];

function SignaturePad({
  step, label, sublabel, signer, customerName, onNext, isLast, isSubmitting,
}: {
  step: Step; label: string; sublabel: string; signer: "customer" | "manager";
  customerName: string; onNext: (sig: string) => void; isLast: boolean; isSubmitting: boolean;
}) {
  const sigCanvas = useRef<any>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = sigCanvas.current?.getCanvas();
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const ctx = canvas.getContext("2d");
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      ctx?.scale(ratio, ratio);
      sigCanvas.current?.clear();
      setIsEmpty(true);
    };
    window.addEventListener("resize", resizeCanvas);
    setTimeout(resizeCanvas, 100);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [step]);

  const handleNext = () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) return;
    onNext(sigCanvas.current.toDataURL("image/png"));
  };

  return (
    <motion.div
      key={step}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="w-full max-w-2xl"
    >
      <div className="text-center mb-6">
        <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold mb-3 ${
          signer === "manager"
            ? "bg-blue-500/10 border border-blue-500/25 text-blue-400"
            : "bg-violet-500/10 border border-violet-500/25 text-violet-400"
        }`}>
          <PenTool className="w-3.5 h-3.5" />
          {label}
        </div>
        <p className="text-white/40 text-sm">{sublabel}</p>
      </div>

      <div className="flex items-center justify-between px-5 py-3 bg-white/[0.03] border border-white/[0.06] rounded-2xl mb-4 text-sm">
        <span className="text-white/40">{signer === "manager" ? "Store Manager" : customerName}</span>
        {signer === "manager" && (
          <span className="text-blue-400/60 text-xs">Hand device to store manager</span>
        )}
      </div>

      <div className="relative bg-white rounded-2xl overflow-hidden mb-2" style={{ height: "240px" }}>
        <SignatureCanvas
          ref={sigCanvas}
          penColor="#1e1b4b"
          velocityFilterWeight={0.7}
          minWidth={1.5}
          maxWidth={3.5}
          canvasProps={{ className: "w-full h-full", style: { touchAction: "none" } }}
          onBegin={() => setIsEmpty(false)}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-300 text-sm select-none">Draw signature here</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-6">
        <p className="text-white/20 text-xs">Sign within the white box above</p>
        <button
          onClick={() => { sigCanvas.current?.clear(); setIsEmpty(true); }}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/25"
        >
          <RotateCcw className="w-3 h-3" /> Clear
        </button>
      </div>

      <GradientButton
        onClick={handleNext}
        isLoading={isSubmitting}
        disabled={isEmpty}
        className="w-full py-5 text-lg"
      >
        {isLast ? "Submit All Signatures" : (
          <span className="flex items-center justify-center gap-2">
            Confirm & Continue <ChevronRight className="w-5 h-5" />
          </span>
        )}
      </GradientButton>
    </motion.div>
  );
}

export default function PublicSigningPage({ token }: { token: string }) {
  const { data: session, isLoading, error } = useGetSigningSession(token);
  const submitMutation = useSubmitSignature();

  const [step, setStep] = useState<Step>("confirm");
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [signatures, setSignatures] = useState<{ sig1: string; sig2: string; sig3: string; manager: string }>({
    sig1: "", sig2: "", sig3: "", manager: "",
  });

  const returnPath = new URLSearchParams(window.location.search).get("return");
  const returnUrl = returnPath ? `${window.location.origin}${BASE}${returnPath}` : null;

  const pdfUrl = `${API}/api/sign/${token}/agreement.pdf`;

  const handleSig = (key: keyof typeof signatures, value: string, nextStep: Step) => {
    const updated = { ...signatures, [key]: value };
    setSignatures(updated);
    if (nextStep === "done") {
      submitMutation.mutate(
        {
          token,
          data: {
            signatureData: updated.sig1,
            customerSignature2: updated.sig2,
            customerSignature3: updated.sig3,
            managerSignature: updated.manager,
          },
        },
        { onSuccess: () => setStep("done") }
      );
    } else {
      setStep(nextStep);
    }
  };

  const stepIndex = ["confirm", "review", "sig1", "sig2", "sig3", "manager", "done"].indexOf(step);
  const totalSteps = 4;
  const sigStepIndex = stepIndex - 2; // 0..3 during signing

  if (isLoading) return (
    <div className="min-h-screen bg-[#04080f] flex items-center justify-center">
      <p className="text-white/30 text-lg tracking-widest animate-pulse">LOADING…</p>
    </div>
  );

  if (error || !session) return (
    <div className="min-h-screen bg-[#04080f] flex items-center justify-center p-6">
      <div className="bg-white/[0.04] border border-red-500/20 rounded-3xl p-10 max-w-sm w-full text-center">
        <FileX className="w-14 h-14 text-red-400/60 mx-auto mb-5" />
        <h2 className="text-xl font-bold text-white mb-2">Link Invalid or Expired</h2>
        <p className="text-white/40 text-sm">This signing link is no longer valid. Please ask for a new one.</p>
      </div>
    </div>
  );

  if (session.status === "signed" && step !== "done") return (
    <div className="min-h-screen bg-[#04080f] flex items-center justify-center p-6">
      <div className="bg-white/[0.04] border border-emerald-500/20 rounded-3xl p-10 max-w-sm w-full text-center">
        <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto mb-5" />
        <h2 className="text-xl font-bold text-white mb-2">Already Signed</h2>
        <p className="text-white/40 text-sm">This agreement has already been executed. Thank you.</p>
        {returnUrl && (
          <a href={returnUrl} className="mt-6 block text-sm text-white/40 hover:text-white underline underline-offset-4">
            ← Return to store screen
          </a>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#04080f] flex flex-col" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
        <div>
          <p className="text-white/25 text-xs tracking-widest uppercase">HukuPlus Central</p>
          <p className="text-white font-semibold text-sm">{session.retailerName} · {session.branchName}</p>
        </div>
        {(["sig1", "sig2", "sig3", "manager"] as Step[]).includes(step) && (
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`h-1.5 rounded-full transition-all ${
                i < sigStepIndex ? "w-6 bg-emerald-500" :
                i === sigStepIndex ? "w-6 bg-violet-400" :
                "w-3 bg-white/10"
              }`} />
            ))}
            <span className="text-white/30 text-xs ml-1">{sigStepIndex + 1}/{totalSteps}</span>
          </div>
        )}
        <div className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-medium">
          Secure Signing
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-start px-4 py-6 overflow-y-auto">
        <AnimatePresence mode="wait">

          {/* ── Confirm: loan summary ── */}
          {step === "confirm" && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full max-w-md"
            >
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-white mb-1">Loan Agreement</h1>
                <p className="text-white/40 text-sm">Please confirm the details below are correct before signing.</p>
              </div>

              <div className="bg-white/[0.04] border border-white/[0.08] rounded-3xl p-6 mb-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Customer</p>
                    <p className="text-white text-2xl font-bold">{session.customerName}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Product</p>
                    <p className="text-white font-semibold">{session.loanProduct}</p>
                  </div>
                </div>
                <div className="border-t border-white/[0.06] pt-4">
                  <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Loan Amount</p>
                  <p className="text-white text-3xl font-bold">{formatAmount(session.loanAmount)}</p>
                </div>
                {((session as any).disbursementDate || (session as any).repaymentDate || (session as any).repaymentAmount) && (
                  <div className="border-t border-white/[0.06] pt-4 grid grid-cols-2 gap-4">
                    {(session as any).disbursementDate && (
                      <div>
                        <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Disbursement Date</p>
                        <p className="text-white font-semibold">{(session as any).disbursementDate}</p>
                      </div>
                    )}
                    {(session as any).repaymentDate && (
                      <div>
                        <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Repayment Date</p>
                        <p className="text-white font-semibold">{(session as any).repaymentDate}</p>
                      </div>
                    )}
                    {(session as any).repaymentAmount && (
                      <div className="col-span-2">
                        <p className="text-white/30 text-xs uppercase tracking-wider mb-1">Repayment Amount</p>
                        <p className="text-white font-semibold">{formatAmount((session as any).repaymentAmount)}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-amber-500/5 border border-amber-500/15 rounded-2xl p-4 mb-6 text-xs text-white/30 leading-relaxed">
                By proceeding, I confirm I am <strong className="text-white/50">{session.customerName}</strong> and understand I will be signing a {session.loanProduct} agreement for {formatAmount(session.loanAmount)} from {session.retailerName} ({session.branchName}).
                <br /><br />
                <strong className="text-amber-400/60">You will review the full agreement document, then sign 3 times, followed by the store manager's signature.</strong>
              </div>

              <button
                onClick={() => setStep("review")}
                className="block w-full py-5 rounded-2xl text-white text-xl font-bold text-center transition-all active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #5b21b6 0%, #7c3aed 50%, #9333ea 100%)",
                  boxShadow: "0 0 50px rgba(124, 58, 237, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)"
                }}
              >
                <span className="flex items-center justify-center gap-2">
                  <FileText className="w-5 h-5" /> Details Correct — Review Agreement
                </span>
              </button>
            </motion.div>
          )}

          {/* ── Review: full PDF agreement viewer ── */}
          {step === "review" && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full max-w-2xl flex flex-col"
            >
              <div className="text-center mb-4">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold mb-2 bg-violet-500/10 border border-violet-500/25 text-violet-400">
                  <FileText className="w-3.5 h-3.5" />
                  Read the Full Agreement
                </div>
                <p className="text-white/40 text-sm">Scroll through the entire document before signing.</p>
              </div>

              {/* PDF viewer */}
              <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden mb-4"
                style={{ height: "calc(100vh - 320px)", minHeight: "420px" }}>
                {!pdfLoaded && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-[#04080f]">
                    <FileText className="w-10 h-10 text-violet-400/50 animate-pulse" />
                    <p className="text-white/30 text-sm">Loading agreement document…</p>
                  </div>
                )}
                <iframe
                  src={pdfUrl}
                  title="Loan Agreement Document"
                  className="w-full h-full border-0"
                  onLoad={() => setPdfLoaded(true)}
                />
              </div>

              {/* Direct PDF link as fallback */}
              <div className="text-center mb-4">
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400/60 text-xs underline underline-offset-2 hover:text-violet-300"
                >
                  Open in new tab if document doesn't display ↗
                </a>
              </div>

              <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-2xl p-4 mb-4 text-xs text-white/40 leading-relaxed">
                By clicking below, you confirm that you have read and understood all terms and conditions of this Novafeed Agreement.
              </div>

              <button
                onClick={() => setStep("sig1")}
                className="block w-full py-5 rounded-2xl text-white text-xl font-bold text-center transition-all active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #065f46 0%, #059669 50%, #10b981 100%)",
                  boxShadow: "0 0 40px rgba(16, 185, 129, 0.2), inset 0 1px 0 rgba(255,255,255,0.1)"
                }}
              >
                <span className="flex items-center justify-center gap-2">
                  I Have Read This Agreement — Begin Signing <ChevronRight className="w-5 h-5" />
                </span>
              </button>
            </motion.div>
          )}

          {/* ── Signature steps ── */}
          {(["sig1", "sig2", "sig3", "manager"] as Step[]).map((s, i) => {
            if (step !== s) return null;
            const info = SIGNATURE_STEPS[i];
            const nextSteps: Step[] = ["sig2", "sig3", "manager", "done"];
            const sigKeys: (keyof typeof signatures)[] = ["sig1", "sig2", "sig3", "manager"];
            return (
              <SignaturePad
                key={s}
                step={s}
                label={info.label}
                sublabel={info.sublabel}
                signer={info.signer}
                customerName={session.customerName}
                isLast={s === "manager"}
                isSubmitting={submitMutation.isPending}
                onNext={(sig) => handleSig(sigKeys[i], sig, nextSteps[i])}
              />
            );
          })}

          {/* ── Done ── */}
          {step === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-sm text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", bounce: 0.5, delay: 0.1 }}
                className="w-24 h-24 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-8"
              >
                <CheckCircle className="w-12 h-12 text-emerald-500" />
              </motion.div>

              <h2 className="text-3xl font-bold text-white mb-3">Agreement Executed</h2>
              <p className="text-white/40 text-sm mb-6">
                All 4 signatures have been collected for <strong className="text-white/60">{session.customerName}</strong>.
              </p>

              {/* Delivery notice */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 mb-8 text-left space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">Agreement recorded</p>
                    <p className="text-white/30 text-xs">Saved to Tefco Finance Central</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                    <MessageCircle className="w-4 h-4 text-green-400" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">Copy sent via WhatsApp</p>
                    <p className="text-white/30 text-xs">Signed PDF being delivered to your registered number</p>
                  </div>
                </div>
              </div>

              {returnUrl ? (
                <a
                  href={returnUrl}
                  className="block w-full py-4 rounded-2xl text-white font-semibold text-center transition-all active:scale-95 bg-white/[0.08] border border-white/10 hover:bg-white/[0.12]"
                >
                  ← Return to Store Screen
                </a>
              ) : (
                <p className="text-white/20 text-sm">You may now close this window.</p>
              )}
            </motion.div>
          )}

        </AnimatePresence>

        {/* Submit error */}
        {submitMutation.isError && (
          <p className="text-red-400 text-sm text-center mt-3">
            Submission failed — please try again.
          </p>
        )}
      </div>
    </div>
  );
}
