import { pgTable, text, serial, boolean, timestamp, integer, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { retailersTable } from "./retailers";
import { branchesTable } from "./branches";

export const portalUsersTable = pgTable("portal_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  retailerId: integer("retailer_id").notNull().references(() => retailersTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  role: varchar("role", { length: 50 }).notNull().default("store_staff"),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPortalUserSchema = createInsertSchema(portalUsersTable).omit({ id: true, createdAt: true, updatedAt: true, passwordHash: true });
export type InsertPortalUser = z.infer<typeof insertPortalUserSchema>;
export type PortalUser = typeof portalUsersTable.$inferSelect;
