import { pgTable, serial, varchar, timestamp, numeric, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

/** 设备表 - 浏览器设备ID自动识别 */
export const devices = pgTable(
  "devices",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    trial_start: timestamp("trial_start", { withTimezone: true }).defaultNow().notNull(),
    trial_end: timestamp("trial_end", { withTimezone: true }).default(sql`NOW() + INTERVAL '7 days'`).notNull(),
    subscription_end: timestamp("subscription_end", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("devices_id_idx").on(table.id)]
);

/** 订阅/支付记录表 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    device_id: varchar("device_id", { length: 36 }).notNull().references(() => devices.id, { onDelete: "cascade" }),
    order_id: varchar("order_id", { length: 64 }),
    plan_type: varchar("plan_type", { length: 20 }).notNull().default('monthly'),
    amount: numeric("amount", { precision: 10, scale: 2 }),
    pay_status: varchar("pay_status", { length: 20 }).notNull().default('pending'),
    start_date: timestamp("start_date", { withTimezone: true }).defaultNow().notNull(),
    end_date: timestamp("end_date", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("subscriptions_device_id_idx").on(table.device_id),
    index("subscriptions_order_id_idx").on(table.order_id),
    index("subscriptions_pay_status_idx").on(table.pay_status),
  ]
);
