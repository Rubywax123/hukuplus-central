import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { retailersTable } from "./retailers";

export const retailerMappingsTable = pgTable("retailer_mappings", {
  id: serial("id").primaryKey(),
  centralRetailerId: integer("central_retailer_id").notNull().unique().references(() => retailersTable.id, { onDelete: "cascade" }),
  revolverRetailerId: integer("revolver_retailer_id"),
  hukuplusRetailerId: integer("hukuplus_retailer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RetailerMapping = typeof retailerMappingsTable.$inferSelect;
