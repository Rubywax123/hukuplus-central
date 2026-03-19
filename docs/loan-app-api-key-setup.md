# Enabling HukuPlusCentral API Access in Each Loan App

## What This Does

Adds a small API key check to each loan app so HukuPlusCentral can call their
APIs in the background as a trusted system — without needing to log in as a user.

## The Shared Key

This key is already stored in HukuPlusCentral as `CENTRAL_API_KEY`. Add it to
each loan app as the env var shown in each section below.

```
CENTRAL_DD1D709C6E4708C877D5DB07DC9C71BBE15439747780FBF26996A3BCDC9AA56D
```

---

## HukuPlus (loan-manager-automate.replit.app)

### Step 1 — Add the env var in Secrets
Key: `CENTRAL_API_KEY`
Value: `CENTRAL_DD1D709C6E4708C877D5DB07DC9C71BBE15439747780FBF26996A3BCDC9AA56D`

### Step 2 — Create the middleware file
Create: `src/middleware/centralAuthMiddleware.ts`

```typescript
import { Request, Response, NextFunction } from "express";

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

  if (centralKey && authHeader === `Bearer ${centralKey}`) {
    req.isCentralSystem = true;
  }

  next(); // Always continue — this just flags the request, doesn't block
}
```

### Step 3 — Wire it into app.ts (before other middleware)
```typescript
import { centralAuthMiddleware } from "./middleware/centralAuthMiddleware";

// Add BEFORE authMiddleware:
app.use(centralAuthMiddleware);
```

### Step 4 — Update authMiddleware.ts to allow system requests through
Find the section in your authMiddleware that returns 401. Wrap it like this:

```typescript
// At the TOP of your auth middleware function, add:
if (req.isCentralSystem) {
  return next(); // HukuPlusCentral system — skip user auth
}
```

### Step 5 — Add a health endpoint that confirms central auth
In your health/routes file, add:
```typescript
router.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    centralAuth: req.isCentralSystem === true,
    source: req.isCentralSystem ? "HukuPlusCentral" : "public",
  });
});
```

---

## Revolver (credit-facility-manager.replit.app)

Same steps as HukuPlus above — identical middleware code and same key value.

---

## ChikweretiOne (loan-mastermind--cz86dbq6qp.replit.app)

Same steps as HukuPlus above — identical middleware code and same key value.

---

## After Setup

Once the changes are deployed in each loan app, the "Ping" button on the
HukuPlusCentral Loan Apps page will show **"Central Connected"** for that app.
HukuPlusCentral will then be able to pull live loan data automatically.
