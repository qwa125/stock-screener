export declare const subscriptionsRelations: import("drizzle-orm/relations").Relations<"subscriptions", {
    device: import("drizzle-orm/relations").One<"devices", true>;
}>;
export declare const devicesRelations: import("drizzle-orm/relations").Relations<"devices", {
    subscriptions: import("drizzle-orm/relations").Many<"subscriptions">;
}>;
