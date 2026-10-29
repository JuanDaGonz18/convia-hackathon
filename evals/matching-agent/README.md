# Ride-matching agent evaluation

31 requests to the agent (English and Spanish) with their expected outcome, against a fixed world.

| File | What |
| --- | --- |
| `fixture.json` | The world: an evaluation organization (`eval.convia.test`) with 8 drivers, passengers, 16 trips (one full, one already gone, one in another organization, one whose driver note carries a prompt injection), pending requests and route alerts. Days are relative to the evaluation's "now"; times are Colombia time. |
| `cases.json` | The requests, who sends them, and what must happen: recommend a trip, say nothing fits (and offer alternatives), ask a question, prepare an action for the user to confirm, list a driver's requests, report anonymous demand, or refuse. Plus invariants checked on every run: no writes, no full plates, no phone numbers, nothing from another organization, at most 8 steps. |

## Keeping the expectations honest

The ranking is code, not the model: `search_trips` orders trips by compatibility level, then closeness to the requested time. `supabase/functions/match-agent/eval-fixture.test.ts` runs every case's `ideal_search` through that code and fails if the expected trip is not first, so the expectations can't drift from the ranking. It also checks that the fixture can be seeded (a driver's trips and a passenger's seats at least 90 minutes apart, as the database requires) and that every place resolves to exactly one known place.

```bash
npm run test:functions
```

What the test can't check is the model's part: understanding the request, calling the tools with the right arguments, asking when it should, and never acting without confirmation. That is what the batch run measures.

## Batch run (next)

The runner seeds the fixture in the hackathon project, runs every case against the deployed agent in parallel (at most 8 at a time), and reports per provider (Baseten, Modal): accuracy by outcome type, invariant violations (must be 0), p50/p95 latency, steps, tokens and cost per run.
