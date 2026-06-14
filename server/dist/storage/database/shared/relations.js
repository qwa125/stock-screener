"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devicesRelations = exports.subscriptionsRelations = void 0;
const relations_1 = require("drizzle-orm/relations");
const schema_1 = require("./schema");
exports.subscriptionsRelations = (0, relations_1.relations)(schema_1.subscriptions, ({ one }) => ({
    device: one(schema_1.devices, {
        fields: [schema_1.subscriptions.deviceId],
        references: [schema_1.devices.id]
    }),
}));
exports.devicesRelations = (0, relations_1.relations)(schema_1.devices, ({ many }) => ({
    subscriptions: many(schema_1.subscriptions),
}));
