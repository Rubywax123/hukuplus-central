import { pgTable, text, serial, timestamp, integer, real, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { retailersTable } from "./retailers";
import { branchesTable } from "./branches";
import { customersTable } from "./customers";

export const agreementsTable = pgTable("agreements", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id),
  retailerId: integer("retailer_id").notNull().references(() => retailersTable.id),
  branchId: integer("branch_id").notNull().references(() => branchesTable.id),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  loanProduct: text("loan_product").notNull(),
  loanAmount: real("loan_amount").notNull(),
  formitizeJobId: text("formitize_job_id"),
  formitizeFormUrl: text("formitize_form_url"),
  signingToken: text("signing_token").notNull().unique(),
  status: text("status").notNull().default("pending"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  signatureData: text("signature_data"),
  customerSignature2: text("customer_signature_2"),
  customerSignature3: text("customer_signature_3"),
  managerSignature: text("manager_signature"),
  createdBy: text("created_by"),
  formData: json("form_data").$type<Record<string, string>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertAgreementSchema = createInsertSchema(agreementsTable).omit({ id: true, createdAt: true });
export type InsertAgreement = z.infer<typeof insertAgreementSchema>;
export type Agreement = typeof agreementsTable.$inferSelect;
