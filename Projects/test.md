# Introduction to Financial Time Series Analysis

## Overview

Financial time series analysis is a core tool in quantitative finance. By modeling historical prices, volumes, and other data, it reveals market patterns, forecasts future trends, and assesses risk. This article introduces key concepts, common models, and practical considerations in financial time series analysis.

## Key Characteristics of Financial Time Series

### 1. Non-Stationarity

Financial price series are typically non-stationary — the mean and variance change over time. A stock rising from $10 to $100 does not exhibit mean-reverting behavior at the price level. The solution is to take the logarithmic difference of prices, yielding log returns, which become approximately stationary:

$$r_t = \ln(P_t) - \ln(P_{t-1}) = \ln\left(\frac{P_t}{P_{t-1}}\right)$$

### 2. Volatility Clustering

Financial markets exhibit **volatility clustering**: large movements tend to be followed by large movements, and small movements by small movements. This violates the constant variance assumption of classical linear regression.

### 3. Fat-Tailed Distributions

Financial return distributions have fatter tails than the normal distribution, meaning extreme events occur far more frequently than predicted by Gaussian models. This is known as **tail risk**.

### 4. Leverage Effect

Negative news typically has a greater impact on volatility than positive news of equal magnitude, known as the **leverage effect** — stock price decline → leverage ratio increases → risk rises → volatility increases.

## Core Models

### ARMA Model (Autoregressive Moving Average)

ARMA(p, q) is the most fundamental stationary time series model:

$$r_t = c + \sum_{i=1}^{p} \phi_i r_{t-i} + \sum_{j=1}^{q} \theta_j \epsilon_{t-j} + \epsilon_t$$

- **AR(p)**: The current value is linearly related to the past p values
- **MA(q)**: The current value is linearly related to the past q white noise shocks

### ARIMA Model (Autoregressive Integrated Moving Average)

When a series is non-stationary, first apply d-th order differencing to make it stationary, then fit an ARMA model — this is ARIMA(p, d, q).

### ARCH / GARCH Models (Volatility Modeling)

The ARCH model proposed by Engle in 1982, and the GARCH model generalized by Bollerslev in 1986, are specifically designed to capture volatility clustering.

**GARCH(1,1)** is the most classical form:

$$\sigma_t^2 = \omega + \alpha \epsilon_{t-1}^2 + \beta \sigma_{t-1}^2$$

Where:
- $\omega$: Long-run average variance
- $\alpha$: Impact of new information on volatility (shock decay rate)
- $\beta$: Volatility persistence; the closer $\alpha+\beta$ is to 1, the more persistent volatility shocks are

### EGARCH (Exponential GARCH)

Proposed by Nelson in 1991, it captures the **leverage effect** — by introducing an asymmetric term, negative shocks have a larger impact on volatility than positive shocks.

## Cointegration & Pairs Trading

Two non-stationary price series are said to be **cointegrated** if a long-run equilibrium relationship exists between them. The classic pairs trading strategy is built on this concept:

1. Find two cointegrated stocks (e.g., Coca-Cola and PepsiCo)
2. Open positions when the spread deviates from the mean: go long the undervalued, short the overvalued
3. Close positions when the spread reverts to the mean

Tests typically use the **Engle-Granger two-step method** or the **Johansen test**.

## Practical Considerations

### Data Frequency Selection

| Frequency | Use Case | Challenges |
|-----------|----------|------------|
| Daily | Medium/low frequency strategies, trend following | Minimal microstructure noise |
| Minute | Intraday trading | Must handle periodic patterns |
| Tick | High-frequency trading | Large data volumes, asynchronous updates |

### Overfitting Risk

Financial data has an extremely low signal-to-noise ratio, making it easy to overfit historical noise. In practice, you should:

- Strictly control the number of parameters
- Use rolling windows for out-of-sample testing
- Focus on economic meaning rather than purely statistical metrics
- Apply corrections for multiple testing

### Backtesting Pitfalls

- **Look-ahead bias**: Using information in backtests that was not yet available at the time
- **Survivorship bias**: Only using stocks that still exist, ignoring those that have been delisted
- **Transaction costs**: Ignoring commissions, slippage, and market impact

## Summary

The core challenge of financial time series analysis lies in the data's low signal-to-noise ratio, non-stationarity, and structural breaks. From simple ARIMA to complex deep learning models, no model can perfectly predict the market — the key is to understand the assumptions and limitations of each model and to use them within a robust risk management framework.
