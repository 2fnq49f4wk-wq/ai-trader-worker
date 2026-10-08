# Vendored: Vibe-Trading alpha factor zoo (subset)

- Upstream: https://github.com/HKUDS/Vibe-Trading (MIT) — commit in `UPSTREAM_COMMIT`.
- Copied: `agent/src/factors/base.py`, `_backend.py`, and `zoo/{qlib158,alpha101,gtja191}` with their
  per-zoo `LICENSE.md` / `NOTICE` (qlib158 is Apache-2.0, adapted from microsoft/qlib; alpha101 and gtja191
  are re-implementations of published formulas). Top-level `LICENSE` and `NOTICE` are the upstream files.
- Local modifications (marked `[LUX 수정]` in the code):
  - `_backend.py`: reads the bottleneck switch from the environment instead of Vibe-Trading's config layer.
  - Package `__init__.py` files are emptied so importing a factor does not pull in the upstream registry/agent.
- Used only by `trainer/modal/factor_screen.py` (research — measures each factor's out-of-sample
  rank IC on our own universe). Nothing here touches live trading until a factor passes that screen.
