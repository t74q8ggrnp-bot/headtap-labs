<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## ProX doctrine

Before changing ProX, Spot Momentum ranking, opportunity eligibility, scoring,
or any bridge between ProX and the canonical pipeline, read
`docs/PROX_GUIDE.md` and `docs/SCORING_OWNERSHIP.md` in full.

`docs/PROX_GUIDE.md` is the governing ProX design contract. Do not expand ProX
public or execution authority, reuse canonical decision fields as independent
ProX scoring inputs, or change the documented score contract without explicit
owner approval. If implementation and the guide conflict, stop and surface
the conflict before editing code.

Before changing the paper trading bot, its entry or exit rules, its connection
to canonical opportunities, or its ProX observation bridge, read
`docs/TRADING_BOT_GUIDE.md` in full. Preserve the single-bot, Alpaca-paper-only
boundary and keep position management independently enabled from new entries.
