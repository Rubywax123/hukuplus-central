import { Router } from "express";

const router = Router();

const CENTRAL_API_KEY = process.env.CENTRAL_API_KEY;

const LOAN_APPS = [
  {
    id: "hukuplus",
    name: "HukuPlus",
    description: "Broiler Feed Facility — 42-day credit, feed now pay when you sell.",
    url: process.env.HUKUPLUS_URL || "https://loan-manager-automate.replit.app",
    product: "HukuPlus",
    color: "orange",
  },
  {
    id: "revolver",
    name: "Revolver",
    description: "Feed Wallet Credit Facility for Layers — revolving credit, pay as you sell.",
    url: process.env.REVOLVER_URL || "https://credit-facility-manager.replit.app",
    product: "Revolver",
    color: "blue",
  },
  {
    id: "chikweretion",
    name: "ChikweretiOne",
    description: "Payroll Deduction Facility — personal loans repaid via salary, 3–12 months.",
    url: process.env.CHIKWERETION_URL || "https://loan-mastermind--cz86dbq6qp.replit.app",
    product: "ChikweretiOne",
    color: "gold",
  },
];

router.get("/integrations/apps", (req, res) => {
  const apps = LOAN_APPS.map((app) => ({
    ...app,
    hasApiKey: !!CENTRAL_API_KEY,
    status: CENTRAL_API_KEY ? "key_ready" : "no_key",
  }));
  res.json(apps);
});

router.get("/integrations/apps/:id/ping", async (req, res) => {
  const app = LOAN_APPS.find((a) => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "App not found" });

  const headers: Record<string, string> = {};
  if (CENTRAL_API_KEY) {
    headers["Authorization"] = `Bearer ${CENTRAL_API_KEY}`;
    headers["X-Central-System"] = "HukuPlusCentral";
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${app.url}/api/health`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    let body: any = {};
    try { body = await response.json(); } catch { /* non-JSON response is fine */ }

    const reachable = response.status < 500;
    const authorized = response.status !== 401 && response.status !== 403;
    const centralRecognised = body?.source === "HukuPlusCentral" || body?.centralAuth === true;

    res.json({
      id: app.id,
      reachable,
      authorized,
      centralRecognised,
      status: centralRecognised ? "central_connected" : reachable && authorized ? "reachable_no_central_auth" : reachable ? "unauthorized" : "unreachable",
      httpStatus: response.status,
    });
  } catch (err: any) {
    res.json({
      id: app.id,
      reachable: false,
      authorized: false,
      centralRecognised: false,
      status: "unreachable",
      error: err.message,
    });
  }
});

export default router;
