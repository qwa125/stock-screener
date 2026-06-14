"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptions = exports.devices = exports.healthCheck = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.healthCheck = (0, pg_core_1.pgTable)("health_check", {
    id: (0, pg_core_1.serial)().notNull(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});
exports.devices = (0, pg_core_1.pgTable)("devices", {
    id: (0, pg_core_1.varchar)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    trial_start: (0, pg_core_1.timestamp)("trial_start", { withTimezone: true }).defaultNow().notNull(),
    trial_end: (0, pg_core_1.timestamp)("trial_end", { withTimezone: true }).default((0, drizzle_orm_1.sql) `NOW() + INTERVAL '7 days'`).notNull(),
    subscription_end: (0, pg_core_1.timestamp)("subscription_end", { withTimezone: true }),
    created_at: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: (0, pg_core_1.timestamp)("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [(0, pg_core_1.index)("devices_id_idx").on(table.id)]);
exports.subscriptions = (0, pg_core_1.pgTable)("subscriptions", {
    id: (0, pg_core_1.varchar)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    device_id: (0, pg_core_1.varchar)("device_id", { length: 36 }).notNull().references(() => exports.devices.id, { onDelete: "cascade" }),
    order_id: (0, pg_core_1.varchar)("order_id", { length: 64 }),
    plan_type: (0, pg_core_1.varchar)("plan_type", { length: 20 }).notNull().default('monthly'),
    amount: (0, pg_core_1.numeric)("amount", { precision: 10, scale: 2 }),
    pay_status: (0, pg_core_1.varchar)("pay_status", { length: 20 }).notNull().default('pending'),
    start_date: (0, pg_core_1.timestamp)("start_date", { withTimezone: true }).defaultNow().notNull(),
    end_date: (0, pg_core_1.timestamp)("end_date", { withTimezone: true }).notNull(),
    created_at: (0, pg_core_1.timestamp)("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)("subscriptions_device_id_idx").on(table.device_id),
    (0, pg_core_1.index)("subscriptions_order_id_idx").on(table.order_id),
    (0, pg_core_1.index)("subscriptions_pay_status_idx").on(table.pay_status),
]);
