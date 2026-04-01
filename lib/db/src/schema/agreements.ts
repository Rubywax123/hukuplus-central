import { pgTable, text, serial, timestamp, integer, real, json, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { retailersTable } from "./retailers";
import { branchesTable } from "./branches";
import { customersTable } from "./customers";

export const agreementsTable = pgTable("agreements", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id),
  retailerId: integer("retailer_id").references(() => retailersTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  formType: text("form_type").default("agreement"),
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
  disbursementDate: text("disbursement_date"),
  repaymentDate: text("repayment_date"),
  repaymentAmount: real("repayment_amount"),
  formData: json("form_data").$type<Record<string, string>>(),
  facilityFeeAmount: numeric("facility_fee_amount", { precision: 12, scale: 2 }),
  interestAmount: numeric("interest_amount", { precision: 12, scale: 2 }),
  monthlyInstalment: numeric("monthly_instalment", { precision: 12, scale: 2 }),
  loanTenorMonths: integer("loan_tenor_months"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertAgreementSchema = createInsertSchema(agreementsTable).omit({ id: true, createdAt: true });
export type InsertAgreement = z.infer<typeof insertAgreementSchema>;
export type Agreement = typeof agreementsTable.$inferSelect;
