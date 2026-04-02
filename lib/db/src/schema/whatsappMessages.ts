import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const whatsappMessagesTable = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  waId: text("wa_id").notNull(),
  senderName: text("sender_name"),
  messageText: text("message_text"),
  messageType: text("message_type").notNull().default("text"),
  direction: text("direction").notNull(),
  watiMessageId: text("wati_message_id").unique(),
  status: text("status").notNull().default("sent"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WhatsappMessage = typeof whatsappMessagesTable.$inferSelect;
