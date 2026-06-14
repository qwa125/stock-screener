import { relations } from "drizzle-orm/relations";
import { devices, subscriptions } from "./schema";

export const subscriptionsRelations = relations(subscriptions, ({one}) => ({
	device: one(devices, {
		fields: [subscriptions.deviceId],
		references: [devices.id]
	}),
}));

export const devicesRelations = relations(devices, ({many}) => ({
	subscriptions: many(subscriptions),
}));