# Vendored: Vibe-Trading (HKUDS) — quant components

- Upstream: https://github.com/HKUDS/Vibe-Trading (MIT) — commit in `UPSTREAM_COMMIT`. Top-level `LICENSE` / `NOTICE` are the upstream files.
- Copied unchanged (except where marked `[LUX 수정]`):
  - `src/factors/base.py`, `_backend.py`, `factor_analysis_core.py`
  - `src/factors/zoo/{qlib158,alpha101,gtja191,academic}` (+ per-zoo `LICENSE.md` / `NOTICE`; qlib158 is Apache-2.0, adapted from microsoft/qlib)
  - `src/quantlib/{crossvalidation,multipletesting,risk,portfolio,impact,microstructure,factormodel,attribution,var_backtest}.py`
    (purged/embargoed & combinatorial CV, deflated/probabilistic Sharpe, PBO, BH-FDR, VaR/ES/EVT, HRP, market impact,
    microstructure, factor models / Fama-MacBeth, attribution, VaR backtests)
  - `backtest/{metrics,models,validation,factor_costs,constraints}.py`, `backtest/optimizers/*`
    (equal-volatility, risk parity, max diversification, mean-variance, turnover-aware)
- Local modifications: `_backend.py` reads the bottleneck switch from the environment (upstream reads its config layer);
  package `__init__.py` files under `src/`, `src/factors/`, `src/factors/zoo/*`, `src/quantlib/`, `backtest/` are empty so the
  upstream agent/registry is not imported.
- Not copied: the LLM agent/skills layer, data loaders, broker connectors and the full backtest engine (they depend on the agent
  runtime and paid/regional data sources). We use our own free data (Yahoo/Naver/Nasdaq via the worker).
- Used by: `trainer/modal/factor_screen.py` (factor IC screen) and `trainer/modal/portfolio_lab.py`
  (Qlib-style LightGBM ranker + TopK-Dropout, Vibe optimizers, purged walk-forward, deflated Sharpe). Research only — nothing here
  reaches live trading until it passes the pre-registered criteria and the production trust gates.
