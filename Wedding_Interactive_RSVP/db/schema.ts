import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const rsvps = pgTable("rsvps", {
  id: serial().primaryKey(),
  name: text().notNull(),
  attending: boolean().notNull(),
  guests: integer().notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
