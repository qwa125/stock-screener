"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMarketOpen = isMarketOpen;
exports.isTradingDay = isTradingDay;
exports.isAfterMarketClose = isAfterMarketClose;
exports.beijingNow = beijingNow;
function isMarketOpen() {
    const d = new Date();
    const bjH = (d.getUTCHours() + 8) % 24;
    const bjM = d.getUTCMinutes();
    const t = bjH * 100 + bjM;
    return (t >= 915 && t <= 1130) || (t >= 1300 && t <= 1500);
}
function isTradingDay() {
    const d = new Date();
    const utcDay = d.getUTCDay();
    const bjHour = (d.getUTCHours() + 8) % 24;
    let bjDay = utcDay;
    if (d.getUTCHours() + 8 >= 24) {
        bjDay = (utcDay + 1) % 7;
    }
    return bjDay >= 1 && bjDay <= 5;
}
function isAfterMarketClose() {
    const d = new Date();
    const bjH = (d.getUTCHours() + 8) % 24;
    const bjM = d.getUTCMinutes();
    const t = bjH * 100 + bjM;
    return t >= 1500;
}
function beijingNow() {
    const d = new Date();
    const bjH = (d.getUTCHours() + 8) % 24;
    const bjM = d.getUTCMinutes();
    const bjS = d.getUTCSeconds();
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const da = d.getUTCDate();
    const bjDate = d.getUTCHours() + 8 >= 24
        ? `${y}-${String(mo).padStart(2, '0')}-${String(da + 1).padStart(2, '0')}`
        : `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    return `${bjDate} ${String(bjH).padStart(2, '0')}:${String(bjM).padStart(2, '0')}:${String(bjS).padStart(2, '0')}`;
}
