# SysDesign Flow

*[Русская версия →](README.ru.md)*

A visual trainer for designing high-load systems: assemble a scheme out of blocks (clients, load
balancers, gateways, services, databases, caches, brokers, S3, CDN) and find out what RPS it
sustains, where the bottleneck is, what the p99 latency looks like, how many petabytes pile up in
a year and what all of it costs.

**[Open the editor →](https://alexxtn105.github.io/sd-flow/)**

## Status: phase 4 done (v1.4)

Behind us are the scheme editor (phase 0), the steady-state load model (phase 1), the
Challenges mode (phase 2) and the passage of time with probes and the full catalogue (phase 3).
Version 1.2 unblocked the wiring: server blocks got a second input port for consuming broker events,
and compatible ports light up while you drag a connection. Version 1.3 adds three practice modes on
top of the challenge catalogue — **Interview**, **Incident** and **Golf** — plus a **challenge
editor**: write your own task in YAML or JSON and run it through the same acceptance engine.
Version 1.3.2 makes the catalogue explain itself: every block has a reference window, every
parameter has a hint with its unit, and a connection can be given a name.
Version 1.4 closes the MVP gaps listed in [docs/06-backlog.md](docs/06-backlog.md):
the **scheme ceiling** (binary search for the load at saturation, naming the limiter),
**geo routing** and replication modes, availability with «k of n» quorums and the price of a
failover, consistency mitigations, backup volume, cancellation of a stale computation,
**scheme settings** (consistency model, pricing profile, model depth), live node metrics in the
inspector, and copy/paste on the canvas. The headline model change is that **a slow dependency now
occupies the caller's pool**: while the database is thinking, the worker slot is held, so the
caller's capacity drops and the cascade arrives as ρ, not only as errors. The minimap is now a
switch in the canvas controls — off by default on a phone. Version 1.4.1 corrects the tail of a
wide parallel fan-out and keeps a resized container size in the saved scheme. Version 1.4.2 fixes
updating after a release: the document is fetched from the network, a version change clears the
offline cache, and the version number is visible in the header. Version 1.4.3 turns the heat map on:
the thermometer button tints blocks by utilisation and puts a scale legend on the canvas.
Version 1.5 charges the consistency model its price: optimistic locking pays in retries under key
contention, pessimistic locking pays with a `key-serialization` capacity limit, idempotency keys
take up storage with a 24-hour TTL, and the **split-brain** scenario lets replicas diverge on both
sides of the partition and prices the merge. In the dashboard an anomaly unfolds into the formula it
was computed from, and the table is followed by what the enabled mitigations actually remove. A
foreign scheme file now goes through a migration: a model-version mismatch, dropped unknown blocks
and orphaned links are reported instead of being swallowed. In challenges the rubric is visible before submission, a
requirement is broken down by node ("Postgres — 180 ms, 58%"), and progress for the catalogue and
the practice sets can be exported to a file and imported back, merging the better of the two sets. Block parameters are edited with a slider, an XS-XL size preset
and a popover opened by a double click on the canvas, while derived values gained an Auto/Manual
mode: the hit ratio is either computed by the model or set by hand, and editing a client's RPS
recomputes DAU back. Regions gained three display modes (all at once, one at a
time in tabs, collapsed), any group folds into a card with aggregate edges, and `mirrorOf` finally
works: a mirror region instantiates the prototype's contents, receives its edits and unlinks with
one button.

Version 1.6 is a recalculation pass driven by the model review
([docs/07-model-review.md](docs/07-model-review.md)): 27 of the 29 defects found are closed. The
read/write mix no longer stops at the client but is inherited along the chain: splitting reads to a
replica and writes to a primary stopped doubling the traffic, and an edge gained an
Inherited/Manual mode. Edge flows now live between solver passes, so a cycle's back edge is not
lost, multi-region became symmetric, and a replicated write no longer circles between regions. The
latency walk follows the traffic the solver actually routed, and a far region costs a **detour** —
the difference to the nearest one instead of nothing. An outage stopped being profitable: a downed
node turns lost traffic into errors, charges the caller a timeout, keeps its data and its bill, and
`az-failure` bites even without a drawn availability-zone block. A cache shows exactly the hit ratio
it absorbs, and TTL is computed on the same Zipf distribution as the hit itself (a cache holding
10M keys with a 300 s TTL yields 0.66, not 0.02). Egress is billed for any entry block, pods in a
cluster are paid for once, and acceptance judges the design under canonical conditions — the seed
and the pricing profile from the panel no longer move the verdict. In the inspector every link
parameter now has a hint, sliders for integer parameters stopped producing fractional instances,
and the default interface language is English. Version 1.6.3 brings the earned stars back to the
practice sets: the Interview, Incident, Golf and custom-challenge cards read the same progress as
the catalogue — the three-star scale used to be drawn for catalogue challenges only.

Version 1.7 audits the bill. Provisioned disk IOPS are now charged, as the model documentation
promised all along — thirteen blocks used to hand out disk performance for free. Every declared
price is checked against the whole catalogue by a test: doubling any `costPer*` parameter has to
move the monthly bill of a scheme built around that block. The parameters that deliberately do not
pay — machine size, declared disk ceilings, behaviour coefficients — are now listed and explained
in [docs/02-simulation.md](docs/02-simulation.md) §9.1 instead of leaving you guessing. On the
canvas, the coloured group edge on the left of a block survives the dark theme: the theme's border
override used to repaint it grey.

* **Catalogue — 127 blocks in 14 groups: the whole planned catalogue**, MVP (44) plus V1 (65)
  plus V2 (18). A capacity model is filled in for 101 blocks — every block that carries traffic;
  clients have none by construction (they are sources), and containers, links and probes never
  have one. 99 generic icons, no vendor logos as a matter of principle.
* **23 challenges** across levels 1–5, accepted by predicates, a Realism Gate, an anti-pattern
  linter, a seven-axis rubric and stars — plus **6 interview sessions, 10 incidents and 5 golf
  tasks** derived from them.
* **A reference for every block**: what it is, what limits its capacity (the bars are computed by
  the block's own model at default parameters, so they cannot drift from the engine), good
  practice, common mistakes, a parameter table and links to the neighbours in its group — opened
  from the palette, the inspector or the node's context menu. 127 articles and 666 parameter
  hints per language, loaded on demand rather than shipped in the main bundle.
* **16 scenarios**, ten of which run over time.
* The computation is deterministic: the seed is derived from the scheme, the scenario and the
  model version; `Math.random()` is banned inside the engine.

### What the engine computes

* **Steady-state flow solver** — damped iterations (ω = 0.5, up to 50 passes, convergence
  threshold 0.001) with retry amplification, traffic absorbed by caches and autoscaling.
* **Capacity with a named limiter** — `cpu`, `iops`, `connections`, `ops`, `memory`, `partitions`
  and some fifty more resource names. Every limiter shows its formula with the values substituted,
  and `boundBy` is printed straight onto the block.
* **Queues** — the Sakasegawa approximation for G/G/c corrected for arrival and service
  variability: waiting time, queue depth, load shedding above capacity, timeouts.
* **Latency p50/p95/p99** — Monte-Carlo over the call tree, 20 000 samples per flow: log-normal
  service time, queue waiting, `sequential` versus `parallel`, retries with exponential backoff,
  timeouts and cache misses.
* **Transient mode** — a run over time steps instead of a single slice: autoscaler lag, queues
  that carry memory between steps, cache warm-up. Series for load, utilisation, p99, backlog,
  errors and instance count are drawn as a timeline in the dashboard, with SLO breaches banded.
* **Cache hit ratio is derived, not declared** — from the Zipf distribution over keys, the memory
  size, the TTL and the write share. A cache as large as the database does not help when the TTL
  is shorter than the re-access interval, and the numbers show it.
* **Storage, logs, egress, cost** — accumulation over a 365-day horizon, log volume from
  `logLinesPerRequest × logBytesPerLine`, four price profiles (AWS, GCP, Hetzner, on-prem).
* **Availability** — accounting for redundancy and 5% correlated failures (otherwise three
  replicas at 99.9% would yield nine nines), plus single points of failure.
* **Multi-region** — traffic shares per region, replication traffic and cost,
  `RPO = p99 of replication lag`, `RTO = 30 s detection + 60 s DNS TTL + block failover + 60 s
  warm-up` (plus 900 s for a manual switch), compared against the targets.
* **Network perimeter** — the `vpc` and `k8s-cluster` groups: the inter-network hop and the NAT
  egress land in latency, the control plane lands in cost, and NAT saturation or an exceeded pod
  ceiling arrive as findings.
* **Consistency anomaly simulation** — eleven kinds: stale read, read-your-writes violation,
  non-monotonic read, lost update, multi-master write conflict, silent write loss under
  last-write-wins, duplicate processing under at-least-once, ordering violation, and the three
  SQL isolation anomalies derived from `isolationLevel` — dirty read, non-repeatable read and
  phantom read.
* **16 scenarios** — steady-state `baseline`, `peak`, `az-failure`, `region-failure`, `stale-read`,
  `write-conflict`, and transient `spike`, `growth`, `black-friday`, `db-failover`, `cache-flush`,
  `thundering-herd`, `hot-key`, `slow-dependency`, `retry-storm`, `poison-message`.
* **Findings** — 15 engine rules (overload, saturation, retry storm, SPOF, hot key, growing
  backlog, read-heavy without a cache, retries without idempotency, egress eating the bill and
  others), the compiler's structural checks and the consistency anomalies — each with an
  explanation and the numbers substituted in.

### Probes and the waterfall

Eleven `probe-*` blocks attach to any node of the scheme and take a reading: RPS, latency,
utilisation, queue lag, storage projection, subtree cost, SLO and error budget, availability
nines, traffic breakdown, heat map, latency waterfall.

The reading is shown on the probe block itself and coloured by status; a double click opens a
draggable window with the number, the formula and its inputs. When a probe is attached to nothing,
or the block cannot yield the measured quantity, the window explains why instead of showing a zero.

Four of them draw rather than count. `probe-latency` opens a **histogram** with p50/p95/p99 marked
on it, built by bucketing the Monte-Carlo samples the engine already had in memory — the tail a
single number hides. `probe-rps` and `probe-utilization` show a **time series** over the run,
and say so plainly when the scenario is a steady-state slice with no history to show.
`probe-heatmap` **projects onto the scheme**: the canvas takes its node tint from the probe, while
each node keeps its own utilization bar.

**The latency waterfall** decomposes a flow into hops: bar width is the hop's own contribution,
its position is the accumulated time, and a separate row shows how much of the percentile the hops
failed to account for. It lives in the dashboard (with a flow and a p50/p95/p99 selector) and in a
compact form inside the `probe-waterfall` window.

### Challenges mode

23 challenges across levels 1–5: from a static site and a URL shortener to payments, a matching
engine, a global feed and live streaming. Each one has a brief with input numbers and SLOs,
machine-readable requirements, a scenario battery, hints priced in points, and reference solutions
that unlock after submission.

Acceptance runs as a pipeline: compilation → Realism Gate (which catches sham schemes) →
predicates → scenario battery → linter → seven-axis rubric → stars. The verdict is deterministic
and always points at the specific requirement that failed.

### Practice modes

Three sets sit on top of the same catalogue and the same acceptance engine — they are derived
challenges, not a parallel universe.

**Interview** — 6 timed sessions of 45–60 minutes. You build from an empty canvas; requirements
arrive in stages. At minute 20 the load grows three to tenfold and the budget is revised, at minute
35 geography or redundancy shows up. A later requirement with the same id replaces the earlier one,
so "budget ×10" reads as a revision rather than a second budget.

**Incident** — 10 broken schemes with a symptom and 10 minutes on the clock. Each starts from a
reference solution with a fault planted in it: a shrunken machine, a pinned instance count, a
dropped cache, reservation without a version check. A test holds the invariant that the clean
reference passes and the broken one fails on hard gates or scenarios — never on the Realism Gate,
which would name the broken parameter and give the puzzle away. The cause is revealed only after
you submit.

**Golf** — 5 tasks on minimum cost. The scheme already holds its SLO but is inflated with instances,
shards and replicas; the budget requirement is lifted and the monthly bill becomes the score. The
target equals the cost of the untouched reference, so gold is attainable by construction. Medals
only count once the scheme passes acceptance.

### Challenge editor

Write your own challenge in YAML or JSON and run it through the same engine. The format is the one
the catalogue uses, with a single difference: the starter scheme is data (`nodes` and `links`) rather
than a function, and "scheme from canvas" writes that block out of whatever is on screen — emitting
only the parameters that differ from the block defaults.

The YAML subset is parsed by a dependency-free parser of about 300 lines: block mappings and
sequences, flow collections, block scalars, numeric underscores, comments, JSON passthrough. Anchors,
aliases and tags are refused by name with a line number rather than mis-parsed. Validation returns
the whole list of problems with a path to each field, and the starter scheme is actually built during
the check, so incompatible ports surface in the editor instead of on the canvas.

### Not there yet

* **`splitByFlow` on `probe-rps`**: the timeline sums every flow into a single arrival rate, so
  there is no per-flow time dimension to split by. The parameter exists and does nothing.
* **Ordering guarantees are declarable on only two brokers** — `orderingScope` on Kafka and
  `queueType` on SQS. RabbitMQ, NATS, Kinesis, Redis Streams and SNS count as unordered with no
  way to say otherwise, so anomaly A7 may overstate them.
* **The `split-brain` scenario** — it needs a model of replica divergence and merge, not merely a
  shape of the input load.
* **Mirrored regions `mirrorOf`** — every region is described with its own nodes by hand.
* **A `k8s-cluster` grows without a ceiling**: with `autoscaleNodes` on it adds as many nodes as
  the pods need and bills for them, but cloud quotas, subnet addresses and instance availability
  are not modelled. No document specifies a cap, so none was invented.
* **The structural diff against a reference solution** — the metric diff exists; matching nodes
  between two schemes with independent ids does not.
* **Leaderboards** and **community challenges** need a backend and a trusted source for imported
  tasks; the app is static, so golf keeps a personal best locally and nothing is shared.
* The `custom` predicate — the fourteenth requirement kind. It is needed exactly where a function
  cannot go: in an authored challenge, that is, on untrusted input in a static app without `eval`.
  That means designing a bounded expression language, which no document specifies yet.
* The whole scheme is always recomputed; there is no incremental recomputation by subgraph.

## Sample schemes

The header dropdown holds 48 ready schemes: two demos below and, grouped by challenge and level,
all 46 reference solutions of the catalogue. A reference opens in the sandbox under the name
"challenge · solution" — it is a way to read someone else's design, not a submission.

Every block of a shipped scheme is titled by its role — "Hot links" rather than "Redis", with the
block type on the line below. Roles live in `locales/{ru,en}/nodes.json` keyed by node id, so they
follow the interface language instead of being baked into the scheme, and a renamed block keeps the
name you gave it.

The two demos double as an acceptance test (`tests/engine/demo-schemes.test.ts`).

**"Video platform"** — 1 B DAU, a CDN on top of S3 and a separate API branch: load balancer,
service, Redis, Postgres, Kafka and 2000 transcoding workers. The test pins down: 80–130 PB/day of
egress and 8–30 Tbit/s of bandwidth; under 15% of requests reach the origin, the CDN absorbs the
rest; every loaded node has a named limiter; a full 20 000-sample run fits into 100 ms.

**"Payments in two regions"** — 5 M DAU, a global load balancer, two regions (`eu-west-1` and
`us-east-1`), each with a service and Postgres, an `active-active` multi-region policy with
bidirectional replication and `lww` conflict resolution. The test pins down: the write conflict
rate is non-zero, LWW write loss equals half the conflicts, switching to `single-writer-per-key`
zeroes both; traffic splits across the two regions, RPO and RTO are computed; the `region-failure`
scenario takes down one region's nodes while the other keeps serving.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173/sd-flow/
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type check and production build into `dist/` |
| `npm run preview` | Local preview of the built bundle |
| `npm run lint` | ESLint 9 (flat config) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: 931 tests in 57 files — registry, catalogue, ports, store, serialisation, engine, model checked against queueing theory, transient, probes, challenges, practice sets, the authoring format, locales, node names, block reference and parameter hints, sample schemes, demo schemes |

Deployment is GitHub Actions on a push to `main`: lint → typecheck → tests → build → GitHub Pages.
The app installs as a PWA and runs offline; a scheme can be shared as a link, the canvas exported
to PNG and the computed result to Markdown.

## Documents

The documentation is written in Russian; this README is the English entry point.

| Document | About |
|---|---|
| **[PRD.md](PRD.md)** | The main document: goals, audience, modes, functional requirements, UX, roadmap |
| [docs/01-components.md](docs/01-components.md) | Catalogue of building blocks: 14 groups, 127 types, all of them in the registry, parameters of each |
| [docs/02-simulation.md](docs/02-simulation.md) | Simulation model: capacity, queues, latency, cache, multi-region, consistency anomalies, storage, cost, availability, constants; §15 — what of it is implemented |
| [docs/03-connections.md](docs/03-connections.md) | Connections: read/write/mixed, sync/async, traffic visualisation |
| [docs/04-challenges.md](docs/04-challenges.md) | Challenges mode and the acceptance algorithm, a catalogue of 28 tasks (23 implemented), the practice sets, the challenge editor and its YAML subset, the "YouTube" walkthrough |
| [docs/05-architecture.md](docs/05-architecture.md) | Technical architecture, repository structure, code reuse plan, ADRs |
| [docs/07-model-review.md](docs/07-model-review.md) | Model review: where the simulation was wrong — 29 defects with checkboxes, reproduction numbers and the repair order; 27 closed in 1.6 |

**Decisions taken (2026-08-14):**

* **D1** — multi-region belongs in the MVP: Region/AZ groups, mirrored regions, geo routing,
  cross-region replication, RPO/RTO.
* **D2** — the depth of the consistency model is a setting, `off / attribute / anomaly simulation`,
  **defaulting to anomaly simulation** (stale reads, read-your-writes, lost updates, multi-master
  conflicts, duplicates).

## Origin

The visuals, the flow, the block palette, drag & drop, the plugin architecture and the stack are
inherited from [**dsp-flow**](https://github.com/Alexxtn105/dsp-flow), a visual editor for digital
signal processing graphs. What exactly was carried over and what was rewritten — the table in
[docs/05-architecture.md §12](docs/05-architecture.md).

Stack: React 19 + `@xyflow/react` + TypeScript strict + Vite + Zustand + Immer + i18next + Vitest,
deployed statically to GitHub Pages.
