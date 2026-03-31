import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { branchesTable } from "./branches";

export const branchMappingsTable = pgTable("branch_mappings", {
  id: serial("id").primaryKey(),
  centralBranchId: integer("central_branch_id").notNull().unique().references(() => branchesTable.id, { onDelete: "cascade" }),
  revolverBranchId: integer("revolver_branch_id"),
  hukuplusStoreId: integer("hukuplus_store_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type BranchMapping = typeof branchMappingsTable.$inferSelect;
