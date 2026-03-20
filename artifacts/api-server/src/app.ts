import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { authMiddleware } from "./middlewares/authMiddleware";
import { portalAuthMiddleware } from "./middlewares/portalAuthMiddleware";
import { staffAuthMiddleware } from "./middlewares/staffAuthMiddleware";
import router from "./routes";

const app: Express = express();

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(staffAuthMiddleware);
app.use(authMiddleware);
app.use(portalAuthMiddleware);

app.use("/api", router);

// ── Serve frontend in production ──────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(__dirname, "../../hukupluscentral/dist/public");
  app.use(express.static(frontendDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
