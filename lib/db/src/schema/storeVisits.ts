import { pgTable, text, serial, boolean, timestamp, integer, date } from "drizzle-orm/pg-core";
import { retailersTable } from "./retailers";
import { branchesTable } from "./branches";
import { staffUsersTable } from "./staffUsers";

export const storeVisitsTable = pgTable("store_visits", {
  id: serial("id").primaryKey(),
  visitDate: date("visit_date").notNull(),
  retailerId: integer("retailer_id").notNull().references(() => retailersTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  staffUserId: integer("staff_user_id").notNull().references(() => staffUsersTable.id),
  staffName: text("staff_name").notNull(),
  status: text("status").notNull().default("planned"),
  planNotes: text("plan_notes"),
  visitNotes: text("visit_notes"),
  visitedAt: timestamp("visited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type StoreVisit = typeof storeVisitsTable.$inferSelect;
