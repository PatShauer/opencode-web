// ─── Types ───────────────────────────────────────────────

interface ADTResult {
  statistic: number;
  used_lag: number;
}

interface EGResult {
  statistic: number;
  intercept: number;
  coef: number;
  residuals: Float64Array;
}

interface BacktestResult {
  pnl: Float64Array;
  trades: { type: string; index: number; z: number }[];
  totalReturn: number;
  numTrades: number;
}

// ─── Utility ─────────────────────────────────────────────

function logReturns(prices: Float64Array): Float64Array {
  const n = prices.length;
  const r = new Float64Array(n - 1);
  for (let i = 1; i < n; i++) {
    r[i - 1] = Math.log(prices[i] / prices[i - 1]);
  }
  return r;
}

function mean(x: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i];
  return sum / x.length;
}

function std(x: Float64Array): number {
  const m = mean(x);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += (x[i] - m) ** 2;
  return Math.sqrt(sum / (x.length - 1));
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

// ─── Matrix helpers ──────────────────────────────────────

function matVecMul(A: number[][], v: number[]): number[] {
  const m = A.length;
  const n = A[0].length;
  const out = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      out[i] += A[i][j] * v[j];
    }
  }
  return out;
}

function transpose(A: number[][]): number[][] {
  const m = A.length;
  const n = A[0].length;
  const T: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      T[j][i] = A[i][j];
    }
  }
  return T;
}

function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const k = A[0].length;
  const n = B[0].length;
  const C: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      for (let p = 0; p < k; p++) {
        C[i][j] += A[i][j] * B[p][j];
      }
    }
  }
  return C;
}

function inverse2x2(A: number[]): number[] | null {
  // A = [a, b, c, d]  <=>  [[a,b],[c,d]]
  const det = A[0] * A[3] - A[1] * A[2];
  if (Math.abs(det) < 1e-15) return null;
  return [A[3] / det, -A[1] / det, -A[2] / det, A[0] / det];
}

function solveLeastSquares(A: number[][], b: number[]): number[] {
  // (A^T A)^-1 A^T b
  const AT = transpose(A);
  const ATA: number[][] = [];
  for (let i = 0; i < AT.length; i++) {
    ATA[i] = [];
    for (let j = 0; j < A[0].length; j++) {
      let sum = 0;
      for (let k = 0; k < A.length; k++) {
        sum += AT[i][k] * A[k][j];
      }
      ATA[i][j] = sum;
    }
  }
  const ATb = matVecMul(AT, b);

  // Gaussian elimination for small systems
  const n = ATb.length;
  const aug: number[][] = [];
  for (let i = 0; i < n; i++) {
    aug[i] = [...ATA[i], ATb[i]];
  }

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row;
    }
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    if (Math.abs(aug[col][col]) < 1e-12) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i][n];
    for (let j = i + 1; j < n; j++) sum -= aug[i][j] * x[j];
    x[i] = sum / aug[i][i];
  }
  return x;
}

// ─── ACF / PACF ──────────────────────────────────────────

function acf(x: Float64Array, nlags: number = 20): Float64Array {
  const n = x.length;
  const mu = mean(x);
  let c0 = 0;
  for (let i = 0; i < n; i++) c0 += (x[i] - mu) ** 2;
  c0 /= n;

  const result = new Float64Array(nlags + 1);
  result[0] = 1;
  for (let lag = 1; lag <= nlags; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) {
      sum += (x[i] - mu) * (x[i - lag] - mu);
    }
    result[lag] = sum / n / c0;
  }
  return result;
}

// ─── ADF Test ────────────────────────────────────────────

function adfTest(x: Float64Array, maxLags: number | null = null): ADTResult {
  const n = x.length;
  const ml = maxLags ?? Math.floor(12 * Math.pow(n / 100, 0.25));

  const dx = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) dx[i] = x[i + 1] - x[i];

  const effN = n - ml - 1;
  const y = dx.slice(ml);
  const xLag = x.slice(ml, ml + effN);

  const A: number[][] = Array.from({ length: effN }, () => []);
  for (let i = 0; i < effN; i++) {
    A[i] = [1, xLag[i]];
  }

  const beta = solveLeastSquares(A, Array.from(y));
  const residuals = new Float64Array(effN);
  for (let i = 0; i < effN; i++) {
    let pred = 0;
    for (let j = 0; j < beta.length; j++) pred += A[i][j] * beta[j];
    residuals[i] = y[i] - pred;
  }

  const sigma2 = residuals.reduce((s, v) => s + v * v, 0) / (effN - A[0].length);
  const se = Math.sqrt(sigma2 / effN); // simplified SE
  const adfStat = beta[1] / se;

  return { statistic: adfStat, used_lag: ml };
}

// ─── ARMA Model ──────────────────────────────────────────

class ARMA {
  p: number;
  q: number;
  arParams: Float64Array | null = null;
  maParams: Float64Array | null = null;
  constant: number = 0;
  sigma2: number = 0;
  residuals: Float64Array | null = null;

  constructor(p: number, q: number) {
    this.p = p;
    this.q = q;
  }

  private computeResiduals(params: Float64Array, data: Float64Array): Float64Array {
    const n = data.length;
    const c = params[0];
    const ar = params.slice(1, 1 + this.p);
    const ma = params.slice(1 + this.p);
    const errors = new Float64Array(n);
    const pq = Math.max(this.p, this.q);

    for (let t = pq; t < n; t++) {
      let mu = c;
      for (let i = 0; i < this.p; i++) {
        mu += ar[i] * data[t - 1 - i];
      }
      for (let j = 0; j < this.q; j++) {
        mu += ma[j] * errors[t - 1 - j];
      }
      errors[t] = data[t] - mu;
    }
    return errors;
  }

  fit(data: Float64Array): ARMA {
    const n = data.length;
    const np = 1 + this.p + this.q;
    const init = new Float64Array(np);
    init[0] = mean(data);

    let params = init;
    const sqGrad = new Float64Array(np).fill(1e-8);
    const lr = 0.01;
    const eps = 1e-5;
    const burn = Math.max(this.p, this.q);

    for (let iter = 0; iter < 2000; iter++) {
      const errors = this.computeResiduals(params, data);
      const effErrors = errors.slice(burn);
      const sigma2 = effErrors.reduce((s, v) => s + v * v, 0) / effErrors.length;

      const grad = new Float64Array(np);
      for (let i = 0; i < np; i++) {
        const p1 = new Float64Array(params);
        p1[i] += eps;
        const e1 = this.computeResiduals(p1, data).slice(burn);
        const s1 = e1.reduce((s, v) => s + v * v, 0) / e1.length;
        grad[i] = (s1 - sigma2) / eps;
      }

      for (let i = 0; i < np; i++) {
        sqGrad[i] += grad[i] * grad[i];
        params[i] -= (lr / Math.sqrt(sqGrad[i])) * grad[i];
      }
    }

    this.constant = params[0];
    this.arParams = params.slice(1, 1 + this.p);
    this.maParams = params.slice(1 + this.p);
    this.residuals = this.computeResiduals(params, data);
    const eff = this.residuals.slice(burn);
    this.sigma2 = eff.reduce((s, v) => s + v * v, 0) / eff.length;
    return this;
  }

  predict(data: Float64Array, nSteps: number = 1): Float64Array {
    const n = data.length;
    const fullData = new Float64Array(n + nSteps);
    fullData.set(data);
    const errors = new Float64Array(n + nSteps);
    if (this.residuals) errors.set(this.residuals);

    for (let t = n; t < n + nSteps; t++) {
      let mu = this.constant;
      for (let i = 0; i < this.p; i++) {
        mu += (this.arParams?.[i] ?? 0) * fullData[t - 1 - i];
      }
      for (let j = 0; j < this.q; j++) {
        mu += (this.maParams?.[j] ?? 0) * errors[t - 1 - j];
      }
      fullData[t] = mu;
    }
    return fullData.slice(n);
  }
}

// ─── ARIMA Model ─────────────────────────────────────────

class ARIMA {
  p: number;
  d: number;
  q: number;
  private arma: ARMA;

  constructor(p: number, d: number, q: number) {
    this.p = p;
    this.d = d;
    this.q = q;
    this.arma = new ARMA(p, q);
  }

  private difference(data: Float64Array, order: number): Float64Array {
    let result = new Float64Array(data);
    for (let o = 0; o < order; o++) {
      const next = new Float64Array(result.length - 1);
      for (let i = 0; i < next.length; i++) {
        next[i] = result[i + 1] - result[i];
      }
      result = next;
    }
    return result;
  }

  fit(data: Float64Array): ARIMA {
    const diffData = this.difference(data, this.d);
    if (this.d > 0 && this.p === 0 && this.q === 0) {
      const m = mean(diffData);
      this.arma.residuals = new Float64Array(diffData.length);
      for (let i = 0; i < diffData.length; i++) {
        this.arma.residuals[i] = diffData[i] - m;
      }
      this.arma.sigma2 = diffData.reduce((s, v) => s + (v - m) ** 2, 0) / diffData.length;
      this.arma.constant = m;
    } else {
      this.arma.fit(diffData);
    }
    return this;
  }

  forecast(data: Float64Array, nSteps: number = 1): Float64Array {
    const diffData = this.difference(data, this.d);
    const diffForecast = this.arma.predict(diffData, nSteps);

    const forecasts = new Float64Array(nSteps);
    for (let i = 0; i < nSteps; i++) {
      if (this.d === 0) {
        forecasts[i] = diffForecast[i];
      } else if (this.d === 1) {
        const base = i === 0 ? data[data.length - 1] : forecasts[i - 1];
        forecasts[i] = base + diffForecast[i];
      } else if (this.d === 2) {
        if (i === 0) {
          forecasts[i] = data[data.length - 1] + (data[data.length - 1] - data[data.length - 2]) + diffForecast[i];
        } else if (i === 1) {
          forecasts[i] = forecasts[0] + (forecasts[0] - data[data.length - 1]) + diffForecast[i];
        } else {
          forecasts[i] = forecasts[i - 1] + (forecasts[i - 1] - forecasts[i - 2]) + diffForecast[i];
        }
      }
    }
    return forecasts;
  }
}

// ─── GARCH Model ─────────────────────────────────────────

class GARCH {
  p: number;
  q: number;
  omega: number = 0;
  alpha: number = 0;
  beta: number = 0;
  conditionalVar: Float64Array | null = null;

  constructor(p: number = 1, q: number = 1) {
    this.p = p;
    this.q = q;
  }

  private computeVariances(params: Float64Array, returns: Float64Array): Float64Array {
    const n = returns.length;
    const omega = params[0];
    const alpha = params[1];
    const beta = params[2];
    const sigma2 = new Float64Array(n);
    sigma2[0] = returns.reduce((s, v) => s + v * v, 0) / n;

    for (let t = 1; t < n; t++) {
      sigma2[t] = omega + alpha * returns[t - 1] ** 2 + beta * sigma2[t - 1];
    }
    return sigma2;
  }

  fit(returns: Float64Array): GARCH {
    const n = returns.length;
    const initVar = returns.reduce((s, v) => s + v * v, 0) / n;

    // Grid search + local refinement
    let bestParams = new Float64Array([initVar * 0.1, 0.1, 0.8]);
    let bestLL = Infinity;

    const omCandidates = [initVar * 0.01, initVar * 0.05, initVar * 0.1, initVar * 0.5];
    const alCandidates = [0.05, 0.1, 0.15, 0.2];
    const beCandidates = [0.7, 0.8, 0.85, 0.9];

    for (const om of omCandidates) {
      for (const al of alCandidates) {
        for (const be of beCandidates) {
          if (al + be >= 1) continue;
          const p = new Float64Array([om, al, be]);
          const s = this.computeVariances(p, returns);
          let ll = 0;
          for (let t = 0; t < n; t++) ll += Math.log(s[t]) + (returns[t] ** 2) / s[t];
          if (ll < bestLL) {
            bestLL = ll;
            bestParams = new Float64Array(p);
          }
        }
      }
    }

    // Local refinement with AdaGrad
    const sqGrad = new Float64Array(3).fill(1e-8);
    const lrBase = 0.01;
    const eps = 1e-5;

    for (let iter = 0; iter < 1000; iter++) {
      const s2 = this.computeVariances(bestParams, returns);
      let ll = 0;
      for (let t = 0; t < n; t++) ll += Math.log(s2[t]) + (returns[t] ** 2) / s2[t];

      const grad = new Float64Array(3);
      for (let i = 0; i < 3; i++) {
        const p1 = new Float64Array(bestParams);
        p1[i] += eps;
        const s1 = this.computeVariances(p1, returns);
        let ll1 = 0;
        for (let t = 0; t < n; t++) ll1 += Math.log(s1[t]) + (returns[t] ** 2) / s1[t];
        grad[i] = (ll1 - ll) / eps;
      }

      for (let i = 0; i < 3; i++) {
        sqGrad[i] += grad[i] * grad[i];
        bestParams[i] -= (lrBase / Math.sqrt(sqGrad[i])) * grad[i];
      }
      bestParams[0] = Math.max(1e-8, bestParams[0]);
      bestParams[1] = Math.max(1e-6, bestParams[1]);
      bestParams[2] = Math.max(1e-6, bestParams[2]);
      if (bestParams[1] + bestParams[2] > 0.999) {
        const s = bestParams[1] + bestParams[2];
        bestParams[1] *= 0.999 / s;
        bestParams[2] *= 0.999 / s;
      }
    }

    this.omega = bestParams[0];
    this.alpha = bestParams[1];
    this.beta = bestParams[2];
    this.conditionalVar = this.computeVariances(bestParams, returns);
    return this;
  }

  forecastVariance(nSteps: number = 1): Float64Array {
    if (!this.conditionalVar) throw new Error("Model must be fitted first");

    const forecasts = new Float64Array(nSteps);
    const lastVar = this.conditionalVar[this.conditionalVar.length - 1];
    const persistence = this.alpha + this.beta;
    const longRunVar = this.omega / (1 - persistence);

    for (let i = 0; i < nSteps; i++) {
      if (i === 0) {
        forecasts[i] = this.omega + this.alpha * 0 + this.beta * lastVar;
      } else {
        forecasts[i] = this.omega + persistence * (forecasts[i - 1] - longRunVar) + longRunVar;
      }
    }
    return forecasts;
  }

  get annualizedVolatility(): number {
    if (!this.conditionalVar) throw new Error("Model must be fitted first");
    return Math.sqrt(this.conditionalVar[this.conditionalVar.length - 1] * 252);
  }
}

// ─── EGARCH Model ────────────────────────────────────────

class EGARCH {
  p: number;
  q: number;
  omega: number = 0;
  alpha: number = 0;
  gamma: number = 0;
  beta: number = 0;
  conditionalVar: Float64Array | null = null;

  constructor(p: number = 1, q: number = 1) {
    this.p = p;
    this.q = q;
  }

  private computeVariances(params: Float64Array, returns: Float64Array): Float64Array {
    const n = returns.length;
    const omega = params[0];
    const alpha = params[1];
    const gamma = params[2];
    const beta = params[3];

    const sigma2 = new Float64Array(n);
    sigma2[0] = returns.reduce((s, v) => s + v * v, 0) / n;

    const logVar = new Float64Array(n);
    logVar[0] = Math.log(sigma2[0]);

    for (let t = 1; t < n; t++) {
      const z = sigma2[t - 1] > 0 ? returns[t - 1] / Math.sqrt(sigma2[t - 1]) : 0;
      logVar[t] =
        omega + alpha * (Math.abs(z) - Math.sqrt(2 / Math.PI)) + gamma * z + beta * logVar[t - 1];
      sigma2[t] = Math.exp(logVar[t]);
    }
    return sigma2;
  }

  fit(returns: Float64Array): EGARCH {
    const n = returns.length;
    const initVar = returns.reduce((s, v) => s + v * v, 0) / n;

    // Grid search + local refinement
    let bestParams = new Float64Array([Math.log(initVar) * 0.05, 0.1, -0.05, 0.9]);
    let bestLL = Infinity;

    const omCandidates = [-0.5, -0.1, 0.05, 0.1];
    const alCandidates = [0.05, 0.15, 0.25];
    const gaCandidates = [-0.1, -0.05, 0, 0.05];
    const beCandidates = [0.85, 0.9, 0.92];

    for (const om of omCandidates) {
      for (const al of alCandidates) {
        for (const ga of gaCandidates) {
          for (const be of beCandidates) {
            if (be >= 1 || be < 0) continue;
            const p = new Float64Array([om, al, ga, be]);
            const s = this.computeVariances(p, returns);
            let ll = 0;
            let valid = true;
            for (let t = 0; t < n; t++) {
              if (s[t] <= 0 || !isFinite(s[t])) { valid = false; break; }
              ll += Math.log(s[t]) + (returns[t] ** 2) / s[t];
            }
            if (valid && ll < bestLL) {
              bestLL = ll;
              bestParams = new Float64Array(p);
            }
          }
        }
      }
    }

    // Local refinement with AdaGrad
    const sqGrad = new Float64Array(4).fill(1e-8);
    const lrBase = 0.01;
    const eps = 1e-5;

    for (let iter = 0; iter < 1000; iter++) {
      const s2 = this.computeVariances(bestParams, returns);
      let ll = 0;
      for (let t = 0; t < n; t++) ll += Math.log(s2[t]) + (returns[t] ** 2) / s2[t];

      const grad = new Float64Array(4);
      for (let i = 0; i < 4; i++) {
        const p1 = new Float64Array(bestParams);
        p1[i] += eps;
        const s1 = this.computeVariances(p1, returns);
        let ll1 = 0;
        for (let t = 0; t < n; t++) ll1 += Math.log(s1[t]) + (returns[t] ** 2) / s1[t];
        grad[i] = (ll1 - ll) / eps;
      }

      for (let i = 0; i < 4; i++) {
        sqGrad[i] += grad[i] * grad[i];
        bestParams[i] -= (lrBase / Math.sqrt(sqGrad[i])) * grad[i];
      }
      bestParams[3] = Math.min(0.999, Math.max(0.001, bestParams[3]));
    }

    this.omega = bestParams[0];
    this.alpha = bestParams[1];
    this.gamma = bestParams[2];
    this.beta = bestParams[3];
    this.conditionalVar = this.computeVariances(bestParams, returns);
    return this;
  }
}

// ─── Cointegration & Pairs Trading ───────────────────────

function engleGrangerTest(y: Float64Array, x: Float64Array, maxLags: number | null = null): EGResult {
  if (y.length !== x.length) throw new Error("y and x must have same length");
  const n = y.length;

  const A: number[][] = Array.from({ length: n }, (_, i) => [1, x[i]]);
  const beta = solveLeastSquares(A, Array.from(y));

  const residuals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    residuals[i] = y[i] - beta[0] - beta[1] * x[i];
  }

  const adt = adfTest(residuals, maxLags);
  return { statistic: adt.statistic, intercept: beta[0], coef: beta[1], residuals };
}

function halfLife(spread: Float64Array): number {
  const lag = spread.slice(0, spread.length - 1);
  const diff = new Float64Array(spread.length - 1);
  for (let i = 0; i < diff.length; i++) diff[i] = spread[i + 1] - spread[i];

  const A: number[][] = Array.from({ length: lag.length }, (_, i) => [1, lag[i]]);
  const beta = solveLeastSquares(A, Array.from(diff));

  if (beta[1] >= 0) return Infinity;
  return -Math.log(2) / beta[1];
}

function zscore(spread: Float64Array): Float64Array {
  const mu = mean(spread);
  const sigma = std(spread);
  const z = new Float64Array(spread.length);
  for (let i = 0; i < spread.length; i++) z[i] = (spread[i] - mu) / sigma;
  return z;
}

function backtestPairs(
  yPrice: Float64Array,
  xPrice: Float64Array,
  entryZ: number = 2.0,
  exitZ: number = 0.0,
  spreadRatio: number = 1.0,
): BacktestResult {
  const residuals = new Float64Array(yPrice.length);
  for (let i = 0; i < yPrice.length; i++) {
    residuals[i] = yPrice[i] - spreadRatio * xPrice[i];
  }

  const z = zscore(residuals);
  let position = 0;
  const pnl = new Float64Array(z.length);
  const trades: { type: string; index: number; z: number }[] = [];

  for (let i = 1; i < z.length; i++) {
    if (position === 0) {
      if (z[i] > entryZ) {
        position = -1;
        trades.push({ type: "SHORT_SPREAD", index: i, z: z[i] });
      } else if (z[i] < -entryZ) {
        position = 1;
        trades.push({ type: "LONG_SPREAD", index: i, z: z[i] });
      }
    } else if (position === 1 && z[i] >= exitZ) {
      trades.push({ type: "EXIT_LONG", index: i, z: z[i] });
      position = 0;
    } else if (position === -1 && z[i] <= exitZ) {
      trades.push({ type: "EXIT_SHORT", index: i, z: z[i] });
      position = 0;
    }

    if (position === 1) {
      pnl[i] = pnl[i - 1] + (residuals[i] - residuals[i - 1]);
    } else if (position === -1) {
      pnl[i] = pnl[i - 1] - (residuals[i] - residuals[i - 1]);
    } else {
      pnl[i] = pnl[i - 1];
    }
  }

  return {
    pnl,
    trades,
    totalReturn: pnl[pnl.length - 1],
    numTrades: trades.filter((t) => t.type.startsWith("EXIT")).length,
  };
}

// ─── Monte Carlo VaR ─────────────────────────────────────

function monteCarloVaR(
  returns: Float64Array,
  nSimulations: number = 10000,
  horizon: number = 10,
  confidence: number = 0.95,
): number {
  const mu = mean(returns);
  const sigma = std(returns);

  const terminalReturns = new Float64Array(nSimulations);
  for (let s = 0; s < nSimulations; s++) {
    let cum = 0;
    for (let h = 0; h < horizon; h++) {
      // Box-Muller
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      cum += mu + sigma * z;
    }
    terminalReturns[s] = Math.exp(cum) - 1;
  }

  const sorted = [...terminalReturns].sort((a, b) => a - b);
  const idx = Math.floor((1 - confidence) * nSimulations);
  return -sorted[idx];
}

// ─── Sharpe Ratio / Max Drawdown ─────────────────────────

function sharpeRatio(returns: Float64Array, rf: number = 0.02, periods: number = 252): number {
  const excess = new Float64Array(returns.length);
  for (let i = 0; i < returns.length; i++) excess[i] = returns[i] - rf / periods;
  const s = std(excess);
  if (s === 0) return 0;
  return (mean(excess) / s) * Math.sqrt(periods);
}

function maxDrawdown(pnl: Float64Array): number {
  let peak = -Infinity;
  let maxDD = 0;
  for (let i = 0; i < pnl.length; i++) {
    if (pnl[i] > peak) peak = pnl[i];
    const dd = (peak - pnl[i]) / (peak + 1e-10);
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

// ─── Main Demo ───────────────────────────────────────────

function main(): void {
  const sep = "=".repeat(60);
  console.log(sep);
  console.log("Financial Time Series Analysis — TypeScript Implementation");
  console.log(sep);

  // Simulate financial data
  const n = 500;
  const trueReturns = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Box-Muller
    const u1 = Math.random();
    const u2 = Math.random();
    trueReturns[i] = 0.0002 + 0.015 * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  const garchVar = new Float64Array(n);
  garchVar[0] = 0.015 ** 2;
  const omegaTrue = 1e-6;
  const alphaTrue = 0.1;
  const betaTrue = 0.85;

  for (let t = 1; t < n; t++) {
    garchVar[t] = omegaTrue + alphaTrue * trueReturns[t - 1] ** 2 + betaTrue * garchVar[t - 1];
  }

  const totalVar = garchVar.reduce((s, v) => s + v, 0) / n;
  const returns = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    returns[i] = trueReturns[i] * Math.sqrt(garchVar[i] / totalVar);
  }

  let cum = 0;
  const prices = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cum += returns[i];
    prices[i] = 100 * Math.exp(cum);
  }

  // 1. ADF Test
  console.log("\n[1] ADF Stationarity Test");
  const adfPrice = adfTest(prices);
  console.log(`    Price ADF stat = ${adfPrice.statistic.toFixed(4)}`);

  const logRet = logReturns(prices);
  const adfRet = adfTest(logRet);
  console.log(`    Return ADF stat = ${adfRet.statistic.toFixed(4)} (p<0.01 => stationary)`);

  // 2. ARMA
  console.log("\n[2] ARMA(1,1) Model");
  const arma = new ARMA(1, 1).fit(returns);
  console.log(`    AR(1)  = ${arma.arParams?.[0].toFixed(4)}`);
  console.log(`    MA(1)  = ${arma.maParams?.[0].toFixed(4)}`);
  console.log(`    Const  = ${arma.constant.toFixed(6)}`);
  console.log(`    Sigma2 = ${arma.sigma2.toFixed(6)}`);

  // 3. ARIMA Forecast
  console.log("\n[3] ARIMA(1,1,0) Forecast");
  const arima = new ARIMA(1, 1, 0).fit(prices);
  const fc = arima.forecast(prices, 5);
  console.log(`    Today: ${prices[prices.length - 1].toFixed(2)}`);
  for (let i = 0; i < fc.length; i++) {
    console.log(`    t+${i + 1}: ${fc[i].toFixed(2)}`);
  }

  // 4. GARCH
  console.log("\n[4] GARCH(1,1) Volatility Model");
  const garch = new GARCH(1, 1).fit(returns);
  console.log(`    omega       = ${garch.omega.toFixed(6)}`);
  console.log(`    alpha       = ${garch.alpha.toFixed(4)}`);
  console.log(`    beta        = ${garch.beta.toFixed(4)}`);
  console.log(`    persistence = ${(garch.alpha + garch.beta).toFixed(4)}`);
  console.log(`    Ann. Vol    = ${(garch.annualizedVolatility * 100).toFixed(2)}%`);

  // 5. EGARCH
  console.log("\n[5] EGARCH(1,1) — Leverage Effect");
  const egarch = new EGARCH(1, 1).fit(returns);
  console.log(`    omega = ${egarch.omega.toFixed(4)}`);
  console.log(`    alpha = ${egarch.alpha.toFixed(4)}`);
  console.log(`    gamma = ${egarch.gamma.toFixed(4)} (negative => leverage effect)`);
  console.log(`    beta  = ${egarch.beta.toFixed(4)}`);

  // 6. Pairs Trading
  console.log("\n[6] Pairs Trading & Cointegration");
  const yP = new Float64Array(300);
  const xP = new Float64Array(300);
  let cy = 0;
  let cx = 0;
  for (let i = 0; i < 300; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    cy += 0.0001 + 0.01 * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    cx += 0.0001 + 0.01 * Math.sqrt(-2 * Math.log(u2)) * Math.cos(2 * Math.PI * u1);
    yP[i] = 100 * Math.exp(cy);
    xP[i] = 100 * Math.exp(cx);
  }

  const eg = engleGrangerTest(yP, xP);
  console.log(`    Cointegration coef = ${eg.coef.toFixed(4)}`);
  console.log(`    ADF stat           = ${eg.statistic.toFixed(4)}`);

  const hl = halfLife(eg.residuals);
  if (hl < Infinity) {
    console.log(`    Half-life          = ${hl.toFixed(1)} days`);
  } else {
    console.log("    Half-life = Infinity (not mean-reverting)");
  }

  const bt = backtestPairs(yP, xP, 1.5, 0.0, eg.coef);
  console.log(`    Pairs P&L          = ${bt.totalReturn.toFixed(4)}`);
  console.log(`    Num trades         = ${bt.numTrades}`);

  // 7. Monte Carlo VaR
  console.log("\n[7] Monte Carlo VaR");
  const mcVaR = monteCarloVaR(returns, 5000, 1);
  console.log(`    1-day 95% VaR = ${(mcVaR * 100).toFixed(2)}%`);

  // 8. Sharpe & Max DD on pairs PnL
  const dailyRet = new Float64Array(bt.pnl.length - 1);
  for (let i = 0; i < dailyRet.length; i++) dailyRet[i] = bt.pnl[i + 1] - bt.pnl[i];
  console.log(`    Pairs Sharpe = ${sharpeRatio(dailyRet).toFixed(2)}`);
  console.log(`    Pairs Max DD = ${(maxDrawdown(bt.pnl) * 100).toFixed(2)}%`);

  console.log("\n" + sep);
  console.log("Demo complete — all models implemented in TypeScript");
  console.log(sep);
}

main();

export {
  ARMA,
  ARIMA,
  GARCH,
  EGARCH,
  adfTest,
  acf,
  engleGrangerTest,
  backtestPairs,
  halfLife,
  monteCarloVaR,
  sharpeRatio,
  maxDrawdown,
  logReturns,
  mean,
  std,
  zscore,
};
