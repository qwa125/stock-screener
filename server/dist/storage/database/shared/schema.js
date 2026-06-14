"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptions = exports.healthCheck = exports.devices = exports.users = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.users = (0, pg_core_1.pgTable)("users", {
    id: (0, pg_core_1.varchar)({ length: 36 }).default((0, drizzle_orm_1.sql) `gen_random_uuid()`).primaryKey().notNull(),
    username: (0, pg_core_1.varchar)({ length: 100 }).notNull().unique(),
    passwordHash: (0, pg_core_1.varchar)("password_hash", { length: 255 }).notNull(),
    trialStart: (0, pg_core_1.timestamp)("trial_start", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    trialEnd: (0, pg_core_1.timestamp)("trial_end", { withTimezone: true, mode: 'string' }).default((0, drizzle_orm_1.sql) `(now() + '7 days'::interval)`).notNull(),
    subscriptionEnd: (0, pg_core_1.timestamp)("subscription_end", { withTimezone: true, mode: 'string' }),
    isActive: (0, pg_core_1.boolean)("is_active").default(true).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
    (0, pg_core_1.index)("users_username_idx").on(table.username),
    (0, pg_core_1.index)("users_trial_end_idx").on(table.trialEnd),
    (0, pg_core_1.index)("users_is_active_idx").on(table.isActive),
]);
exports.devices = (0, pg_core_1.pgTable)("devices", {
    id: (0, pg_core_1.varchar)({ length: 36 }).default((0, drizzle_orm_1.sql) `gen_random_uuid()`).primaryKey().notNull(),
    trialStart: (0, pg_core_1.timestamp)("trial_start", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    trialEnd: (0, pg_core_1.timestamp)("trial_end", { withTimezone: true, mode: 'string' }).default((0, drizzle_orm_1.sql) `(now() + '7 days'::interval)`).notNull(),
    subscriptionEnd: (0, pg_core_1.timestamp)("subscription_end", { withTimezone: true, mode: 'string' }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
    (0, pg_core_1.index)("devices_id_idx").using("btree", table.id.asc().nullsLast().op("text_ops")),
]);
exports.healthCheck = (0, pg_core_1.pgTable)("health_check", {
    id: (0, pg_core_1.serial)().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});
exports.subscriptions = (0, pg_core_1.pgTable)("subscriptions", {
    id: (0, pg_core_1.varchar)({ length: 36 }).default((0, drizzle_orm_1.sql) `gen_random_uuid()`).primaryKey().notNull(),
    deviceId: (0, pg_core_1.varchar)("device_id", { length: 36 }).notNull(),
    orderId: (0, pg_core_1.varchar)("order_id", { length: 64 }),
    planType: (0, pg_core_1.varchar)("plan_type", { length: 20 }).default('monthly').notNull(),
    amount: (0, pg_core_1.numeric)({ precision: 10, scale: 2 }),
    payStatus: (0, pg_core_1.varchar)("pay_status", { length: 20 }).default('pending').notNull(),
    startDate: (0, pg_core_1.timestamp)("start_date", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    endDate: (0, pg_core_1.timestamp)("end_date", { withTimezone: true, mode: 'string' }).notNull(),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("subscriptions_device_id_idx").using("btree", table.deviceId.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("subscriptions_order_id_idx").using("btree", table.orderId.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.index)("subscriptions_pay_status_idx").using("btree", table.payStatus.asc().nullsLast().op("text_ops")),
    (0, pg_core_1.foreignKey)({
        columns: [table.deviceId],
        foreignColumns: [exports.devices.id],
        name: "subscriptions_device_id_devices_id_fk"
    }).onDelete("cascade"),
]);
