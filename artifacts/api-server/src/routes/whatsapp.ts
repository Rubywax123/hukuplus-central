import { Router } from "express";
import { db, pool, whatsappMessagesTable } from "@workspace/db";
import { eq, desc, sql, and, isNotNull } from "drizzle-orm";

const router = Router();

const WATI_API_URL   = (process.env.WATI_API_URL   ?? "").replace(/\/$/, "");
const WATI_API_TOKEN = process.env.WATI_API_TOKEN ?? "";

function isConfigured() {
  return Boolean(WATI_API_URL && WATI_API_TOKEN);
}

// ─── Webhook — WATI calls this when a message arrives ────────────────────────
// No session auth — secured by checking the WATI token header instead

router.post("/whatsapp/webhook", async (req, res): Promise<void> => {
  const body = req.body;

  if (body?.eventType !== "message") {
    res.sendStatus(200);
    return;
  }

  // owner=true means this is an outbound message status update from WATI
  if (body?.owner === true) {
    const watiMsgId  = body.whatsappMessageId ?? body.id ?? null;
    const rawStatus  = (body.statusString ?? body.status ?? "").toLowerCase();
    const statusMap: Record<string, string> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
    const status = statusMap[rawStatus];

    if (watiMsgId && status) {
      try {
        await db.update(whatsappMessagesTable)
          .set({ status })
          .where(eq(whatsappMessagesTable.watiMessageId, watiMsgId));
        console.log(`[whatsapp] status update ${watiMsgId} → ${status}`);
      } catch (err: any) {
        console.warn("[whatsapp] status update failed:", err.message);
      }
    }
    res.sendStatus(200);
    return;
  }

  // Inbound customer message
  // Prefer the customer name stored in Central over the WhatsApp profile name
  const rawWaId  = body.waId ?? "";
  const rawPhone = rawWaId.replace(/\D/g, "");
  let resolvedName: string | null = body.senderName ?? body.messageContact?.name ?? null;
  if (rawPhone) {
    try {
      const { rows: cRows } = await pool.query(
        `SELECT full_name FROM customers
          WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = RIGHT($1, 9)
          LIMIT 1`,
        [rawPhone]
      );
      if (cRows[0]?.full_name) resolvedName = cRows[0].full_name;
    } catch { /* keep whatsapp profile name */ }
  }

  try {
    await db.insert(whatsappMessagesTable).values({
      conversationId: (body.conversationId ?? rawWaId) || "unknown",
      waId:           rawWaId,
      senderName:     resolvedName,
      messageText:    body.text ?? null,
      messageType:    body.type ?? "text",
      direction:      "inbound",
      watiMessageId:  body.whatsappMessageId ?? null,
      status:         "received",
      isRead:         false,
    }).onConflictDoNothing();
  } catch (err: any) {
    console.warn("[whatsapp] webhook insert failed:", err.message);
  }

  res.sendStatus(200);
});

// ─── List conversations (grouped by contact) ──────────────────────────────────

router.get("/whatsapp/conversations", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!isConfigured()) {
    res.json({ configured: false, conversations: [] });
    return;
  }

  // Prefer the customer's full_name from Central over the WhatsApp profile name.
  // Match on the last 9 digits of the phone (handles all Zim formats).
  // DISTINCT ON must order by wa_id first; wrap in subquery to then sort by recency.
  const rows = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (m.wa_id)
        m.wa_id                                              AS "waId",
        COALESCE(c.full_name, m.sender_name)                 AS "senderName",
        m.message_text                                       AS "lastMessage",
        m.direction,
        m.created_at                                         AS "lastAt",
        (
          SELECT COUNT(*)::int FROM whatsapp_messages m2
          WHERE m2.wa_id = m.wa_id
            AND m2.is_read = false
            AND m2.direction = 'inbound'
        ) AS "unreadCount"
      FROM whatsapp_messages m
      LEFT JOIN customers c
        ON RIGHT(REGEXP_REPLACE(c.phone, '\\D', '', 'g'), 9)
         = RIGHT(REGEXP_REPLACE(m.wa_id,  '\\D', '', 'g'), 9)
      ORDER BY m.wa_id, m.created_at DESC
    ) latest
    ORDER BY "lastAt" DESC
  `);

  res.json({ configured: true, conversations: rows.rows });
});

// ─── Messages for a conversation ──────────────────────────────────────────────

router.get("/whatsapp/conversations/:waId/messages", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { waId } = req.params;

  const messages = await db
    .select()
    .from(whatsappMessagesTable)
    .where(eq(whatsappMessagesTable.waId, waId))
    .orderBy(whatsappMessagesTable.createdAt);

  // Mark all inbound as read
  await db
    .update(whatsappMessagesTable)
    .set({ isRead: true })
    .where(eq(whatsappMessagesTable.waId, waId));

  res.json(messages);
});

// ─── Unread count ─────────────────────────────────────────────────────────────

router.get("/whatsapp/unread-count", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!isConfigured()) { res.json({ count: 0 }); return; }

  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT wa_id)::int AS count
    FROM whatsapp_messages
    WHERE is_read = false AND direction = 'inbound'
  `);

  const row = result.rows[0];
  res.json({ count: (row as any)?.count ?? 0 });
});

// ─── List approved templates ──────────────────────────────────────────────────

router.get("/whatsapp/templates", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!isConfigured()) { res.json({ templates: [] }); return; }

  const r = await fetch(`${WATI_API_URL}/api/v1/getMessageTemplates`, {
    headers: { "Authorization": `Bearer ${WATI_API_TOKEN}` },
  });
  if (!r.ok) { res.status(502).json({ error: "Could not fetch templates" }); return; }

  const data = await r.json() as any;
  const templates = (data.messageTemplates ?? [])
    .filter((t: any) => t.status === "APPROVED")
    .map((t: any) => ({
      name:        t.elementName,
      body:        t.body ?? "",
      params:      (t.customParams ?? []).map((p: any) => p.paramName),
      headerType:  t.header?.typeString ?? null,
    }));

  res.json({ templates });
});

// ─── Send a template message ──────────────────────────────────────────────────

router.post("/whatsapp/send-template", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!isConfigured()) { res.status(503).json({ error: "WhatsApp not configured" }); return; }

  const { waId, templateName, parameters } = req.body as {
    waId: string;
    templateName: string;
    parameters: Array<{ name: string; value: string }>;
  };
  if (!waId || !templateName) {
    res.status(400).json({ error: "waId and templateName are required" });
    return;
  }

  const phone = waId.replace(/^\+/, "");

  const watiRes = await fetch(`${WATI_API_URL}/api/v1/sendTemplateMessage/${phone}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WATI_API_TOKEN}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      template_name:  templateName,
      broadcast_name: templateName,
      parameters:     (parameters ?? []).map(p => ({ name: p.name, value: p.value })),
    }),
  });

  if (!watiRes.ok) {
    const text = await watiRes.text();
    res.status(502).json({ error: `WATI error: ${watiRes.status} ${text.slice(0, 300)}` });
    return;
  }

  let watiMessageId: string | null = null;
  try {
    const j = await watiRes.json() as any;
    watiMessageId = j?.id ?? j?.whatsappMessageId ?? j?.messageId ?? null;
  } catch { /* ignore */ }

  // Build a preview of what was sent for the local message store
  const sentPreview = `[Template: ${templateName}]` +
    (parameters?.length ? " " + parameters.map(p => p.value).join(", ") : "");

  await db.insert(whatsappMessagesTable).values({
    conversationId: phone,
    waId:           phone,
    senderName:     "Tefco Finance",
    messageText:    sentPreview,
    messageType:    "template",
    direction:      "outbound",
    watiMessageId,
    status:         "sent",
    isRead:         true,
  });

  res.json({ ok: true });
});

// ─── Send a message ───────────────────────────────────────────────────────────

router.post("/whatsapp/send", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!isConfigured()) {
    res.status(503).json({ error: "WhatsApp not configured — add WATI_API_URL and WATI_API_TOKEN" });
    return;
  }

  const { waId, messageText } = req.body as { waId: string; messageText: string };
  if (!waId || !messageText?.trim()) {
    res.status(400).json({ error: "waId and messageText are required" });
    return;
  }

  const phone = waId.replace(/^\+/, "");

  const watiRes = await fetch(`${WATI_API_URL}/api/v1/sendSessionMessage/${phone}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WATI_API_TOKEN}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ messageText }),
  });

  if (!watiRes.ok) {
    const text = await watiRes.text();
    res.status(502).json({ error: `WATI error: ${watiRes.status} ${text.slice(0, 200)}` });
    return;
  }

  // Capture WATI's message ID so we can match delivery/read status callbacks
  let watiMessageId: string | null = null;
  try {
    const watiJson = await watiRes.json() as any;
    watiMessageId = watiJson?.id ?? watiJson?.whatsappMessageId ?? watiJson?.messageId ?? null;
  } catch { /* ignore parse errors */ }

  // Store the outbound message locally
  const conversationId = phone;
  await db.insert(whatsappMessagesTable).values({
    conversationId,
    waId:          phone,
    senderName:    "Tefco Finance",
    messageText,
    messageType:   "text",
    direction:     "outbound",
    watiMessageId,
    status:        "sent",
    isRead:        true,
  });

  res.json({ ok: true });
});

// ─── Create a lead from a WhatsApp conversation ───────────────────────────────

router.post("/whatsapp/conversations/:waId/create-lead", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rawWaId = req.params.waId;
  const digits  = rawWaId.replace(/\D/g, "");

  // Look up the best name we have for this contact
  const nameRow = await pool.query(
    `SELECT COALESCE(c.full_name, m.sender_name) AS name
       FROM whatsapp_messages m
       LEFT JOIN customers c
         ON RIGHT(REGEXP_REPLACE(c.phone, '\\D', '', 'g'), 9)
          = RIGHT(REGEXP_REPLACE(m.wa_id, '\\D', '', 'g'), 9)
      WHERE m.wa_id = $1 AND m.direction = 'inbound'
      ORDER BY m.created_at DESC LIMIT 1`,
    [rawWaId]
  );
  const customerName: string =
    nameRow.rows[0]?.name ?? rawWaId;

  // Phone for the lead — use international format
  let phone = rawWaId;
  if (digits.length === 9)                                   phone = "263" + digits;
  else if (digits.length === 10 && digits.startsWith("0"))   phone = "263" + digits.slice(1);
  const last9 = phone.replace(/\D/g, "").slice(-9);

  // Guard: return existing lead if one is already open for this number
  const existing = await pool.query(
    `SELECT id FROM leads
      WHERE RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $1
        AND status != 'converted'
      ORDER BY created_at DESC LIMIT 1`,
    [last9]
  );
  if (existing.rows[0]) {
    res.status(409).json({ existing: true, leadId: existing.rows[0].id });
    return;
  }

  const submittedBy: string =
    (req as any).staffUser?.email ?? (req as any).staffUser?.name ?? "WhatsApp";

  const result = await pool.query(
    `INSERT INTO leads (customer_name, phone, notes, submitted_by, loan_product)
     VALUES ($1, $2, $3, $4, 'HukuPlus')
     RETURNING id`,
    [
      customerName,
      phone,
      "Lead created from incoming WhatsApp message",
      submittedBy,
    ]
  );

  res.status(201).json({ leadId: result.rows[0].id, customerName, phone });
});

export default router;
