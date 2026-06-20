import { pgTable, index, varchar, timestamp, serial, foreignKey, numeric } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const devices = pgTable("devices", {
	id: varchar({ length: 36 }).primaryKey().notNull(),
	trialStart: timestamp("trial_start", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	trialEnd: timestamp("trial_end", { withTimezone: true, mode: 'string' }).default(sql`(now() + '7 days'::interval)`).notNull(),
	subscriptionEnd: timestamp("subscription_end", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("devices_id_idx").using("btree", table.id.asc().nullsLast().op("text_ops")),
]);

export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const accessDevices = pgTable("access_devices", {
	id: varchar("id", { length: 255 }).primaryKey().notNull(),
	ua: varchar("ua", { length: 512 }).notNull().default(''),
	displayName: varchar("display_name", { length: 128 }).notNull().default(''),
	firstSeen: timestamp("first_seen", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeen: timestamp("last_seen", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("access_devices_first_seen_idx").using("btree", table.firstSeen.asc().nullsLast().op("timestamptz_ops")),
]);

export const subscriptions = pgTable("subscriptions", {
	id: varchar({ length: 36 }).primaryKey().notNull(),
	deviceId: varchar("device_id", { length: 36 }).notNull(),
	orderId: varchar("order_id", { length: 64 }),
	planType: varchar("plan_type", { length: 20 }).default('monthly').notNull(),
	amount: numeric({ precision: 10, scale:  2 }),
	payStatus: varchar("pay_status", { length: 20 }).default('pending').notNull(),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	endDate: timestamp("end_date", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("subscriptions_device_id_idx").using("btree", table.deviceId.asc().nullsLast().op("text_ops")),
	index("subscriptions_order_id_idx").using("btree", table.orderId.asc().nullsLast().op("text_ops")),
	index("subscriptions_pay_status_idx").using("btree", table.payStatus.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.deviceId],
			foreignColumns: [devices.id],
			name: "subscriptions_device_id_devices_id_fk"
		}).onDelete("cascade"),
]);
