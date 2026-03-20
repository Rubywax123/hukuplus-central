import React, { useState, useRef, useEffect } from "react";
import { useGetSigningSession, useSubmitSignature } from "@workspace/api-client-react";
import { GradientButton } from "@/components/ui-extras";
import { CheckCircle, FileX, PenTool, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import SignatureCanvas from "react-signature-canvas";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function formatAmount(n: number) {
  return `USD ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PublicSigningPage({ token }: { token: string }) {
  const { data: session, isLoading, error } = useGetSigningSession(token);
  const submitMutation = useSubmitSignature();

  const [step, setStep] = useState<"confirm" | "sign" | "done">("confirm");
  const [isEmpty, setIsEmpty] = useState(true);
  const sigCanvas = useRef<any>(null);

  // Read optional ?return= query param so we can send the customer back
  // to the kiosk screen after signing.
  const returnPath = new URLSearchParams(window.location.search).get("return");
  const returnUrl = returnPath
    ? `${window.location.origin}${BASE}${returnPath}`
    : null;

  // Resize canvas to fill its container on mount and window resize
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
    // Slight delay to let layout settle
    setTimeout(resizeCanvas, 100);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [step]);

  const handleSubmit = () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) return;
    const signatureData = sigCanvas.current.toDataURL("image/png");
    submitMutation.mutate({ token, data: { signatureData } }, {
      onSuccess: () => setStep("done"),
    });
  };

  /* ── Loading ─────────────────────────────────────────────────────────────── */
  if (isLoading) return (
    <div className="min-h-screen bg-[#04080f] flex items-center justify-center">
      <p className="text-white/30 text-lg tracking-widest animate-pulse">LOADING…</p>
    </div>
  );

  /* ── Invalid / expired ───────────────────────────────────────────────────── */
  if (error || !session) return (
    <div className="min-h-screen bg-[#04080f] flex items-center justify-center p-6">
      <div className="bg-white/[0.04] border border-red-500/20 rounded-3xl p-10 max-w-sm w-full text-center">
        <FileX className="w-14 h-14 text-red-400/60 mx-auto mb-5" />
        <h2 className="text-xl font-bold text-white mb-2">Link Invalid or Expired</h2>
        <p className="text-white/40 text-sm">This signing link is no longer valid. Please ask for a new one to be generated.</p>
      </div>
    </div>
  );

  /* ── Already signed ──────────────────────────────────────────────────────── */
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

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
        <div>
          <p className="text-white/25 text-xs tracking-widest uppercase">HukuPlus Central</p>
          <p className="text-white font-semibold text-sm">{session.retailerName} · {session.branchName}</p>
        </div>
        <div className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs font-medium">
          Secure Signing
        </div>
      </div>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-start px-4 py-6 overflow-y-auto">
        <AnimatePresence mode="wait">

          {/* ── STEP 1: Confirm details ────────────────────────────────────── */}
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

              {/* Agreement summary card */}
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

                {(session as any).formitizeFormUrl && (
                  <div className="border-t border-white/[0.06] pt-4">
                    <a
                      href={(session as any).formitizeFormUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-400 text-sm underline underline-offset-4 hover:text-violet-300"
                    >
                      View full agreement document →
                    </a>
                  </div>
                )}
              </div>

              {/* Terms notice */}
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-4 mb-6 text-xs text-white/30 leading-relaxed">
                By proceeding to sign, I confirm that I am <strong className="text-white/50">{session.customerName}</strong> and that I have read and understood the terms of this {session.loanProduct} loan agreement for {formatAmount(session.loanAmount)} from {session.retailerName} ({session.branchName}).
              </div>

              <button
                onClick={() => setStep("sign")}
                className="block w-full py-5 rounded-2xl text-white text-xl font-bold text-center transition-all active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #5b21b6 0%, #7c3aed 50%, #9333ea 100%)",
                  boxShadow: "0 0 50px rgba(124, 58, 237, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)"
                }}
              >
                Details correct — Proceed to sign
              </button>
            </motion.div>
          )}

          {/* ── STEP 2: Signature canvas ───────────────────────────────────── */}
          {step === "sign" && (
            <motion.div
              key="sign"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="w-full max-w-2xl"
            >
              <div className="text-center mb-6">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <PenTool className="w-5 h-5 text-violet-400" />
                  <h2 className="text-2xl font-bold text-white">Sign Here</h2>
                </div>
                <p className="text-white/35 text-sm">Use your finger or stylus to draw your signature in the box below.</p>
              </div>

              {/* Summary strip */}
              <div className="flex items-center justify-between px-5 py-3 bg-white/[0.03] border border-white/[0.06] rounded-2xl mb-4 text-sm">
                <span className="text-white/50">{session.customerName}</span>
                <span className="text-white/50">{formatAmount(session.loanAmount)}</span>
              </div>

              {/* Signature pad */}
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
                    <p className="text-slate-300 text-sm select-none">Draw your signature here</p>
                  </div>
                )}
              </div>

              {/* Clear & hint */}
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
                onClick={handleSubmit}
                isLoading={submitMutation.isPending}
                disabled={isEmpty}
                className="w-full py-5 text-lg"
              >
                Submit Signature
              </GradientButton>

              {submitMutation.isError && (
                <p className="text-red-400 text-sm text-center mt-3">
                  Submission failed — please try again.
                </p>
              )}

              <button
                onClick={() => setStep("confirm")}
                className="mt-4 block w-full text-center text-xs text-white/20 hover:text-white/40 transition-colors py-2"
              >
                ← Back to agreement details
              </button>
            </motion.div>
          )}

          {/* ── STEP 3: Success ────────────────────────────────────────────── */}
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

              <h2 className="text-3xl font-bold text-white mb-3">Signed!</h2>
              <p className="text-white/40 text-sm mb-2">
                The loan agreement for <strong className="text-white/60">{session.customerName}</strong> has been signed and recorded.
              </p>
              <p className="text-white/25 text-xs mb-10">
                A copy will be sent to Tefco Finance for processing.
              </p>

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
      </div>
    </div>
  );
}
