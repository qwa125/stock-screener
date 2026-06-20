"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptions = exports.accessDevices = exports.healthCheck = exports.devices = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.devices = (0, pg_core_1.pgTable)("devices", {
    id: (0, pg_core_1.varchar)({ length: 36 }).default(gen_random_uuid()).primaryKey().notNull(),
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
exports.accessDevices = (0, pg_core_1.pgTable)("access_devices", {
    id: (0, pg_core_1.varchar)("id", { length: 255 }).primaryKey().notNull(),
    ua: (0, pg_core_1.varchar)("ua", { length: 512 }).notNull().default(''),
    displayName: (0, pg_core_1.varchar)("display_name", { length: 128 }).notNull().default(''),
    firstSeen: (0, pg_core_1.timestamp)("first_seen", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    lastSeen: (0, pg_core_1.timestamp)("last_seen", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("access_devices_first_seen_idx").using("btree", table.firstSeen.asc().nullsLast().op("timestamptz_ops")),
]);
exports.subscriptions = (0, pg_core_1.pgTable)("subscriptions", {
    id: (0, pg_core_1.varchar)({ length: 36 }).default(gen_random_uuid()).primaryKey().notNull(),
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
