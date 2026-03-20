import { PDFDocument, PDFPage, RGB, rgb, StandardFonts } from "pdf-lib";

// ─── helpers ─────────────────────────────────────────────────────────────────

function field(formData: Record<string, string> | null, ...keys: string[]): string {
  if (!formData) return "";
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, "");
  for (const k of keys) {
    const nk = norm(k);
    for (const [fk, fv] of Object.entries(formData)) {
      if (norm(fk).includes(nk) && fv) return fv;
    }
  }
  return "";
}

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtAmt(n: number | string | null | undefined): string {
  const v = parseFloat(String(n ?? "0"));
  if (isNaN(v)) return "USD —";
  return `USD ${v.toFixed(2)}`;
}

// ─── constants ────────────────────────────────────────────────────────────────

const PW = 595, PH = 841;          // A4 points
const ML = 50, MR = 50, MT = 40;   // left / right / top margin
const CW = PW - ML - MR;           // content width
const TEAL: RGB  = rgb(0, 0.38, 0.40);
const DARK: RGB  = rgb(0.08, 0.08, 0.08);
const MID:  RGB  = rgb(0.35, 0.35, 0.35);
const GREY: RGB  = rgb(0.55, 0.55, 0.55);
const LGREY: RGB = rgb(0.92, 0.92, 0.92);

// ─── core drawing helpers ─────────────────────────────────────────────────────

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  bold: any; reg: any; sm: any;
  y: number;
};

function drawLine(ctx: Ctx, color: RGB = LGREY, thickness = 0.5) {
  ctx.page.drawLine({ start: { x: ML, y: ctx.y }, end: { x: PW - MR, y: ctx.y }, thickness, color });
}

function text(ctx: Ctx, str: string, x: number, size = 9, color: RGB = DARK, bold = false, font?: any) {
  ctx.page.drawText(str, { x, y: ctx.y, size, font: font ?? (bold ? ctx.bold : ctx.reg), color });
}

function wrap(ctx: Ctx, str: string, x: number, maxW: number, size = 9, color: RGB = MID, lineH = 13) {
  const words = str.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    const w = ctx.reg.widthOfTextAtSize(test, size);
    if (w > maxW && line) {
      text(ctx, line, x, size, color);
      ctx.y -= lineH;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) { text(ctx, line, x, size, color); ctx.y -= lineH; }
}

function heading(ctx: Ctx, str: string, size = 8) {
  text(ctx, str.toUpperCase(), ML, size, TEAL, false, ctx.bold);
  ctx.y -= 3;
  drawLine(ctx, TEAL, 0.8);
  ctx.y -= 10;
}

// Two-column field row
function fieldRow(ctx: Ctx, l1: string, v1: string, l2?: string, v2?: string) {
  const col2x = ML + CW / 2 + 8;
  text(ctx, l1.toUpperCase(), ML, 6.5, GREY, false, ctx.bold);
  if (l2) text(ctx, l2.toUpperCase(), col2x, 6.5, GREY, false, ctx.bold);
  ctx.y -= 8;
  text(ctx, v1 || "—", ML, 9, DARK, true, ctx.bold);
  if (l2) text(ctx, v2 || "—", col2x, 9, DARK, true, ctx.bold);
  ctx.y -= 16;
}

// Full-width field row
function fieldFull(ctx: Ctx, label: string, value: string) {
  text(ctx, label.toUpperCase(), ML, 6.5, GREY, false, ctx.bold);
  ctx.y -= 8;
  text(ctx, value || "—", ML, 9, DARK, true, ctx.bold);
  ctx.y -= 16;
}

// Draw a signature block (label + image or blank line)
async function sigBlock(ctx: Ctx, label: string, sublabel: string, sigData: string | null, w = CW / 2 - 8) {
  const SH = 80;
  const x  = ML;
  const yB = ctx.y - SH;

  // Box
  ctx.page.drawRectangle({ x, y: yB, width: w, height: SH, borderColor: rgb(0.8,0.8,0.8), borderWidth: 0.5, color: rgb(1,1,1) });
  // Top label bar
  ctx.page.drawRectangle({ x, y: yB + SH - 20, width: w, height: 20, color: rgb(0.96,0.96,0.96) });
  text({ ...ctx, y: yB + SH - 8 }, label, x + 5, 7, DARK, true);
  text({ ...ctx, y: yB + SH - 16 }, sublabel, x + 5, 5.5, GREY);

  if (sigData) {
    try {
      const b64 = sigData.replace(/^data:image\/\w+;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      const img = await ctx.doc.embedPng(buf).catch(() => ctx.doc.embedJpg(buf));
      const { width: iw, height: ih } = img.scale(1);
      const scale = Math.min((w - 12) / iw, (SH - 26) / ih, 1);
      ctx.page.drawImage(img, { x: x + 6, y: yB + 5, width: iw * scale, height: ih * scale });
    } catch { /* skip */ }
  } else {
    // Blank signature line
    const ly = yB + 22;
    ctx.page.drawLine({ start: { x: x + 8, y: ly }, end: { x: x + w - 8, y: ly }, thickness: 0.4, color: rgb(0.7,0.7,0.7) });
    text({ ...ctx, y: ly + 3 }, "Signature", x + 8, 7, rgb(0.8,0.8,0.8) );
  }

  ctx.y -= SH + 8;
}

// ─── page factory ─────────────────────────────────────────────────────────────

async function newPage(doc: PDFDocument, bold: any, reg: any, sm: any, pageNum: number, total: number, customer: string, jobRef: string): Promise<Ctx> {
  const page = doc.addPage([PW, PH]);

  // ── header band ──
  page.drawRectangle({ x: 0, y: PH - 38, width: PW, height: 38, color: TEAL });
  page.drawText("TEFCO FINANCE (PVT) LTD — NOVAFEED AGREEMENT", {
    x: ML, y: PH - 22, size: 9.5, font: bold, color: rgb(1,1,1),
  });
  page.drawText(`Ref: ${jobRef}   ·   ${customer}   ·   Page ${pageNum} of ${total}`, {
    x: ML, y: PH - 34, size: 7, font: reg, color: rgb(0.85,1,1),
  });

  const y = PH - 38 - MT;
  return { doc, page, bold, reg, sm, y };
}

// ─── main export ─────────────────────────────────────────────────────────────

export interface AgreementData {
  id: number;
  customerName: string;
  customerPhone: string | null;
  loanAmount: number | string | null;
  loanProduct: string | null;
  status: string;
  createdAt: Date | string | null;
  signedAt: Date | string | null;
  formitizeJobId: string | null;
  signatureData: string | null;
  customerSignature2: string | null;
  customerSignature3: string | null;
  managerSignature: string | null;
  formData: Record<string, string> | null;
  retailerName: string;
  branchName: string;
}

export async function generateNovafeedAgreementPdf(data: AgreementData): Promise<Uint8Array> {
  const doc   = await PDFDocument.create();
  const bold  = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg   = await doc.embedFont(StandardFonts.Helvetica);
  const sm    = await doc.embedFont(StandardFonts.Helvetica);
  const fd    = data.formData ?? {};

  // Pull extra fields from formData
  const nationalId   = field(fd, "borrowerid", "nationalid", "id number", "idnumber", "formtext_3") || "—";
  const disbDate     = field(fd, "applieddisbursement", "disbursementdate", "disbursement date", "disbursement") || fmtDate(data.createdAt as string);
  const settleDate   = field(fd, "appliedsettlement", "settlementdate", "settlement date", "settlement") || "—";
  const loanTerm     = field(fd, "loanterm", "term months", "term", "months") || "—";
  const interestRate = field(fd, "terminterest", "interestrate", "interest rate", "interest") || "—";
  const loanType     = field(fd, "loantype", "loan type", "type") || data.loanProduct || "Novafeeds";
  const totalRepay   = field(fd, "totalrepayment", "totalrepay", "total repayment", "amountdue") || fmtAmt(data.loanAmount);
  const numChicks    = field(fd, "numberofchicks", "chick quantity", "chickquantity", "chicks", "quantity") || "—";
  const chickPrice   = field(fd, "chickprice", "price per chick", "pricepchick") || "—";
  const feedQty      = field(fd, "feedquantity", "feedqty", "feed bags", "bags") || "—";
  const agentName    = field(fd, "agent", "agentname", "salesagent", "sales agent", "supervisor") || "Tefco Finance Agent";

  const jobRef   = data.formitizeJobId || String(data.id);
  const sigDate  = fmtDate(data.signedAt as string);
  const issueDate = fmtDate(data.createdAt as string);

  const sigs = {
    c1:  data.signatureData,
    c2:  data.customerSignature2,
    c3:  data.customerSignature3,
    mgr: data.managerSignature,
  };
  const isSigned = !!sigs.c1;

  // ══════════════════════════════════════════════════════
  // PAGE 1
  // ══════════════════════════════════════════════════════
  const ctx1 = await newPage(doc, bold, reg, sm, 1, 2, data.customerName, jobRef);

  // Issue date (right-aligned)
  ctx1.page.drawText(`Issue Date: ${issueDate}`, { x: PW - MR - 120, y: ctx1.y + 2, size: 8, font: reg, color: MID });

  // ── Borrower Details ────────────────────────────────
  heading(ctx1, "Borrower Details");
  fieldRow(ctx1, "Borrower Name", data.customerName,   "National ID / Passport", nationalId);
  fieldRow(ctx1, "Mobile Number", data.customerPhone || "—", "Store Branch", data.branchName || "—");
  fieldRow(ctx1, "Retailer / Partner", data.retailerName || "—", "Loan Type", loanType);
  ctx1.y -= 4;

  // ── Loan Summary ────────────────────────────────────
  heading(ctx1, "Loan Summary");
  fieldRow(ctx1, "Applied Loan Amount", fmtAmt(data.loanAmount), "Loan Term", loanTerm ? `${loanTerm} months` : "—");
  fieldRow(ctx1, "Interest Rate", interestRate ? `${interestRate}%` : "—", "Total Repayment", totalRepay ? String(totalRepay) : "—");
  fieldRow(ctx1, "Disbursement Date", disbDate, "Settlement Due Date", settleDate);
  if (numChicks !== "—") fieldRow(ctx1, "Number of Chicks", numChicks, "Price per Chick", chickPrice !== "—" ? chickPrice : "—");
  if (feedQty !== "—") fieldFull(ctx1, "Feed Quantity (bags)", feedQty);
  ctx1.y -= 4;

  // ── Section 1: Acknowledgement ──────────────────────
  heading(ctx1, "Section 1 — Acknowledgement of Loan Terms");

  const terms1 = [
    "I, the undersigned Borrower, hereby acknowledge that I have read, understood and agree to be bound by the",
    "terms and conditions of this Novafeed Agreement with Tefco Finance (Pvt) Ltd. I confirm that the loan",
    "amount, repayment schedule and all associated conditions stated herein are correct and accepted by me.",
    "",
    "I understand that this loan is to be used exclusively for the purchase of Novafeed products (chicks and/or",
    "feed) as agreed with the Novafeeds retailer. Any diversion of funds to other purposes constitutes a breach",
    "of this agreement. I agree to repay the full amount by the Settlement Due Date indicated above.",
    "",
    "Failure to repay on time may result in legal proceedings and/or reporting to credit reference bureaus.",
  ];
  for (const line of terms1) {
    if (line === "") { ctx1.y -= 6; continue; }
    wrap(ctx1, line, ML, CW, 8.5, MID, 12);
  }
  ctx1.y -= 10;

  // ── Signature 1 ─────────────────────────────────────
  text(ctx1, "BORROWER SIGNATURE 1 OF 3", ML, 7, TEAL, false, bold);
  ctx1.y -= 4;
  text(ctx1, "By signing below the borrower acknowledges the loan terms stated above.", ML, 8, MID);
  ctx1.y -= 12;
  await sigBlock(ctx1, "Customer Signature 1 of 3", "Acknowledgement of loan terms", sigs.c1);
  ctx1.y -= 4;

  // ── Footer line ─────────────────────────────────────
  ctx1.y = 30;
  drawLine(ctx1, LGREY);
  ctx1.y -= 10;
  text(ctx1, "Tefco Finance (Pvt) Ltd  ·  HukuPlus Central  ·  Ref: " + jobRef + (isSigned ? "  ·  Executed: " + sigDate : "  ·  PENDING SIGNATURE"), ML, 6.5, GREY);

  // ══════════════════════════════════════════════════════
  // PAGE 2
  // ══════════════════════════════════════════════════════
  const ctx2 = await newPage(doc, bold, reg, sm, 2, 2, data.customerName, jobRef);

  // ── Section 2: Repayment schedule ──────────────────
  heading(ctx2, "Section 2 — Repayment Schedule Confirmation");

  const terms2 = [
    "I, the undersigned Borrower, confirm receipt of the loan proceeds and acknowledge the repayment schedule",
    "as detailed in Section 1 above. I understand that repayments are due on the Settlement Date and that no",
    "extensions will be granted unless approved in writing by Tefco Finance (Pvt) Ltd.",
    "",
    "I further confirm that all chicks and/or feed received from the Novafeeds retailer are as per the quantities",
    "specified in this agreement, and I accept full responsibility for the care and management of such assets.",
  ];
  for (const line of terms2) {
    if (line === "") { ctx2.y -= 6; continue; }
    wrap(ctx2, line, ML, CW, 8.5, MID, 12);
  }
  ctx2.y -= 10;

  // ── Signature 2 ─────────────────────────────────────
  text(ctx2, "BORROWER SIGNATURE 2 OF 3", ML, 7, TEAL, false, bold);
  ctx2.y -= 4;
  text(ctx2, "Confirming repayment schedule and receipt of goods.", ML, 8, MID);
  ctx2.y -= 12;
  await sigBlock(ctx2, "Customer Signature 2 of 3", "Repayment schedule & receipt confirmation", sigs.c2);
  ctx2.y -= 10;

  // ── Section 3: Final authorisation ─────────────────
  heading(ctx2, "Section 3 — Final Authorisation & Approved Loan Details");

  const terms3 = [
    "I confirm that all information provided in this agreement is true and correct. I authorise Tefco Finance",
    "(Pvt) Ltd to process the approved loan amount and understand that this signature constitutes final, legal",
    "and binding acceptance of all terms and conditions of the Novafeed Agreement.",
    "",
    "Approved Loan Amount: " + fmtAmt(data.loanAmount) +
    "   |   Settlement Due: " + settleDate +
    "   |   Ref: " + jobRef,
  ];
  for (const line of terms3) {
    if (line === "") { ctx2.y -= 6; continue; }
    wrap(ctx2, line, ML, CW, 8.5, MID, 12);
  }
  ctx2.y -= 10;

  // ── Signature 3 ─────────────────────────────────────
  text(ctx2, "BORROWER SIGNATURE 3 OF 3", ML, 7, TEAL, false, bold);
  ctx2.y -= 4;
  text(ctx2, "Final authorisation of the Novafeed Agreement.", ML, 8, MID);
  ctx2.y -= 12;
  await sigBlock(ctx2, "Customer Signature 3 of 3", "Final authorisation", sigs.c3);
  ctx2.y -= 10;

  // ── Section 4: Supervisor ───────────────────────────
  heading(ctx2, "Section 4 — Store Manager / Supervisor Authorisation");

  wrap(ctx2,
    `I, ${agentName}, as the authorised Novafeeds store manager / Tefco Finance supervisor, confirm that the borrower's ` +
    "identity has been verified, that the loan terms have been explained to the borrower and that all signatures above are " +
    "genuine. This agreement is hereby approved and authorised.",
    ML, CW, 8.5, MID, 12
  );
  ctx2.y -= 10;

  text(ctx2, "SUPERVISOR / STORE MANAGER SIGNATURE", ML, 7, TEAL, false, bold);
  ctx2.y -= 4;
  text(ctx2, "Authorised representative of Novafeeds / Tefco Finance (Pvt) Ltd.", ML, 8, MID);
  ctx2.y -= 12;
  await sigBlock(ctx2, "Store Manager / Supervisor", "Authorised representative", sigs.mgr);

  // ── Execution stamp ─────────────────────────────────
  if (isSigned) {
    ctx2.y -= 6;
    ctx2.page.drawRectangle({ x: ML, y: ctx2.y - 28, width: CW, height: 28, color: rgb(0.93,1,0.95), borderColor: rgb(0.3,0.7,0.4), borderWidth: 0.8 });
    text({ ...ctx2, y: ctx2.y - 10 }, "AGREEMENT FULLY EXECUTED", ML + 8, 9, rgb(0.1,0.5,0.2), false, bold);
    text({ ...ctx2, y: ctx2.y - 21 }, `All four signatures captured on ${sigDate} via HukuPlus Central · Tefco Finance (Pvt) Ltd`, ML + 8, 7, rgb(0.2,0.5,0.3));
    ctx2.y -= 34;
  }

  // ── Footer ──────────────────────────────────────────
  ctx2.y = 30;
  drawLine(ctx2, LGREY);
  ctx2.y -= 10;
  text(ctx2, "Tefco Finance (Pvt) Ltd  ·  HukuPlus Central  ·  Ref: " + jobRef + (isSigned ? "  ·  Executed: " + sigDate : "  ·  PENDING SIGNATURE"), ML, 6.5, GREY);

  return doc.save();
}
