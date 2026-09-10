# Codex V33.346 — model recovery and extended-hours provenance

Date: 2026-09-11 KST. Base: main 549dde6 (runtime V33.345).
Input: user ai-status-2026-09-10T23-07-30.json plus current source and live public feeds.

## Why only two full members

- MIND and GBDT are full. SEQ and DUAL bear are provisional, not inactive.
- XGB/LGB/CAT retain feature version 15, while the current vector is version 17. Their old validation scores cannot establish compatibility with the new input schema.
- DNN's validation accuracy lower bound is 0.4908; FLOW/XALPHA/STACK/MEMO have insufficient or negative holdout evidence. These are quality rejections, not proof of disconnected features. Do not lower admission thresholds to increase the member count.
- No architecture replacement is justified by a controlled comparison yet. Restore training before comparing replacements; existing weak candidates stay excluded. No profit improvement is claimed.

## Confirmed defects fixed

1. The V33.341 embargo split changed training indices but left magnitude weights sliced by the old contiguous boundary. Both global XGB/LGB/CAT and US/KR learners could fail on incompatible row counts. Actual preprocessing executed against 5,000 synthetic rows reproduced 3,900 training rows versus 4,000 old weights; weights now use the same `_tri`/`_vai` indices.
2. Worker recovery and GitHub watchdog examined the youngest model. One recent upload hid stale, missing or feature-incompatible peers. They now inspect all six required external models; existing dispatch cooldowns remain. Selfcheck exposes expected/actual feature versions. GitHub manual/deploy/watchdog jobs share a concurrency group; this does not serialize Modal's native scheduled executions.
3. KR quote polling time was incorrectly recorded as trade time. Use the source's timezone-qualified `localTradedAt`, support current PRE_MARKET spelling, choose the newest matching session/venue, reject halted/closed data and never fall back to the opposite session. Unknown-time prices remain display-only. NXT 08:50–09:00 and 15:30–15:40 do not qualify for extended-hours execution.
4. Yahoo v7 could overwrite today's pre-market timestamp with yesterday's post-market timestamp when both prices were supplied. Timestamp selection now follows the active session. New prices lacking timestamps cannot inherit a cached timestamp through either quote write path. Future timestamps are rejected.
5. An accepted retraining dispatch is no longer labelled as confirmed ongoing training. Completion must be checked through run results and individual model receipts.

## Data and session verification

- Naver realtime SERVICE_ITEM:005930 at 2026-09-11 08:12 KST supplied PRE_MARKET/OPEN, price 260,500 and localTradedAt 08:12:11.520127+09:00. This directly disproves the need to synthesize freshness from poll time.
- NXT official execution windows: https://www.nextrade.co.kr/menu/transactionSys.do (pre 08:00–08:50; after 15:40–20:00). Order collection is not execution.
- Nasdaq official schedule: https://www.nasdaq.com/market-activity/stock-market-holiday-schedule (US pre 04:00–09:30 ET; after 16:00–20:00 ET). The app deliberately uses a narrower 07:00 ET pre-market start; this patch does not expand trading hours.
- Yahoo v8 AAPL includePrePost returned changing after-hours five-minute prices with zero volume. Zero reported volume alone cannot establish stale prices. The app's seven-minute freshness limit is retained; a chart bar timestamp is not a broker-executable quote guarantee. Public-feed delay, spreads, slippage and holiday/vendor availability remain limitations.

## Verification and scope

- New `tools/check-recovery-provenance.mjs` executes real preprocessing/recovery/parsers with no network or orders. Covers embargo alignment, missing/stale/wrong-version peers, old/missing/future/closed/wrong-session quotes, NXT boundaries and Yahoo dual-session timestamps.
- Existing feature invalidation and stale-reason tests retain their assertions with updated extraction anchors. New test wired after numpy installation in deploy workflow.
- No binding, cron, schema migration, order route, position sizing, trust threshold, sidebar or design changes. Public build/cache tags only advance to V33.346.
- Deployment, full-suite and actual retraining results are recorded in AI_HANDOFF.md; workflow success alone is not model admission.
