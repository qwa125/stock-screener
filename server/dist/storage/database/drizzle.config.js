"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const drizzle_kit_1 = require("drizzle-kit");
exports.default = (0, drizzle_kit_1.defineConfig)({
    dialect: 'postgresql',
    out: '/tmp/drizzle-JYJ2YJ',
    dbCredentials: {
        url: 'postgresql://postgres:E1D1tY2IZ3sIxnF0K0@cp-blush-sheen-9000f085.pg2.aidap-global.cn-beijing.volces.com:5432/postgres?sslmode=require&channel_binding=require',
    },
});
