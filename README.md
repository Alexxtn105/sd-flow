# SysDesign Flow

*[Русская версия →](README.ru.md)*

A visual trainer for designing high-load systems: assemble a scheme out of blocks (clients, load
balancers, gateways, services, databases, caches, brokers, S3, CDN) and find out what RPS it
sustains, where the bottleneck is, what the p99 latency looks like, how many petabytes pile up in
a year and what all of it costs.

**[Open the editor →](https://alexxtn105.github.io/sd-flow/)**

## Status: phase 3 done (v1.1)

Behind us are the scheme editor (phase 0), the steady-state load model (phase 1) and the
Challenges mode (phase 2). Phase 3 added the passage of time, probes, the second catalogue wave
and ten new challenges. Version 1.1 closed the catalogue, taught the probes to draw, and added
three more consistency anomalies, a pod ceiling for the cluster and a metric diff against the
reference solutions.

* **Catalogue — 127 blocks in 14 groups: the whole planned catalogue**, MVP (44) plus V1 (65)
  plus V2 (18). A capacity model is filled in for 101 blocks — every block that carries traffic;
  clients have none by construction (they are sources), and containers, links and probes never
  have one. 99 generic icons, no vendor logos as a matter of principle.
* **23 challenges** across levels 1–5, accepted by predicates, a Realism Gate, an anti-pattern
  linter, a seven-axis rubric and stars.
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
* The `custom` predicate, the Incident, Golf and Interview modes, the challenge editor and
  leaderboards — those are still ahead.
* The whole scheme is always recomputed; there is no incremental recomputation by subgraph.

## Demo schemes

Both open from the dropdown in the header and double as an acceptance test
(`tests/engine/demo-schemes.test.ts`).

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
| `npm test` | Vitest: 588 tests in 31 files — registry, catalogue, ports, store, serialisation, engine, model checked against queueing theory, transient, probes, challenges, locales, demo schemes |

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
| [docs/04-challenges.md](docs/04-challenges.md) | Challenges mode and the acceptance algorithm, a catalogue of 28 tasks (23 implemented), the "YouTube" walkthrough |
| [docs/05-architecture.md](docs/05-architecture.md) | Technical architecture, repository structure, code reuse plan, ADRs |

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
