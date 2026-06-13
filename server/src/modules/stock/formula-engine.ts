/**
 * 同花顺公式计算引擎
 * 实现同花顺公式中的核心函数，对K线数据数组进行向量化计算
 */
export class FormulaEngine {
  private _open: number[] = [];
  private _close: number[] = [];
  private _high: number[] = [];
  private _low: number[] = [];
  private _volume: number[] = [];
  private _amount: number[] = [];
  private _length: number = 0;

  constructor(
    data: { open: number[]; close: number[]; high: number[]; low: number[]; volume: number[]; amount: number[] },
  ) {
    this._open = data.open;
    this._close = data.close;
    this._high = data.high;
    this._low = data.low;
    this._volume = data.volume;
    this._amount = data.amount;
    this._length = data.close.length;
  }

  get length(): number {
    return this._length;
  }

  // ========== 基础数据源 ==========

  get OPEN(): number[] {
    return this._open;
  }

  get CLOSE(): number[] {
    return this._close;
  }

  get HIGH(): number[] {
    return this._high;
  }

  get LOW(): number[] {
    return this._low;
  }

  get VOL(): number[] {
    return this._volume;
  }

  get AMOUNT(): number[] {
    return this._amount;
  }

  // ========== 核心公式函数 ==========

  /** 简单移动平均 MA */
  MA(data: number[], n: number): number[] {
    const result = new Array(this._length).fill(0);
    for (let i = 0; i < this._length; i++) {
      if (i < n - 1) {
        // 数据不足时，用已有数据的平均值
        let sum = 0;
        let count = 0;
        for (let j = 0; j <= i; j++) {
          sum += data[j];
          count++;
        }
        result[i] = sum / count;
      } else {
        let sum = 0;
        for (let j = i - n + 1; j <= i; j++) {
          sum += data[j];
        }
        result[i] = sum / n;
      }
    }
    return result;
  }

  /** 指数移动平均 EMA */
  EMA(data: number[], n: number): number[] {
    const result = new Array(this._length).fill(0);
    if (this._length === 0) return result;
    const alpha = 2 / (n + 1);
    result[0] = data[0];
    for (let i = 1; i < this._length; i++) {
      result[i] = alpha * data[i] + (1 - alpha) * result[i - 1];
    }
    return result;
  }

  /** N周期内最低价的最低值 LLV */
  LLV(data: number[], n: number): number[] {
    const result = new Array(this._length).fill(0);
    for (let i = 0; i < this._length; i++) {
      if (i < n - 1) {
        let minVal = Infinity;
        for (let j = 0; j <= i; j++) {
          if (data[j] < minVal) minVal = data[j];
        }
        result[i] = minVal;
      } else {
        let minVal = Infinity;
        for (let j = i - n + 1; j <= i; j++) {
          if (data[j] < minVal) minVal = data[j];
        }
        result[i] = minVal;
      }
    }
    return result;
  }

  /** N周期内最高价的最高值 HHV */
  HHV(data: number[], n: number): number[] {
    const result = new Array(this._length).fill(0);
    for (let i = 0; i < this._length; i++) {
      if (i < n - 1) {
        let maxVal = -Infinity;
        for (let j = 0; j <= i; j++) {
          if (data[j] > maxVal) maxVal = data[j];
        }
        result[i] = maxVal;
      } else {
        let maxVal = -Infinity;
        for (let j = i - n + 1; j <= i; j++) {
          if (data[j] > maxVal) maxVal = data[j];
        }
        result[i] = maxVal;
      }
    }
    return result;
  }

  /** 引用N周期前的值 REF */
  REF(data: number[] | boolean[], n: number): number[] {
    const result = new Array(this._length).fill(0);
    for (let i = 0; i < this._length; i++) {
      const idx = i - n;
      result[i] = idx >= 0 ? data[idx] : data[0];
    }
    return result;
  }

  /** 上穿 CROSS: A线上穿B线返回true */
  CROSS(a: number[], b: number[]): boolean[] {
    const result = new Array(this._length).fill(false);
    for (let i = 1; i < this._length; i++) {
      result[i] = a[i] > b[i] && a[i - 1] <= b[i - 1];
    }
    return result;
  }

  /** 统计N周期内条件成立的次数 COUNT */
  COUNT(cond: boolean[], n: number): number[] {
    const result = new Array(this._length).fill(0);
    for (let i = 0; i < this._length; i++) {
      let count = 0;
      const start = Math.max(0, i - n + 1);
      for (let j = start; j <= i; j++) {
        if (cond[j]) count++;
      }
      result[i] = count;
    }
    return result;
  }

  /** 上次条件成立到现在的周期数 BARSLAST */
  BARSLAST(cond: boolean[]): number[] {
    const result = new Array(this._length).fill(0);
    let lastPos = 0;
    for (let i = 0; i < this._length; i++) {
      if (cond[i]) {
        result[i] = 0;
        lastPos = i;
      } else {
        result[i] = i - lastPos;
      }
    }
    return result;
  }

  /** BARSCOUNT: 有效周期数（数据从开始到当前的天数） */
  BARSCOUNT(): number[] {
    const result = new Array(this._length).fill(0);
    for (let i = 0; i < this._length; i++) {
      result[i] = i + 1;
    }
    return result;
  }

  /** 标准差 STD */
  STD(data: number[], n: number): number[] {
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
      } else {
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

  /** N周期总和 SUM */
  SUM(data: number[], n: number): number[] {
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

  /** IF 条件判断 */
  IF(cond: boolean[], a: number[], b: number[]): number[] {
    const result = new Array(this._length).fill(0);
    for (let i = 0; i < this._length; i++) {
      result[i] = cond[i] ? a[i] : b[i];
    }
    return result;
  }

  /** 最大值 MAX */
  MAX(a: number[], b: number[]): number[] {
    const result = new Array(this._length).fill(0);
    for (let i = 0; i < this._length; i++) {
      result[i] = Math.max(a[i], b[i]);
    }
    return result;
  }

  /** 最大值（标量版） */
  MAX_V(a: number, b: number): number {
    return Math.max(a, b);
  }

  /** 最小值 MIN */
  MIN(a: number[], b: number[]): number[] {
    const result = new Array(this._length).fill(0);
    for (let i = 0; i < this._length; i++) {
      result[i] = Math.min(a[i], b[i]);
    }
    return result;
  }

  /** 最小值（标量版） */
  MIN_V(a: number, b: number): number {
    return Math.min(a, b);
  }

  /** 绝对值 ABS */
  ABS(data: number[]): number[] {
    return data.map((v) => Math.abs(v));
  }

  /** 取最后一个值 */
  LAST<T>(arr: T[]): T {
    return arr[arr.length - 1];
  }

  /** 取倒数第N个值 */
  LAST_N<T>(arr: T[], n: number): T {
    const idx = arr.length - 1 - n;
    return idx >= 0 ? arr[idx] : arr[0];
  }

  /** FILTER: 过滤信号，N周期内只保留第一个 */
  FILTER(cond: boolean[], n: number): boolean[] {
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

  /** 取最大值位置 HHVBARS */
  HHVBARS(data: number[], n: number): number[] {
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

  /** 取最小值位置 LLVBARS */
  LLVBARS(data: number[], n: number): number[] {
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

  /** XMA: 中心移动平均（同花顺XMA函数）
   *  XMA将MA的均值居中放置，使用了未来数据
   *  第i天的XMA = data[i-half] 到 data[i+half] 的均值
   *  对于两端数据不足half的情况，用可用数据计算
   *  （同花顺实际行为：末端无未来数据时，可用的数据有多少用多少）
   */
  XMA(data: number[], n: number): number[] {
    const result = new Array(this._length).fill(0);
    if (this._length === 0 || n <= 1) return data.slice();
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

  /** SMA: 改良移动平均 */
  SMA(data: number[], n: number, m: number): number[] {
    const result = new Array(this._length).fill(0);
    if (this._length === 0) return result;
    result[0] = data[0];
    for (let i = 1; i < this._length; i++) {
      result[i] = (m * data[i] + (n - m) * result[i - 1]) / n;
    }
    return result;
  }
}