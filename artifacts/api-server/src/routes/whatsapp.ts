import { Router } from "express";
import { db, whatsappMessagesTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

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

  // WATI sends eventType = "message" for incoming messages
  if (body?.eventType !== "message" || body?.owner === true) {
    res.sendStatus(200);
    return;
  }

  try {
    await db.insert(whatsappMessagesTable).values({
      conversationId: body.conversationId ?? body.waId ?? "unknown",
      waId:           body.waId ?? "",
      senderName:     body.senderName ?? body.messageContact?.name ?? null,
      messageText:    body.text ?? null,
      messageType:    body.type ?? "text",
      direction:      "inbound",
      watiMessageId:  body.whatsappMessageId ?? null,
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

  const rows = await db.execute(sql`
    SELECT DISTINCT ON (wa_id)
      wa_id         AS "waId",
      sender_name   AS "senderName",
      message_text  AS "lastMessage",
      direction,
      created_at    AS "lastAt",
      (
        SELECT COUNT(*)::int FROM whatsapp_messages m2
        WHERE m2.wa_id = whatsapp_messages.wa_id
          AND m2.is_read = false
          AND m2.direction = 'inbound'
      ) AS "unreadCount"
    FROM whatsapp_messages
    ORDER BY wa_id, created_at DESC
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

  const [row] = await db.execute(sql`
    SELECT COUNT(DISTINCT wa_id)::int AS count
    FROM whatsapp_messages
    WHERE is_read = false AND direction = 'inbound'
  `);

  res.json({ count: (row as any)?.count ?? 0 });
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

  // Store the outbound message locally
  const conversationId = phone;
  await db.insert(whatsappMessagesTable).values({
    conversationId,
    waId:        phone,
    senderName:  "Tefco Finance",
    messageText,
    messageType: "text",
    direction:   "outbound",
    isRead:      true,
  });

  res.json({ ok: true });
});

export default router;
