"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTradingDay = isTradingDay;
exports.isLunchBreak = isLunchBreak;
exports.isMarketOpen = isMarketOpen;
exports.isAfterMarketClose = isAfterMarketClose;
exports.getAfterMarketTTL = getAfterMarketTTL;
exports.getMarketOpenTTL = getMarketOpenTTL;
exports.getCacheTTL = getCacheTTL;
exports.getNextOpenTime = getNextOpenTime;
function now() {
    return new Date();
}
function isTradingDay() {
    const day = now().getDay();
    return day >= 1 && day <= 5;
}
function isLunchBreak() {
    if (!isTradingDay())
        return false;
    const h = now().getHours();
    const m = now().getMinutes();
    const t = h * 100 + m;
    return t >= 1130 && t < 1300;
}
function isMarketOpen() {
    if (!isTradingDay() || isLunchBreak())
        return false;
    const h = now().getHours();
    const m = now().getMinutes();
    const t = h * 100 + m;
    return t >= 915 && t < 1500;
}
function isAfterMarketClose() {
    if (!isTradingDay())
        return true;
    const h = now().getHours();
    const m = now().getMinutes();
    const t = h * 100 + m;
    return t >= 1500;
}
function getAfterMarketTTL() {
    return 365 * 24 * 60 * 60 * 1000;
}
function getMarketOpenTTL() {
    return 5 * 60 * 1000;
}
function getCacheTTL(staleTTL = 5 * 60 * 1000) {
    if (isMarketOpen()) {
        return { ttl: getMarketOpenTTL(), staleTTL, canRefresh: true };
    }
    return { ttl: getAfterMarketTTL(), staleTTL: getAfterMarketTTL(), canRefresh: false };
}
function getNextOpenTime() {
    const d = now();
    let daysToAdd = 0;
    const day = d.getDay();
    if (day === 0)
        daysToAdd = 1;
    else if (day === 6)
        daysToAdd = 2;
    else {
        const h = d.getHours();
        const m = d.getMinutes();
        const t = h * 100 + m;
        if (t >= 1500) {
            daysToAdd = day === 5 ? 3 : 1;
        }
    }
    d.setDate(d.getDate() + daysToAdd);
    d.setHours(9, 15, 0, 0);
    return d.getTime();
}
