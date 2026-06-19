import { pgTable, index, varchar, timestamp, serial, foreignKey, numeric } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const devices = pgTable("devices", {
	id: varchar({ length: 36 }).default(sql`gen_random_uuid()`).primaryKey().notNull(),
	trialStart: timestamp("trial_start", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	trialEnd: timestamp("trial_end", { withTimezone: true, mode: 'string' }).default(sql`(now() + '7 days'::interval)`).notNull(),
	subscriptionEnd: timestamp("subscription_end", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("devices_id_idx").on(table.id),
]);

export const accessDevices = pgTable("access_devices", {
	id: varchar("id", { length: 64 }).primaryKey().notNull(),
	ua: varchar("ua", { length: 500 }),
	displayName: varchar("display_name", { length: 200 }),
	firstSeen: timestamp("first_seen", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeen: timestamp("last_seen", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("access_devices_id_idx").on(table.id),
	index("access_devices_last_seen_idx").on(table.lastSeen),
]);

export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
	id: varchar({ length: 36 }).default(sql`gen_random_uuid()`).primaryKey().notNull(),
	deviceId: varchar("device_id", { length: 36 }).notNull(),
	orderId: varchar("order_id", { length: 64 }),
	planType: varchar("plan_type", { length: 20 }).default('monthly').notNull(),
	amount: numeric({ precision: 10, scale:  2 }),
	payStatus: varchar("pay_status", { length: 20 }).default('pending').notNull(),
	startDate: timestamp("start_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	endDate: timestamp("end_date", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("subscriptions_device_id_idx").on(table.deviceId),
	index("subscriptions_order_id_idx").on(table.orderId),
	index("subscriptions_pay_status_idx").on(table.payStatus),
	foreignKey({
			columns: [table.deviceId],
			foreignColumns: [devices.id],
			name: "subscriptions_device_id_devices_id_fk"
		}).onDelete("cascade"),
]);