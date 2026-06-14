import { pgTable, index, varchar, timestamp, serial, foreignKey, numeric, boolean } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const users = pgTable("users", {
	id: varchar({ length: 36 }).default(sql`gen_random_uuid()`).primaryKey().notNull(),
	username: varchar({ length: 100 }).notNull().unique(),
	passwordHash: varchar("password_hash", { length: 255 }).notNull(),
	trialStart: timestamp("trial_start", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	trialEnd: timestamp("trial_end", { withTimezone: true, mode: 'string' }).default(sql`(now() + '7 days'::interval)`).notNull(),
	subscriptionEnd: timestamp("subscription_end", { withTimezone: true, mode: 'string' }),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("users_username_idx").on(table.username),
	index("users_trial_end_idx").on(table.trialEnd),
	index("users_is_active_idx").on(table.isActive),
]);



export const devices = pgTable("devices", {
	id: varchar({ length: 36 }).default(sql`gen_random_uuid()`).primaryKey().notNull(),
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
	index("subscriptions_device_id_idx").using("btree", table.deviceId.asc().nullsLast().op("text_ops")),
	index("subscriptions_order_id_idx").using("btree", table.orderId.asc().nullsLast().op("text_ops")),
	index("subscriptions_pay_status_idx").using("btree", table.payStatus.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.deviceId],
			foreignColumns: [devices.id],
			name: "subscriptions_device_id_devices_id_fk"
		}).onDelete("cascade"),
]);
