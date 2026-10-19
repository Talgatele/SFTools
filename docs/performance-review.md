# Performance review — 19 October 2026

Baseline: `e4432f337aab5a38489bcd4d9c02d4a3fe47a5c1`. Changes deliberately keep the
existing architecture, solver settings, calculation accuracy and history depth.

## Implemented improvements

| Area | Change | Expected effect |
| --- | --- | --- |
| Graph warnings | Aggregate incoming/outgoing amounts once per connection and item | Replaces repeated whole-edge scans with linear aggregation; fewer temporary arrays during edits/restores |
| Edge preservation | Index IO by node and item only when prior connections exist | Avoids scanning all producers/consumers per preserved edge; duplicate IO retains existing behavior |
| Routing preservation | Index prior connections once, preserving the first duplicate | Replaces a linear search per edge when merging/rebuilding |
| Elastic nodes | Sum input/byproduct connection totals once | Avoids scanning every edge for each elastic node |
| LP construction | Build requested-item membership sets once | Less work during repeated maximisation rounds, especially with many targets |
| Solution parsing | Filter columns in one pass; scan only raw primal-column lines | Fewer intermediate arrays; avoids splitting raw row/dual sections |
| Worker memory | Share pending WASM initialization, unlink the consumed MEMFS model, drop unused row diagnostics before posting | Avoids duplicate WASM initialization, releases the last successful LP file, reduces structured-clone and main-thread retention costs |
| Recipe tab | Cache sorted recipes and enabled selections using existing signal dependencies | Sorts once per data change and resolves selection once per settings/data/defaults change instead of for every rendered checkbox; edits copy the cached set |
| Startup | Dynamically import ELK inside the existing layout method | Defers about 1.46 MB of JavaScript until layout is requested |
| HTTP transfer | Include Apache's `text/javascript` MIME type and WebAssembly in DEFLATE rules | Actually compresses JavaScript/solver assets in the Docker image, reducing download time |
| Save import | Check subscription before posting an asynchronously read buffer | Avoids posting a large file after cancellation/timeout |
| Docker | Smaller Apache concurrency ceiling/cache budgets, shorter keep-alive, connection recycling, two build workers | Bounds serving concurrency and reduces idle/burst memory; build parallelism remains configurable |

The new indexes are temporary and proportional to the current graph. They trade some scratch
memory for removing repeated scans and allocations; there is no persistent graph cache or
unbounded new cache. The recipe tab retains one sorted list and one selection set, invalidated
by the relevant signals.

## Measurements

Node v24.14.0 on this Windows host. Synthetic graphs have equal mine/product pairs spread
over 16 item types, plus a parallel connection and a deficit. Each method benchmark verifies
identical baseline/current results, warms up five times and reports the median of 15 runs.
These isolate method costs, not complete browser interaction latency. The table records
representative runs; absolute timings vary with host load.

| Operation and fixture | Before | After | Time reduction |
| --- | ---: | ---: | ---: |
| Preserve edges, 2,000 nodes / 1,001 edges | 8.25 ms | 3.20 ms | 61% |
| Warnings, 2,000 nodes / 1,001 edges | 62.73 ms | 1.58 ms | 97% |
| Restore routing, 2,000 nodes / 1,001 edges | 27.75 ms | 5.79 ms | 79% |
| Preserve edges, 10,000 nodes / 5,001 edges | 55.21 ms | 7.88 ms | 86% |
| Warnings, 10,000 nodes / 5,001 edges | 1,009.63 ms | 6.72 ms | 99% |
| Generate LP, 1,000 requested items / 999 recipes | 17.12 ms | 3.55 ms | 79% |

Small graphs have much smaller absolute gains, and indexing overhead can offset the saving.
The large LP fixture deliberately stresses many requested targets; ordinary plans with a
handful of targets should see a smaller improvement.

The production build moves ELK into a lazy chunk (~1.46 MB raw / ~339 kB estimated compressed).
Initial assets fall from about 4.15 MB to 2.67 MB raw, a **36% reduction**. ELK is still downloaded
when layout is first needed, so the first calculation pays that deferred fetch/initialization.
Browser heap reduction has not been measured; bundle bytes are not a heap-size estimate.

HTTP verification found that this Apache image serves JavaScript as `text/javascript`, while
the original compression rule matched only `application/javascript`. Both types are now covered,
along with `application/wasm`. Actual gzip response-body sizes (not build-tool estimates) are:

| Asset | Uncompressed bytes | Gzip wire bytes | Reduction |
| --- | ---: | ---: | ---: |
| Current main JavaScript | 2,401,882 | 662,311 | 72% |
| Deferred ELK chunk | 1,463,398 | 442,641 | 70% |
| HiGHS loader | 68,966 | 19,689 | 71% |
| HiGHS WebAssembly | 3,078,627 | 1,072,242 | 65% |

The baseline main bundle was 3,876,708 bytes and was served without gzip by that rule.
Combining lazy loading and working gzip therefore reduces the initial main-bundle transfer to
about 662 kB, **83% below baseline**. Actual startup time still depends on network conditions,
browser execution, API requests and whether the browser already has the immutable assets cached.
The HTTP smoke test checks gzip headers and verifies byte-identical decompression for all four
assets, including the lazy chunk and WebAssembly MIME type.

Docker measurements use the same PHP/Apache base, 256 MiB limits, 32 local HTTP clients and
a ten-second cold burst against `index.php`. Metadata requests are forced to fail immediately
against local port 9 in disposable containers, exercising fallback HTML without contacting
the public API. Memory is sampled cgroup usage minus inactive file cache. A run measured
**80.27 MiB → 75.15 MiB peak working set (6% lower)**, with zero failed requests or OOM events.
Idle measurements were **12.12 MiB → 10.89 MiB (10% lower)**. The same run completed 23,495
requests before and 24,910 after; p95 latency was 17.84 ms before and 15.42 ms after. These
short-run throughput/latency differences should be treated as observations rather than speed
guarantees. Cold worker spawning, host load,
keep-alive and metadata API latency affect both memory and request timing; treat these as
workload-specific observations, not a production capacity guarantee. OPcache's configured
budget falls from 128 to 16 MiB; this does **not** imply 112 MiB of resident-memory savings.

## Practical estimates and limits

- Large graph warning/connection bookkeeping: expect roughly 50–95% less time in the changed
  methods, depending on graph shape. The largest stress case measured a greater reduction.
- Overall calculations: the HiGHS engine, mathematical model and tolerances are unchanged.
  Solver-dominated plans may show little total-time improvement; no defensible single overall
  percentage can be inferred from these method benchmarks.
- Recipe tab: selection resolution drops from roughly one resolution per visible recipe per
  check to one per dependency change. The regression test verifies 200 selection checks resolve
  once, then refresh after changes. DOM/rendering costs remain.
- Container runtime: a reasonable starting expectation is roughly 5–15% less idle/burst
  working memory for a comparable small deployment; verify with representative traffic.
  The worker ceiling falls from 150 to 64 (57% fewer permitted worker processes), but this is
  a concurrency budget, not a measured reduction in total memory. Beyond 64 active workers
  requests queue. Build-worker memory savings were not measured.
- Worker transfer/raw parsing: fewer row objects and line arrays are allocated/transferred,
  but HiGHS still initially creates row diagnostics and its WASM heap can retain a high-water
  allocation. No fixed browser-memory percentage is claimed.

## Remaining opportunities requiring separate profiling or broader changes

- ELK layout still runs on the main thread once loaded. Moving it into a cancellable worker
  would improve responsiveness on very large graphs but expands the scope beyond local changes.
- HiGHS still parses pretty-text solution diagnostics before full-precision restoration. Direct
  numeric extraction could remove that work, but requires changing the vendor integration.
- X6 node/edge rendering, graph export rasterization, synchronous localStorage serialization,
  and large history snapshots can dominate large plans. Their data ownership and persistence
  semantics need browser profiling before caching, deduplication or scheduling changes.
- Folder/subplan summaries repeatedly traverse related plans, and graph node identity matching
  still scans existing nodes during merge/rebuild. Indexing these is a possible follow-up after
  measuring realistic folder and merge workloads.
- The PHP metadata request can still wait up to 800 ms for the upstream API. Changing caching
  or preview freshness is a separate behavior decision; this review preserves it.

## Reproduce and validate

```bash
npm run test:satisfactory
npm run test:performance
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.worker.json
npm run benchmark:performance
docker build -t sftools:perf-after .
node tests/http-performance-smoke.mjs http://127.0.0.1:18082
```

The benchmark accepts an alternative baseline Git ref: `npm run benchmark:performance -- <ref>`.
The default baseline must be present in local Git history. Regression tests do not need it.

For Docker comparison, build the baseline checkout as `sftools:perf-before`, then start disposable
containers named `sftools-perf-before` and `sftools-perf-after`, each with `--memory 256m`, mapped
to `127.0.0.1:18081:80` and `127.0.0.1:18082:80` respectively. Run:

```bash
node tests/docker-performance-benchmark.mjs
```

That script modifies the **test containers'** `.htaccess` API URL to local port 9. It must not
target production containers. Restart both containers before repeating a cold run. It reports
request failures as well as memory and latency. Remove the disposable containers after testing.

Validation includes the real HiGHS calculation suite, targeted graph/precision/cache regressions,
application/worker TypeScript checks, production Docker compilation, Apache configuration checks,
and HTTP smoke/load checks. The existing HomeComponent style budget warning remains.
