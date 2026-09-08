# HT Labs production incident diagnosis — September 3, 2026

## Outcome

Do not approve a compute upgrade as the incident fix yet. The application
database became unavailable, but the available evidence does not distinguish a
depleted Disk I/O Budget, RAM/swap pressure, a query spike, or a connection
spike. That distinction requires the Supabase Database Health report for the
incident window. No infrastructure or spending setting was changed during this
diagnosis.

The database is reachable again. At 17:01 UTC a complete production health read
finished in 41.855 seconds with 35 of 37 checks healthy. A subsequent Massive
CHPT quote completed in 414 ms with a provider timestamp 0.373 seconds old, and
the momentum opportunity endpoint completed in 150 ms. Recovery is therefore
real, but it is not proof that the original resource condition is resolved.

## Confirmed incident timeline

- Around 10:18–10:20 Eastern, Supabase reads returned upstream timeouts and SQL
  Editor could not connect.
- At 11:47 Eastern the owner observed all Supabase services healthy, together
  with a warning that multiple resources were being exhausted.
- From roughly 12:04–12:09 Eastern, Canonical, ProX, Agent, Paper matcher and
  CoinAPI jobs timed out together. That common failure pattern is database-path
  failure, not five independent market-data failures.
- At 13:01 Eastern the database and stock paths were serving again.

## Confirmed software defects exposed by the outage

### 1. CoinAPI accounting can remain permanently paused

Production currently has 948 of the owner-approved 1,000 maximum requests
reserved. Exactly one provider request has no completed database settlement.
The collector correctly fails closed, but its existing recovery function only
accepts `unknown_provider_cost`; production is blocked as
`unsettled_provider_usage`. Therefore the minute cron keeps returning paused and
cannot repair this state itself. This is a state-machine gap, not budget
exhaustion. The repair must preserve the request as fully reserved, wait for all
leases to expire, retain the unknown receipt, and release only this bounded
database-write failure. It must not call CoinAPI or increase the cap.

### 2. Agent health is falsely red while a new cycle runs

The health handler selects the newest Agent run per profile and requires that
exact row to be a completed success. A locally executed reproduction using the
production source showed that a success completed 60 seconds ago is healthy,
but adding a cycle that has been running for 10 seconds makes the same profile
unhealthy. Health should evaluate the newest completed success separately from
the current in-progress cycle, and should fail only if the in-progress cycle is
actually overdue.

### 3. Agent completion write errors are ignored

`runHtAgentCycle` does not inspect the result of the database update that marks a
run successful. A local reproduction made that update return SQL timeout 57014;
the function still returned a successful `{ runId, decisions, orders }` result.
The write must be checked and the run must not be reported complete unless the
database confirms it.

### 4. First Agent profile creation is race-prone

`getOrCreateHtAgentProfile` performs read-then-insert. Two simultaneous first
dashboard requests both observe no profile and one insert fails with SQL 23505.
This exact unique-constraint failure appeared in production logs. Creation needs
an idempotent upsert or a conflict-read path.

## Ruled out as the present blocker

- The one-time 20,000-record legacy audit is not still running. Three recent
  maintenance cycles each reported `audited: 0`, `stopReason: drained`, and
  completed in 193–341 ms with zero provider requests.
- The current CoinAPI pause makes zero new provider requests, so it is not
  continuing to spend credits while paused.
- Stock Canonical, ProX, stock Paper Trading, and Massive entitlement passed the
  17:01 UTC health audit. This does not certify every end-user transaction.

## Remaining evidence required for the database root cause

Read the Supabase Database Health report for approximately 10:00–12:15 Eastern:

1. Disk I/O Budget and read/write IOPS.
2. RAM and any swap usage.
3. Database connections.
4. Query Performance entries ranked by total time and calls.

Without those time-series metrics, choosing between query/cadence repair and a
Small compute upgrade would be a guess. A resource upgrade is capacity relief,
not a substitute for fixing the confirmed application defects above.
