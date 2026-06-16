"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FormulaEngine = void 0;
class FormulaEngine {
    constructor(data) {
        this._open = [];
        this._close = [];
        this._high = [];
        this._low = [];
        this._volume = [];
        this._amount = [];
        this._length = 0;
        this._open = data.open;
        this._close = data.close;
        this._high = data.high;
        this._low = data.low;
        this._volume = data.volume;
        this._amount = data.amount;
        this._length = data.close.length;
    }
    get length() {
        return this._length;
    }
    get OPEN() {
        return this._open;
    }
    get CLOSE() {
        return this._close;
    }
    get HIGH() {
        return this._high;
    }
    get LOW() {
        return this._low;
    }
    get VOL() {
        return this._volume;
    }
    get AMOUNT() {
        return this._amount;
    }
    MA(data, n) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            if (i < n - 1) {
                let sum = 0;
                let count = 0;
                for (let j = 0; j <= i; j++) {
                    sum += data[j];
                    count++;
                }
                result[i] = sum / count;
            }
            else {
                let sum = 0;
                for (let j = i - n + 1; j <= i; j++) {
                    sum += data[j];
                }
                result[i] = sum / n;
            }
        }
        return result;
    }
    EMA(data, n) {
        const result = new Array(this._length).fill(0);
        if (this._length === 0)
            return result;
        const alpha = 2 / (n + 1);
        result[0] = data[0];
        for (let i = 1; i < this._length; i++) {
            result[i] = alpha * data[i] + (1 - alpha) * result[i - 1];
        }
        return result;
    }
    LLV(data, n) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            if (i < n - 1) {
                let minVal = Infinity;
                for (let j = 0; j <= i; j++) {
                    if (data[j] < minVal)
                        minVal = data[j];
                }
                result[i] = minVal;
            }
            else {
                let minVal = Infinity;
                for (let j = i - n + 1; j <= i; j++) {
                    if (data[j] < minVal)
                        minVal = data[j];
                }
                result[i] = minVal;
            }
        }
        return result;
    }
    HHV(data, n) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            if (i < n - 1) {
                let maxVal = -Infinity;
                for (let j = 0; j <= i; j++) {
                    if (data[j] > maxVal)
                        maxVal = data[j];
                }
                result[i] = maxVal;
            }
            else {
                let maxVal = -Infinity;
                for (let j = i - n + 1; j <= i; j++) {
                    if (data[j] > maxVal)
                        maxVal = data[j];
                }
                result[i] = maxVal;
            }
        }
        return result;
    }
    REF(data, n) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            const idx = i - n;
            result[i] = idx >= 0 ? data[idx] : data[0];
        }
        return result;
    }
    CROSS(a, b) {
        const result = new Array(this._length).fill(false);
        for (let i = 1; i < this._length; i++) {
            result[i] = a[i] > b[i] && a[i - 1] <= b[i - 1];
        }
        return result;
    }
    COUNT(cond, n) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            let count = 0;
            const start = Math.max(0, i - n + 1);
            for (let j = start; j <= i; j++) {
                if (cond[j])
                    count++;
            }
            result[i] = count;
        }
        return result;
    }
    BARSLAST(cond) {
        const result = new Array(this._length).fill(0);
        let lastPos = 0;
        for (let i = 0; i < this._length; i++) {
            if (cond[i]) {
                result[i] = 0;
                lastPos = i;
            }
            else {
                result[i] = i - lastPos;
            }
        }
        return result;
    }
    BARSCOUNT() {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            result[i] = i + 1;
        }
        return result;
    }
    STD(data, n) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            if (i < n - 1) {
                let sum = 0;
                let count = 0;
                for (let j = 0; j <= i; j++) {
                    sum += data[j];
                    count++;
                }
                const mean = sum / count;
                let variance = 0;
                for (let j = 0; j <= i; j++) {
                    variance += (data[j] - mean) ** 2;
                }
                result[i] = Math.sqrt(variance / count);
            }
            else {
                let sum = 0;
                for (let j = i - n + 1; j <= i; j++) {
                    sum += data[j];
                }
                const mean = sum / n;
                let variance = 0;
                for (let j = i - n + 1; j <= i; j++) {
                    variance += (data[j] - mean) ** 2;
                }
                result[i] = Math.sqrt(variance / n);
            }
        }
        return result;
    }
    SUM(data, n) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            let sum = 0;
            const start = Math.max(0, i - n + 1);
            for (let j = start; j <= i; j++) {
                sum += data[j];
            }
            result[i] = sum;
        }
        return result;
    }
    IF(cond, a, b) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            result[i] = cond[i] ? a[i] : b[i];
        }
        return result;
    }
    MAX(a, b) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            result[i] = Math.max(a[i], b[i]);
        }
        return result;
    }
    MAX_V(a, b) {
        return Math.max(a, b);
    }
    MIN(a, b) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            result[i] = Math.min(a[i], b[i]);
        }
        return result;
    }
    MIN_V(a, b) {
        return Math.min(a, b);
    }
    ABS(data) {
        return data.map((v) => Math.abs(v));
    }
    LAST(arr) {
        return arr[arr.length - 1];
    }
    LAST_N(arr, n) {
        const idx = arr.length - 1 - n;
        return idx >= 0 ? arr[idx] : arr[0];
    }
    FILTER(cond, n) {
        const result = new Array(this._length).fill(false);
        let lastTruePos = -n - 1;
        for (let i = 0; i < this._length; i++) {
            if (cond[i] && i - lastTruePos >= n) {
                result[i] = true;
                lastTruePos = i;
            }
        }
        return result;
    }
    HHVBARS(data, n) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            const start = Math.max(0, i - n + 1);
            let maxVal = -Infinity;
            let maxPos = 0;
            for (let j = start; j <= i; j++) {
                if (data[j] >= maxVal) {
                    maxVal = data[j];
                    maxPos = j;
                }
            }
            result[i] = i - maxPos;
        }
        return result;
    }
    LLVBARS(data, n) {
        const result = new Array(this._length).fill(0);
        for (let i = 0; i < this._length; i++) {
            const start = Math.max(0, i - n + 1);
            let minVal = Infinity;
            let minPos = 0;
            for (let j = start; j <= i; j++) {
                if (data[j] <= minVal) {
                    minVal = data[j];
                    minPos = j;
                }
            }
            result[i] = i - minPos;
        }
        return result;
    }
    XMA(data, n) {
        const result = new Array(this._length).fill(0);
        if (this._length === 0 || n <= 1)
            return data.slice();
        const half = Math.floor((n - 1) / 2);
        for (let i = 0; i < this._length; i++) {
            const start = Math.max(0, i - half);
            const end = Math.min(this._length - 1, i + half);
            let sum = 0;
            for (let j = start; j <= end; j++) {
                sum += data[j];
            }
            result[i] = sum / (end - start + 1);
        }
        return result;
    }
    SMA(data, n, m) {
        const result = new Array(this._length).fill(0);
        if (this._length === 0)
            return result;
        result[0] = data[0];
        for (let i = 1; i < this._length; i++) {
            result[i] = (m * data[i] + (n - m) * result[i - 1]) / n;
        }
        return result;
    }
}
exports.FormulaEngine = FormulaEngine;
