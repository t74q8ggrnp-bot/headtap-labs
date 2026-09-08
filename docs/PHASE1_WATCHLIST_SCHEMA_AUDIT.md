# Phase 1 watchlist schema audit

Repository evidence confirms that production code reads and writes a table
named `public.ht_labs_watchlist` with these contract columns:

- `user_id`
- `symbol`

Account deletion also treats the table as user-owned personal data. The Phase 1
client limits itself to the two evidenced columns and owner-scoped,
single-symbol operations. Inserts first perform an exact owner + symbol read
and only insert when absent; a concurrent Postgres unique violation is treated
as an idempotent success.

Migration `0049_secure_ht_labs_watchlist.sql` now makes that inferred contract
enforceable without silently repairing production data. It starts a transaction
and aborts before its first schema alteration unless the table and required
roles exist, `user_id` is already UUID, `symbol` is already text, all values are
non-NULL uppercase ticker symbols, every user exists in `auth.users`, and no
duplicate `(user_id, symbol)` memberships exist. It never deletes, normalizes,
reassigns, or backfills a row. An access-exclusive table lock keeps that
preflight valid while constraints are installed.

When the preflight succeeds, `0049` installs named symbol-format, unique, and
`auth.users ON DELETE CASCADE` constraints; enables and forces RLS; removes all
legacy policies and non-owner table/column grants; and creates exactly one
owner-scoped SELECT, INSERT, UPDATE, and DELETE policy for `authenticated`.
Authenticated receives CRUD only. `anon` and `PUBLIC` receive no table access.
`service_role` retains all table privileges and its required Supabase
`BYPASSRLS` behavior. A postflight assertion rolls the complete transaction
back if the installed contract differs.

This document describes repository readiness, not production state. Until
`0049` is applied successfully in production, the unique key, cascade, grants,
and RLS policy set remain unverified and the client continues using its
read-before-insert compatibility path.

The established `headtap-watchlist` key is now guest-only. Authenticated device
state is stored under `headtap-watchlist-user-v1:<encoded user id>`, alongside a
per-user synchronization snapshot. This prevents a newly active account from
reading or uploading the previous account's device list. Same-window events,
cross-tab storage events, and BroadcastChannel messages all carry and enforce
that account scope.

A deliberate guest edit creates an unclaimed migration marker. The first
account without an initialized device scope may claim that guest list once.
After a successful claim, the migrated guest key is cleared so signed-out mode
starts with an independent list; later guest edits can create a new claim.
For the legacy global key, migration is allowed only when browser storage shows
no prior account snapshot, or exactly one snapshot belonging to the same
account. Ambiguous legacy state fails closed and remains available in the guest
scope instead of crossing into a different account. Later syncs use the
per-account snapshot plus pending deletion tombstones so a stale tab cannot
re-add a symbol removed on another device. Cloud writes are serialized per
symbol, so rapid add/remove interactions finish in user order.

Recently viewed tickers remain device-local under
`htlabs-viewed-tickers`; they create no Supabase reads or writes.
