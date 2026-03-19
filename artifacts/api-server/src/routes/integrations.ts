import { Router } from "express";

const router = Router();

const LOAN_APPS = [
  {
    id: "hukuplus",
    name: "HukuPlus",
    description: "Broiler Feed Facility — 42-day credit, feed now pay when you sell.",
    url: process.env.HUKUPLUS_URL || "https://loan-manager-automate.replit.app",
    product: "HukuPlus",
    color: "orange",
    apiKeyEnv: "HUKUPLUS_API_KEY",
  },
  {
    id: "revolver",
    name: "Revolver",
    description: "Feed Wallet Credit Facility for Layers — revolving credit, pay as you sell.",
    url: process.env.REVOLVER_URL || "https://credit-facility-manager.replit.app",
    product: "Revolver",
    color: "blue",
    apiKeyEnv: "REVOLVER_API_KEY",
  },
  {
    id: "chikweretion",
    name: "ChikweretiOne",
    description: "Payroll Deduction Facility — personal loans repaid via salary, 3–12 months.",
    url: process.env.CHIKWERETION_URL || "https://loan-mastermind--cz86dbq6qp.replit.app",
    product: "ChikweretiOne",
    color: "gold",
    apiKeyEnv: "CHIKWERETION_API_KEY",
  },
];

router.get("/integrations/apps", (req, res) => {
  const apps = LOAN_APPS.map((app) => ({
    ...app,
    hasApiKey: !!process.env[app.apiKeyEnv],
    status: process.env[app.apiKeyEnv] ? "connected" : "api_key_required",
  }));
  res.json(apps);
});

router.get("/integrations/apps/:id/ping", async (req, res) => {
  const app = LOAN_APPS.find((a) => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: "App not found" });

  const apiKey = process.env[app.apiKeyEnv];
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${app.url}/api/health`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const reachable = response.status !== 404;
    const authorized = response.status !== 401 && response.status !== 403;
    res.json({
      id: app.id,
      reachable,
      authorized,
      status: reachable && authorized ? "ok" : reachable ? "unauthorized" : "unreachable",
      httpStatus: response.status,
    });
  } catch (err: any) {
    res.json({
      id: app.id,
      reachable: false,
      authorized: false,
      status: "unreachable",
      error: err.message,
    });
  }
});

export default router;
