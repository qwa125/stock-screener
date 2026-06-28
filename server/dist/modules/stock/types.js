"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrendState = exports.PositionZone = void 0;
var PositionZone;
(function (PositionZone) {
    PositionZone["LOW"] = "\u4F4E\u4F4D\u533A";
    PositionZone["MID"] = "\u4E2D\u4F4D\u533A";
    PositionZone["HIGH_ALERT"] = "\u9AD8\u4F4D\u8B66\u6212\u533A";
    PositionZone["HIGH_RISK"] = "\u9AD8\u98CE\u9669\u533A";
    PositionZone["EXTREME_RISK"] = "\u6781\u7AEF\u98CE\u9669\u533A";
})(PositionZone || (exports.PositionZone = PositionZone = {}));
var TrendState;
(function (TrendState) {
    TrendState[TrendState["DOWN"] = 0] = "DOWN";
    TrendState[TrendState["SIDEWAYS"] = 1] = "SIDEWAYS";
    TrendState[TrendState["UP_MILD"] = 2] = "UP_MILD";
    TrendState[TrendState["UP_STRONG"] = 3] = "UP_STRONG";
})(TrendState || (exports.TrendState = TrendState = {}));
