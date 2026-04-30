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

const PW = 595, PH = 841;
const ML = 45, MR = 45, MT = 42;
const CW = PW - ML - MR;
const TEAL: RGB  = rgb(0, 0.38, 0.40);
const DARK: RGB  = rgb(0.08, 0.08, 0.08);
const MID:  RGB  = rgb(0.35, 0.35, 0.35);
const GREY: RGB  = rgb(0.55, 0.55, 0.55);
const LGREY: RGB = rgb(0.92, 0.92, 0.92);
const WHITE: RGB = rgb(1, 1, 1);

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
  if (!str) return;
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

function fieldRow(ctx: Ctx, l1: string, v1: string, l2?: string, v2?: string) {
  const col2x = ML + CW / 2 + 8;
  text(ctx, l1.toUpperCase(), ML, 6.5, GREY, false, ctx.bold);
  if (l2) text(ctx, l2.toUpperCase(), col2x, 6.5, GREY, false, ctx.bold);
  ctx.y -= 8;
  text(ctx, v1 || "—", ML, 9, DARK, true, ctx.bold);
  if (l2) text(ctx, v2 || "—", col2x, 9, DARK, true, ctx.bold);
  ctx.y -= 16;
}

function fieldFull(ctx: Ctx, label: string, value: string) {
  text(ctx, label.toUpperCase(), ML, 6.5, GREY, false, ctx.bold);
  ctx.y -= 8;
  text(ctx, value || "—", ML, 9, DARK, true, ctx.bold);
  ctx.y -= 16;
}

function fieldRowRight(ctx: Ctx, label: string, value: string) {
  const vx = ML + CW - 80;
  text(ctx, label.toUpperCase(), ML, 6.5, GREY, false, ctx.bold);
  ctx.y -= 8;
  text(ctx, value || "—", ML, 9, DARK, false, ctx.reg);
  text(ctx, value || "—", vx, 9, DARK, true, ctx.bold);
  ctx.y -= 16;
}

async function sigBlock(ctx: Ctx, label: string, sublabel: string, sigData: string | null, w = CW / 2 - 8) {
  const SH = 72;
  const x  = ML;
  const yB = ctx.y - SH;

  ctx.page.drawRectangle({ x, y: yB, width: w, height: SH, borderColor: rgb(0.8,0.8,0.8), borderWidth: 0.5, color: WHITE });
  ctx.page.drawRectangle({ x, y: yB + SH - 18, width: w, height: 18, color: rgb(0.96,0.96,0.96) });
  text({ ...ctx, y: yB + SH - 7 }, label, x + 5, 7, DARK, true);
  text({ ...ctx, y: yB + SH - 14 }, sublabel, x + 5, 5.5, GREY);

  if (sigData) {
    try {
      const b64 = sigData.replace(/^data:image\/\w+;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      const img = await ctx.doc.embedPng(buf).catch(() => ctx.doc.embedJpg(buf));
      const { width: iw, height: ih } = img.scale(1);
      const scale = Math.min((w - 12) / iw, (SH - 24) / ih, 1);
      ctx.page.drawImage(img, { x: x + 6, y: yB + 5, width: iw * scale, height: ih * scale });
    } catch { /* skip */ }
  } else {
    const ly = yB + 20;
    ctx.page.drawLine({ start: { x: x + 8, y: ly }, end: { x: x + w - 8, y: ly }, thickness: 0.4, color: rgb(0.7,0.7,0.7) });
    text({ ...ctx, y: ly + 3 }, "Signature", x + 8, 7, rgb(0.8,0.8,0.8));
  }

  ctx.y -= SH + 8;
}

function printSigLine(ctx: Ctx, label: string) {
  text(ctx, label, ML, 8, MID);
  ctx.y -= 14;
  ctx.page.drawLine({ start: { x: ML, y: ctx.y }, end: { x: ML + CW / 2, y: ctx.y }, thickness: 0.4, color: rgb(0.6,0.6,0.6) });
  ctx.y -= 16;
}

async function newPage(doc: PDFDocument, bold: any, reg: any, sm: any, pageNum: number, total: number, customer: string, jobRef: string): Promise<Ctx> {
  const page = doc.addPage([PW, PH]);

  page.drawRectangle({ x: 0, y: PH - 36, width: PW, height: 36, color: TEAL });
  page.drawText("TEFCO FINANCE (PVT) LTD — NOVAFEED AGREEMENT", {
    x: ML, y: PH - 20, size: 9.5, font: bold, color: WHITE,
  });
  page.drawText(`Ref: ${jobRef}   ·   ${customer}   ·   Page ${pageNum} of ${total}`, {
    x: ML, y: PH - 31, size: 7, font: reg, color: rgb(0.85,1,1),
  });

  const y = PH - 36 - MT;
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

  // ── Extract all fields from formData ──────────────────────────────────────
  const loanType       = field(fd, "loan type", "loantype", "type best describes", "what type") || data.loanProduct || "Tier 2";
  const salesMethod    = field(fd, "customer sales method", "salesmethod", "sales method") || "—";
  const storeChain     = field(fd, "store chain", "storechain", "chain") || data.retailerName || "—";
  const storeBranch    = field(fd, "store branch", "storebranch", "branch name", "branch") || data.branchName || "—";
  const storeEmail     = field(fd, "store email", "storeemail", "email") || "—";
  const storePhone     = field(fd, "store telephone", "storephone", "store tel", "retailer phone") || "—";
  const storeManager   = field(fd, "store manager", "storemanager", "manager name", "manager") || "—";
  const retailerRef    = field(fd, "retailer reference", "retailerref", "retailer ref no", "ref no") || "—";
  const loanNo         = field(fd, "marishoma loan", "loan no", "loan number", "loanno") || "—";

  const dob            = field(fd, "date of birth", "dob", "birthdate") || "—";
  const age            = field(fd, "age") || "—";
  const nationalId     = field(fd, "id/passport", "id passport", "idpassport", "national id", "nationalid", "id number", "idnumber", "passport") || "—";
  const address        = field(fd, "residential address", "address") || "—";
  const maritalStatus  = field(fd, "marital status", "maritalstatus", "marital") || "—";
  const customerPhone  = data.customerPhone || field(fd, "mobile no", "mobile", "phone", "cellphone") || "—";

  const nextOfKin      = field(fd, "next of kin", "nextofkin", "kin") || "—";
  const kinRelation    = field(fd, "relationship to borrower", "relationship", "relation") || "—";
  const kinId          = field(fd, "kin id", "kin passport", "kin id/passport") || "—";
  const kinPhone       = field(fd, "kin mobile", "kin phone", "alternative contact") || "—";

  const loanTermDays   = field(fd, "loan term", "loanterm", "term days", "term") || "—";
  const appraisalRate  = field(fd, "appraisal fee rate", "appraisalrate", "appraisal rate") || "—";
  const dailyInterest  = field(fd, "daily interest", "dailyinterest") || "—";
  const termInterest   = field(fd, "term interest", "terminterest") || "—";

  const numChicks      = field(fd, "number of chicks", "numberofchicks", "chicks purchased", "chick quantity", "chicks") || "—";
  const loanAmtFig     = field(fd, "loan amount in figures", "loanamount", "loan amount") || fmtAmt(data.loanAmount);

  const appliedAmt     = field(fd, "applied loan amount", "appliedloanamount") || fmtAmt(data.loanAmount);
  const appliedTenor   = field(fd, "loan tenor", "tenor", "loantenor") || (loanTermDays !== "—" ? `${loanTermDays} Days` : "—");
  const monthlyInt     = field(fd, "monthly interest", "monthlyinterest", "monthly interest (%)") || "—";
  const disbDate       = field(fd, "disbursement date", "disbursementdate", "disbursement") || fmtDate(data.createdAt as string);
  const settleDate     = field(fd, "settlement date", "settlementdate", "settlement") || "—";
  const modeSettle     = field(fd, "mode of settlement", "modeofsettle", "mode") || "At Store Branch";
  const totalInterest  = field(fd, "total interest to term", "totalinterest", "total interest") || "—";
  const appraisalFee   = field(fd, "appraisal fee amount", "appraisalfee", "appraisal fee") || "—";
  const totalExpected  = field(fd, "total expected settlement", "totalexpected", "total settlement amount", "total amount") || fmtAmt(data.loanAmount);

  const settlementMethod = field(fd, "settlement method", "settlemethod") || "On Agreed Settlement Date";
  const supervisorName   = field(fd, "loan supervisor", "supervisor name", "supervisor") || "Tefco Finance";
  const agentName        = field(fd, "sales agent name", "salesagent", "agent name", "agent") || field(fd, "supervisor") || "—";
  const agentPhone       = field(fd, "sales agent cellphone", "agentphone", "agent phone", "agent cellphone") || storePhone;

  const jobRef    = data.formitizeJobId || String(data.id);
  const sigDate   = fmtDate(data.signedAt as string);
  const issueDate = fmtDate(data.createdAt as string);

  const sigs = {
    c1:  data.signatureData,
    c2:  data.customerSignature2,
    c3:  data.customerSignature3,
    mgr: data.managerSignature,
  };
  const isSigned = !!sigs.c1;
  const TOTAL_PAGES = 3;

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1 — Application details + Borrower + Next of kin + Preferred term
  // ══════════════════════════════════════════════════════════════════════════
  const ctx1 = await newPage(doc, bold, reg, sm, 1, TOTAL_PAGES, data.customerName, jobRef);

  ctx1.page.drawText(`Date: ${issueDate}`, { x: PW - MR - 100, y: ctx1.y + 2, size: 8, font: reg, color: MID });

  heading(ctx1, "Novafeed Agreement");
  fieldRow(ctx1, "What type best describes your loan application?", loanType);
  fieldRow(ctx1, "Customer Sales Method", salesMethod, "Store Chain", storeChain);
  fieldRow(ctx1, "Store Branch", storeBranch, "Store Email", storeEmail);
  fieldRow(ctx1, "Store Telephone Number", storePhone, "Store Manager Name", storeManager);
  fieldRow(ctx1, "Retailer Reference No", retailerRef, "Marishoma Loan No", loanNo);
  ctx1.y -= 4;

  heading(ctx1, "Borrowers Personal Details");
  fieldRow(ctx1, "Select Client", data.customerName, "Date of Birth", dob);
  fieldRow(ctx1, "Age", age, "I.D / Passport No.", nationalId);
  fieldFull(ctx1, "Residential Address", address);
  fieldRow(ctx1, "Mobile No.", customerPhone, "Marital Status", maritalStatus);
  ctx1.y -= 4;

  heading(ctx1, "Next of Kin / Alternative Contact Details");
  fieldRow(ctx1, "Next of Kin", nextOfKin, "Relationship to Borrower", kinRelation);
  fieldRow(ctx1, "I.D / Passport No.", kinId, "Mobile No.", kinPhone);
  ctx1.y -= 4;

  heading(ctx1, "Preferred Loan Term");
  fieldRow(ctx1, "Loan Term", loanTermDays !== "—" ? `${loanTermDays} Days` : "—", "Appraisal Fee Rate", appraisalRate !== "—" ? `${appraisalRate}%` : "—");
  fieldRow(ctx1, "Daily Interest", dailyInterest !== "—" ? `${dailyInterest}%` : "—", "Term Interest", termInterest !== "—" ? `${termInterest}%` : "—");
  ctx1.y -= 4;

  heading(ctx1, "Loan Amount");
  fieldRow(ctx1, "Number of Chicks Purchased", numChicks, "Loan Amount in Figures (USD)", loanAmtFig);

  ctx1.y = 30;
  drawLine(ctx1, LGREY);
  ctx1.y -= 10;
  text(ctx1, `Tefco Finance (Pvt) Ltd  ·  HukuPlus Central  ·  Ref: ${jobRef}  ·  Submission ID: ${jobRef}`, ML, 6, GREY);

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 2 — Applied Loan Details + Signatures 1 & 2 + Approved + Sig 3
  // ══════════════════════════════════════════════════════════════════════════
  const ctx2 = await newPage(doc, bold, reg, sm, 2, TOTAL_PAGES, data.customerName, jobRef);

  heading(ctx2, "Applied Loan Details");
  fieldRow(ctx2, "Loan Amount", appliedAmt, "Loan Tenor", appliedTenor);
  fieldRow(ctx2, "Monthly Interest (%)", monthlyInt !== "—" ? `${monthlyInt}%` : "—", "Daily Interest (%)", dailyInterest !== "—" ? `${dailyInterest}%` : "—");
  fieldRow(ctx2, "Disbursement Date", disbDate, "Settlement Date", settleDate);
  fieldFull(ctx2, "Mode of Settlement", modeSettle);

  // Summary table (right-aligned values)
  const tbl = [
    ["Total Interest to Term (" + appliedTenor + ")", totalInterest !== "—" ? `$ ${totalInterest}` : "—"],
    ["Appraisal Fee Amount (USD)", appraisalFee !== "—" ? `$ ${appraisalFee}` : "—"],
    ["Total Expected Settlement Amount (USD)", totalExpected !== "—" ? `$ ${totalExpected}` : totalExpected],
  ];
  for (const [lbl, val] of tbl) {
    text(ctx2, lbl, ML, 8.5, DARK);
    text(ctx2, val, PW - MR - ctx2.bold.widthOfTextAtSize(val, 9), 9, DARK, true, ctx2.bold);
    ctx2.y -= 14;
    drawLine(ctx2);
    ctx2.y -= 6;
  }
  ctx2.y -= 4;

  heading(ctx2, "Loan Origination Cost");
  fieldFull(ctx2, "Appraisal Fee Amount (USD)", appraisalFee !== "—" ? `$ ${appraisalFee}` : "—");
  wrap(ctx2,
    "It is hereby understood and agreed that the appraisal fee shall be recovered in full from the borrower. " +
    "Repayments to be made at Novafeeds branch into the account of HukuPlus.",
    ML, CW, 8, MID, 12
  );
  ctx2.y -= 8;

  text(ctx2, "Borrower Print Signature:", ML, 8, MID);
  ctx2.y -= 6;
  printSigLine(ctx2, "");
  await sigBlock(ctx2, "Customer Signature 1 of 3", "Acknowledgement of loan agreement terms", sigs.c1);
  ctx2.y -= 4;

  wrap(ctx2,
    "That the Borrower hereby acknowledges the loan details as applied. The Borrower further understands and agrees that if upon " +
    "appraisal the Borrower fails to qualify for the applied loan amount, the Lender shall be at liberty to determine the applicable loan " +
    "amount that the Borrower is eligible for.",
    ML, CW, 7.5, MID, 11
  );
  ctx2.y -= 6;
  wrap(ctx2,
    "The Borrower hereby understands and acknowledges that Marishoma Finance (A Division of Tefco Finance), and its loan product " +
    "'HukuPlus' do not accept any responsibility for the risk attached to chick mortalities, nor any defects in any of the products purchased from the supplier store.",
    ML, CW, 7.5, MID, 11
  );
  ctx2.y -= 6;
  text(ctx2, "Borrower Print Signature:", ML, 8, MID);
  ctx2.y -= 6;
  printSigLine(ctx2, "");
  await sigBlock(ctx2, "Customer Signature 2 of 3", "Repayment schedule confirmation", sigs.c2);

  ctx2.y = 30;
  drawLine(ctx2, LGREY);
  ctx2.y -= 10;
  text(ctx2, `Tefco Finance (Pvt) Ltd  ·  HukuPlus Central  ·  Ref: ${jobRef}`, ML, 6, GREY);

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 3 — Approved Loan Details + Supervisor + Sales Agent + Execution
  // ══════════════════════════════════════════════════════════════════════════
  const ctx3 = await newPage(doc, bold, reg, sm, 3, TOTAL_PAGES, data.customerName, jobRef);

  heading(ctx3, "Approved Loan Details");
  fieldFull(ctx3, "Settlement Method", settlementMethod);
  wrap(ctx3,
    "The Borrower hereby has understood and agreed to the approved loan details indicated on part 6 on this agreement.",
    ML, CW, 8.5, MID, 12
  );
  ctx3.y -= 8;
  text(ctx3, "Borrower Print Signature:", ML, 8, MID);
  ctx3.y -= 6;
  printSigLine(ctx3, "");
  await sigBlock(ctx3, "Customer Signature 3 of 3", "Final authorisation of the Novafeed Agreement", sigs.c3);
  fieldRow(ctx3, "Date", isSigned ? sigDate : issueDate);
  ctx3.y -= 4;

  heading(ctx3, "Loan Approval Personnel");
  fieldFull(ctx3, "Loan Supervisor Name", supervisorName);
  text(ctx3, "Supervisor Signature:", ML, 8, MID);
  ctx3.y -= 6;
  await sigBlock(ctx3, "Supervisor / Store Manager", "Authorised representative of Tefco Finance (Pvt) Ltd", sigs.mgr);
  fieldRow(ctx3, "Date", isSigned ? sigDate : issueDate);
  ctx3.y -= 4;

  heading(ctx3, "Sales Agent");
  fieldRow(ctx3, "Sales Agent Name", agentName, "Sales Agent Cellphone No", agentPhone);
  text(ctx3, "Sales Agent Signature:", ML, 8, MID);
  ctx3.y -= 6;
  printSigLine(ctx3, "");
  fieldRow(ctx3, "Date", isSigned ? sigDate : issueDate);
  ctx3.y -= 8;

  if (isSigned) {
    ctx3.page.drawRectangle({ x: ML, y: ctx3.y - 30, width: CW, height: 30, color: rgb(0.93,1,0.95), borderColor: rgb(0.3,0.7,0.4), borderWidth: 0.8 });
    text({ ...ctx3, y: ctx3.y - 11 }, "AGREEMENT FULLY EXECUTED", ML + 8, 9.5, rgb(0.1,0.5,0.2), false, bold);
    text({ ...ctx3, y: ctx3.y - 22 }, `All signatures captured on ${sigDate} via HukuPlus Central · Tefco Finance (Pvt) Ltd`, ML + 8, 7, rgb(0.2,0.5,0.3));
    ctx3.y -= 36;
  }

  ctx3.y = 50;
  wrap(ctx3, "All Customer queries and complaints can be directed by Voice, SMS or Whatsapp to Helpline no +263 780 563 477.", ML, CW, 7.5, MID, 11);
  ctx3.y -= 4;
  drawLine(ctx3, LGREY);
  ctx3.y -= 10;
  text(ctx3,
    `Tefco Finance (Pvt) Ltd  ·  MFA2429/120  ·  30001 Dagenham Road, Willowvale, Harare  ·  Ref: ${jobRef}${isSigned ? "  ·  Executed: " + sigDate : "  ·  PENDING SIGNATURE"}`,
    ML, 6, GREY
  );

  return doc.save();
}
