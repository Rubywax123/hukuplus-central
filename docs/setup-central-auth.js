/**
 * HukuPlusCentral API Key Setup Script
 * Run this once in each loan app's Shell:  node setup-central-auth.js
 */

const fs = require("fs");
const path = require("path");

const CENTRAL_API_KEY = "CENTRAL_DD1D709C6E4708C877D5DB07DC9C71BBE15439747780FBF26996A3BCDC9AA56D";

// ── 1. Find the middleware directory ─────────────────────────────────────────
const candidateDirs = [
  "server/middleware", "src/middleware", "server/middlewares",
  "src/middlewares", "middleware", "middlewares",
];
let middlewareDir = candidateDirs.find((d) => fs.existsSync(d));
if (!middlewareDir) {
  const first = candidateDirs[0];
  fs.mkdirSync(first, { recursive: true });
  middlewareDir = first;
  console.log(`📁 Created middleware directory: ${first}`);
}

// ── 2. Create centralAuthMiddleware.ts ───────────────────────────────────────
const middlewareContent = `import { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      isCentralSystem?: boolean;
    }
  }
}

export function centralAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers["authorization"];
  const centralKey = process.env.CENTRAL_API_KEY;
  if (centralKey && authHeader === \`Bearer \${centralKey}\`) {
    req.isCentralSystem = true;
  }
  next();
}
`;

const middlewareFile = path.join(middlewareDir, "centralAuthMiddleware.ts");
fs.writeFileSync(middlewareFile, middlewareContent);
console.log(`✅ Created: ${middlewareFile}`);

// ── 3. Find app.ts / server.ts ───────────────────────────────────────────────
const appCandidates = [
  "server/app.ts","src/app.ts","server/index.ts","src/index.ts",
  "app.ts","index.ts","server.ts",
];
const appFile = appCandidates.find((f) => fs.existsSync(f));
if (appFile) {
  let content = fs.readFileSync(appFile, "utf8");
  const relPath = path
    .relative(path.dirname(appFile), middlewareFile)
    .replace(/\\/g, "/")
    .replace(/\.ts$/, "");

  const importLine = `import { centralAuthMiddleware } from "./${relPath}";\n`;
  const useLine = `app.use(centralAuthMiddleware);\n`;

  if (!content.includes("centralAuthMiddleware")) {
    // Insert import after the last existing import line
    content = content.replace(
      /((?:^import .+;\n)+)/m,
      (match) => match + importLine
    );
    // Insert app.use line before the first existing app.use(
    content = content.replace(/^(app\.use\()/m, useLine + "$1");
    fs.writeFileSync(appFile, content);
    console.log(`✅ Patched: ${appFile}  (import + app.use added)`);
  } else {
    console.log(`⏭  Skipped: ${appFile}  (already patched)`);
  }
} else {
  console.log(`⚠️  Could not find app.ts or server.ts — add manually:\n   import { centralAuthMiddleware } from "./${middlewareDir}/centralAuthMiddleware";\n   app.use(centralAuthMiddleware);`);
}

// ── 4. Find the auth middleware and add the bypass line ──────────────────────
const authCandidates = [
  `${middlewareDir}/authMiddleware.ts`,
  `${middlewareDir}/auth.ts`,
  `${middlewareDir}/requireAuth.ts`,
  "server/middleware/auth.ts","src/middleware/auth.ts",
];
const authFile = authCandidates.find((f) => fs.existsSync(f));
if (authFile) {
  let content = fs.readFileSync(authFile, "utf8");
  const bypass = `  if (req.isCentralSystem) return next(); // HukuPlusCentral system\n`;

  if (!content.includes("isCentralSystem")) {
    // Insert after the opening line of the exported function
    content = content.replace(
      /(export (?:async )?function \w+[^{]+\{)/,
      "$1\n" + bypass
    );
    fs.writeFileSync(authFile, content);
    console.log(`✅ Patched: ${authFile}  (bypass line added)`);
  } else {
    console.log(`⏭  Skipped: ${authFile}  (already has bypass)`);
  }
} else {
  console.log(`⚠️  Could not find auth middleware file — add this line manually at the top of your auth function:\n   if (req.isCentralSystem) return next();`);
}

// ── 5. Remind about the Secret ───────────────────────────────────────────────
console.log(`
════════════════════════════════════════════════════════
  DONE! One last thing — add this Secret in Replit:

  Key:   CENTRAL_API_KEY
  Value: ${CENTRAL_API_KEY}

  Then restart this app. HukuPlusCentral will connect.
════════════════════════════════════════════════════════
`);
