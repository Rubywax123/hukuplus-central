import nodemailer from "nodemailer";

const SMTP_HOST = process.env.EMAIL_SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.EMAIL_SMTP_PORT || "587");
const SMTP_USER = process.env.EMAIL_SMTP_USER || "";
const SMTP_PASS = process.env.EMAIL_SMTP_PASS || "";
const FROM_ADDRESS = "operations@marishoma.com";

function getTransport() {
  if (!SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    console.warn("[mailer] SMTP not configured — email not sent.");
    console.log(`[mailer] Would send to: ${Array.isArray(opts.to) ? opts.to.join(", ") : opts.to}`);
    console.log(`[mailer] Subject: ${opts.subject}`);
    return;
  }
  await transport.sendMail({
    from: `"Tefco Finance" <${FROM_ADDRESS}>`,
    to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}

export function loanApplicationEmail(data: {
  customerName: string;
  customerPhone: string;
  chickCount: number;
  chickPurchaseDate: string;
  expectedCollectionDate: string;
  amountRequested: number;
  amountLimit: number;
  storeName: string;
  collectionStoreName: string;
  applicationId: number;
}): string {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#f97316;padding:20px 24px">
      <h1 style="color:#fff;margin:0;font-size:20px">HukuPlus Repeat Loan Application</h1>
      <p style="color:#ffe0c2;margin:4px 0 0;font-size:14px">Application #${data.applicationId}</p>
    </div>
    <div style="padding:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#666;font-size:14px;width:180px">Customer Name</td><td style="padding:8px 0;font-weight:bold;font-size:14px">${data.customerName}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Customer Phone</td><td style="padding:8px 0;font-size:14px">${data.customerPhone || "N/A"}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Registered Store</td><td style="padding:8px 0;font-size:14px">${data.storeName}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Collection Store</td><td style="padding:8px 0;font-size:14px">${data.collectionStoreName}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Chicks Purchased</td><td style="padding:8px 0;font-size:14px">${data.chickCount} chicks</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Chick Purchase Date</td><td style="padding:8px 0;font-size:14px">${data.chickPurchaseDate}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Expected Collection</td><td style="padding:8px 0;font-size:14px">${data.expectedCollectionDate}</td></tr>
        <tr style="border-top:2px solid #f97316"><td style="padding:12px 0 8px;color:#666;font-size:14px">Amount Requested</td><td style="padding:12px 0 8px;font-weight:bold;font-size:16px;color:#f97316">${fmt(data.amountRequested)}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Max Approved Limit</td><td style="padding:8px 0;font-size:14px">${fmt(data.amountLimit)}</td></tr>
      </table>
      <div style="margin-top:20px;padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px">
        <p style="margin:0;font-size:13px;color:#9a3412">Please review this application in <strong>HukuPlusCentral</strong> and take appropriate action.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function drawdownRequestEmail(data: {
  customerName: string;
  customerPhone: string;
  amountRequested: number;
  facilityLimit: number;
  facilityBalance: number;
  defaultStoreName: string;
  collectionStoreName: string;
  requestId: number;
}): string {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#3b82f6;padding:20px 24px">
      <h1 style="color:#fff;margin:0;font-size:20px">Revolver Drawdown Request</h1>
      <p style="color:#bfdbfe;margin:4px 0 0;font-size:14px">Request #${data.requestId}</p>
    </div>
    <div style="padding:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#666;font-size:14px;width:180px">Customer Name</td><td style="padding:8px 0;font-weight:bold;font-size:14px">${data.customerName}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Customer Phone</td><td style="padding:8px 0;font-size:14px">${data.customerPhone || "N/A"}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Default Store</td><td style="padding:8px 0;font-size:14px">${data.defaultStoreName}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Collection Store</td><td style="padding:8px 0;font-size:14px;font-weight:bold">${data.collectionStoreName}</td></tr>
        <tr style="border-top:2px solid #3b82f6"><td style="padding:12px 0 8px;color:#666;font-size:14px">Amount Requested</td><td style="padding:12px 0 8px;font-weight:bold;font-size:16px;color:#3b82f6">${fmt(data.amountRequested)}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Facility Limit</td><td style="padding:8px 0;font-size:14px">${fmt(data.facilityLimit)}</td></tr>
        <tr><td style="padding:8px 0;color:#666;font-size:14px">Available Balance</td><td style="padding:8px 0;font-size:14px">${fmt(data.facilityBalance)}</td></tr>
      </table>
      <div style="margin-top:20px;padding:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px">
        <p style="margin:0;font-size:13px;color:#1e40af">Please action this drawdown and confirm in <strong>HukuPlusCentral</strong> or the store portal.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
