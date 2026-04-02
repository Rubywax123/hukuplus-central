import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  nationalId: text("national_id"),
  phone: text("phone"),
  email: text("email"),
  formitizeCrmId: text("formitize_crm_id"),
  xeroContactId: text("xero_contact_id"),
  address: text("address"),
  notes: text("notes"),

  // Extended personal details — populated from application form
  gender: text("gender"),
  dateOfBirth: text("date_of_birth"),
  maritalStatus: text("marital_status"),
  employerName: text("employer_name"),
  isEmployed: text("is_employed"),

  // Next-of-kin details
  nokName: text("nok_name"),
  nokRelationship: text("nok_relationship"),
  nokNationalId: text("nok_national_id"),
  nokPhone: text("nok_phone"),
  nokEmail: text("nok_email"),
  nokAddress: text("nok_address"),

  // Application meta
  // extensionOfficer = the store employee/manager who dealt with the customer at the branch
  extensionOfficer: text("extension_officer"),
  // salesRepName = reserved for a Marishoma internal sales rep assigned to the customer (future use)
  salesRepName: text("sales_rep_name"),
  retailerReference: text("retailer_reference"),
  marketType: text("market_type"),
  loanProduct: text("loan_product"),

  // Last raw application payload stored for reference / future extraction
  rawApplicationData: jsonb("raw_application_data"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
