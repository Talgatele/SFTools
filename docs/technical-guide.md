# Satisfactory Tools: technical and agent guide

Repository reference for humans and coding agents. Reviewed against the working tree on 23 October 2026. Paths below are relative to the repository root. The source and configuration take precedence when they change; dependency versions below are declared ranges, not a guarantee of the installed version.

## 1. Project scope and boundaries

Satisfactory Tools is a browser application for planning factories in the game Satisfactory. It combines production optimisation, an editable factory graph, game reference data (the in-app **Codex**), custom game versions and mods, help content, and import/export tools.

This repository contains the Angular frontend and a small PHP web entry point for link-preview metadata. It does **not** contain the game-data/API backend, its database, or the game itself. References to `tools-api` in source comments describe an external service; no sibling backend checkout is required or established by this guide.

The upstream account system remains disabled: `Model/Auth/AuthService.ts` reports `isAuthenticated = false`, and `/auth`, `/account` and `/help/editor` redirect home. The Docker installation has a separate password-protected shared plan library in `deploy/web/server-storage.php`. It stores plans, folders, graphs, per-plan settings and custom-version references in SQLite on the `sftools-data` volume. `SharedAppStorage` authenticates and hydrates that library before Angular starts; display preferences remain browser-local. The plain `npm start` server falls back explicitly to `BrowserAppStorage` on loopback. Public game data, mods and shared links still use the configured external API. See [shared library setup](shared-library.md).

## 2. Technology and runtime

| Area | Repository configuration |
| --- | --- |
| Framework | Angular `^22.2.3`, standalone components, Angular Router, dependency injection, signals/computed state, RxJS `^7.8.2` |
| Language | TypeScript `~6.0.3`, strict mode, ES2022 target/module, bundler module resolution |
| UI | Bootstrap `^5.3.8`, ngx-bootstrap `^22.0.0`, Font Awesome 7, Lato fonts, SCSS |
| Interactive graph | AntV X6 `^3.1.7`; ELK `^0.11.1` layered layout is used by `PlannerGraphService` |
| Optimisation | HiGHS `^1.14.2`, JavaScript/WASM in a module Web Worker; LP and mixed-integer options |
| Save parsing | `@etothepii/satisfactory-file-parser` `^4.1.1`, in a separate module worker |
| Markdown | `marked` `^18.0.13`, DOMPurify `^3.4.17` |
| Active build | `@angular/build:application` and `@angular/build:dev-server` in `angular.json` |
| Reference Node runtime | Node 24 in CI and Docker; security baseline 24.22.1 on this line |
| Production web layer | PHP 8.3 + Apache in Docker; static Angular output, metadata injection and private SQLite library API |
| Package manager | npm, committed `package-lock.json`, normal peer-dependency validation |

Prefer the CI/Docker Node 24 baseline (24.22.1 or newer on that line). Supported Node ranges are declared in `package.json` engines.

Browser code depends on DOM/localStorage, Web Workers, WebAssembly, fetch, Blob URLs, and CompressionStream/DecompressionStream. This is a browser SPA, not Angular server-side rendering. PHP changes initial head tags but does not render Angular components.

`@angular/build` is a direct build dependency. The obsolete custom-webpack configuration, browser stubs, webpack toolchain and unused `@antv/layout` dependency have been removed. The Vite override selects a patched 8.3 release because Angular 22.2.4 pins a vulnerable version; review it when upgrading Angular. `angular.json` is the source of truth; it externalises `node:fs` and `node:crypto` and copies HiGHS assets explicitly.

## 3. Local setup and commands

Run from the repository root. PowerShell setup:

```powershell
npm ci
if (!(Test-Path src/env/env.ts)) {
    Copy-Item src/env/env.prod.ts src/env/env.ts
}
npm start
```

Open `http://localhost:4200/`. `env.ts` is gitignored; preserve an existing developer configuration. The committed example and production files both contain `production: true` and `apiUrl: https://api.new.satisfactorytools.com`. The example's `webUrl` points at `https://www.satisfactorytools.com`; production uses `https://satisfactory.bitstacker.dev`. Set local values deliberately; copying the file does not turn the API into a local service.

| Command | Purpose |
| --- | --- |
| `npm start` | Development server; development configuration is the serve default |
| `npm run watch` | Development build in watch mode, without a server |
| `npm run build` | Production build, output directly in `dist/` |
| `npm run test:satisfactory` | Node domain regressions using synthetic recipe fixtures and real HiGHS, including rounding, custom rates and cancellation |
| `npm run ng -- build --configuration development` | Single development build |
| `php -l deploy/web/index.php` | PHP syntax validation, also run by CI |
| `docker compose up --build` | Build and serve on `http://localhost:8080/` |

Production replaces `src/env/env.ts` with `src/env/env.prod.ts`, whose public web URL is `https://satisfactory.bitstacker.dev`; the example environment retains the upstream URL. Frontend URLs are build-time values, not container runtime settings. `SFTOOLS_PORT` changes the local Compose host port. The standalone `docker-compose.prod.yml` runs the app behind its own Caddy and Cloudflare Tunnel without publishing ports; it requires `CLOUDFLARE_TUNNEL_TOKEN` and `SFTOOLS_PASSWORD` in `.env`. See [Docker instructions](docker.md).

`npm test` runs domain, performance-regression and security tests using Node's test runner and the TypeScript import hook. `npm run test:security` selects security cases; `php tests/web-security.php` checks metadata with a local fixture; `php tests/shared-storage.php` checks authentication, revision conflicts and persistence. CI also runs `npm audit`, the Angular build, PHP syntax checks and Compose validation. There is no Angular test target or npm lint script; these tests do not replace browser interaction checks or verification against the full live game dataset.

## 4. Codespace map

All entries in this table are under `src/app/` unless otherwise stated.

| Path | Responsibility / useful entry points |
| --- | --- |
| `../main.ts`, `../config.ts` | Bootstrap, storage provider, routing, HTTP interceptors, errors, tooltips and animations |
| `RouteList.ts` | Route order, custom matchers, resolvers, legacy routes and titles |
| `Components/Root/` | Application shell, content and navigation |
| `Components/Planner/PlannerComponent.ts` + `.html` | Planner orchestration: active plans, calculation, graph editing, panels and navigation |
| `Components/Planner/PlannerGraphService.ts` | X6 rendering, ELK layout, graph presentation and graph interaction plumbing |
| `Components/Planner/PlannerActionsService.ts`, `GraphHistoryService.ts` | Planner actions and graph history |
| `Components/Planner/Panels/Calculator/` | Calculation controls, tab definitions/state, production/input/recipes/resources/power/sloops/optimisation controls |
| `Components/Planner/Panels/` | Plans tree, inspector, overview, items, power, build cost, settings, Codex and help panels |
| `Components/Planner/Panel/` | Docked/floating panel containers, rails and persisted panel layout |
| `Model/Planner/PlanManager.ts` | Plan/folder state, mutations, persistence and active-version store lifecycle |
| `Model/Planner/Plan.ts`, `PlanSettings.ts`, `PlanMetadata.ts` | Persisted plan and calculation configuration contracts |
| `Model/Planner/ProductionSolverService.ts` | Domain request assembly, LP construction, maximise flow and solution conversion |
| `Model/Planner/Solver/` | Solver transport, request/response types, worker and HiGHS solution types |
| `Model/Planner/Graph/` | Persistable graph, composition/reconciliation, edges, metrics and warnings |
| `Model/Planner/Breakdown/`, `Pool/` | Production/power/build-cost summaries and shared resource limits |
| `Model/API/`, `Model/API/Schema/` | HTTP clients and wire contracts, including data, plans, shares, versions, mods and help |
| `Model/Data/` | Version selection/loading, schema transformation, hydrated entities, indexes, icons and world limits |
| `Model/Storage/`, `Model/Sync/` | Storage adapter, local/API data backends, persistence and conflict-resolution abstractions |
| `Model/Settings/`, `Components/Settings/` | Defaults, normalization, settings state, settings UI and conflict machinery |
| `Model/Hotkeys/` | Action catalog, registrations, binding overrides, formatting and dispatch |
| `Model/PlanFiles/`, `Model/OldTools/` | Current plan files, conversion across versions and legacy import/share handling |
| `Model/SaveFile/` | Save parsing worker and mapping game unlocks into planner settings |
| `Model/Export/`, `Components/Planner/Export/` | SVG snapshot/cleanup, PNG rasterization, downloads and export dialogs |
| `Components/Codex/`, `Model/Search/` | Game reference browsing/details and shared search behavior |
| `Components/Mods/`, `Components/ModEditor/`, `Model/ModEditor/` | Mod browsing/editing, schema descriptors, validation and images |
| `Components/Versions/`, `Model/Data/LocalCustomVersionsService.ts` | Custom version creation and local tracking |
| `Components/Help/`, `Model/Help/` | Help browsing/panels and sanitized Markdown rendering |
| `Model/Errors/`, `Model/Network/`, `Model/Meta/` | Error classification/redaction/reporting, connectivity and client page metadata |
| `../styles/styles.scss`, `../styles/theme/` | Shared application styles and Bootstrap theme |
| `../../deploy/web/index.php` | Initial HTML metadata from external `/v1/meta` |
| `Model/Storage/SharedAppStorage.ts`, `LibrarySession.ts`, `LibraryImport.ts` | Pre-bootstrap library sign-in/load, browser migration, optimistic saves, durable draft journal and conflict recovery |
| `../../deploy/web/server-storage.php` | Password/session/CSRF-protected SQLite library API; same-origin only |
| `../.htaccess`, `../../docker/apache.conf` | SPA fallback, caching, metadata API setting and Apache behavior |

## 5. Features and routes

| Feature | Behavior and route |
| --- | --- |
| Home/version selection | `/`; home redirect behavior lives in `HomeRedirectGuard` |
| Production planner | `/:versionSlug/planner`, optionally `/:planId`; targets, supplied inputs, recipe selection, resource limits/weights, overclocking, machines, power, byproducts, sink points and somersloops |
| Calculation modes | `automatic`, `manual-fresh`, `manual-upgrade`, `manual-append`; see `CalculationMode.ts` and orchestration before changing semantics |
| Graph editing | Node/edge editing, splitting/resizing/locking, built markers, history, layout, context menus and touch gestures |
| Organisation | Plans, folders, nested subplans, folder summaries/recalculation and resource pools |
| Sharing | `/shared/:shareId` redirects into a version; `/:versionSlug/planner/shared/:shareId` opens a share; shared plans are read-only in `PlanManager` |
| File tools | `.sft` plan export/import, legacy imports, cross-version conversion, SVG/PNG graph export |
| Save unlock import | Read a game save to map unlocked content into calculator settings; this is distinct from exporting/editing game saves |
| Game reference | `/:versionSlug/codex` and nested paths, items/recipes/buildings/schematics |
| Custom data | `/create-version`, `/mods`, `/mods/:modId`, `/mods/:modId/versions/:modVersionId/data`, `/mod-editor` |
| Help | `/help` and `/help/:slug`; help also appears inside planner panels |
| Settings/about | `/settings`, `/settings/:section`, `/about` |
| Restricted/legacy routes | `/help/editor` and its children redirect home; legacy URLs and old `#!/...` links have dedicated conversion paths |

Custom matchers intentionally reuse planner/Codex/help components as internal paths change. Route changes therefore need to update state on navigation, not only at construction. Reserved top-level routes must precede `:versionSlug`. `main.ts` rewrites old hashbang links before routing.

The Request tab guide (`tab-request`) is bundled in `src/assets/help/tab-request.json`, with search/topic metadata in `Model/Help/BundledHelp.ts`. `HelpManager` merges that metadata into the external manifest and serves the local article first, including when the external help service is unavailable. It documents fixed rates, maximise and Satisfactory mode together; the Request table's Rate help icon opens this guide. Other articles continue to use the external service.

## 6. Runtime data flow and contracts

### Startup and game data

`main.ts` bootstraps `RootComponent` using `config.ts`, registers `BrowserAppStorage`, and raises `sftools:boot-failed` if bootstrap fails. `index.html` handles the boot failure screen. Configuration registers fetch-based Angular HTTP, retry/connectivity/API-call-log interceptors, the error handler and title strategy.

The root route resolves versions and settings. `ApiService` loads `/v1/versions` and a selected version's `dataPath`. `VersionDataResolver` selects the version from the slug; `VersionManager` manages active version/data, local custom versions, reconnect reloads and one-time stale data-path recovery. `DataTransformer` and `Data` turn wire schemas into entities and lookup indexes.

Use game `className` identifiers for entity references; display names are not stable keys. Keep API schemas distinct from hydrated entities. Obtain recipes, buildings, items and limits through active-version data instead of assuming one global game release or hard-coding recipe availability.

### Calculation and graph

The planner supplies a `Plan` and optional locked nodes to `ProductionSolverService`. It resolves settings, recipes, inputs, objectives, resource pools, clock speeds, power and somersloop constraints, builds an LP, and uses `SolverService`. The worker solves with HiGHS and returns a `HighsSolution`; production code converts this into typed solver nodes. Graph composition/reconciliation and edge building support applying the result to the editable graph; `PlannerGraphService` handles X6 display and ELK placement. Summaries are derived through breakdown services.

Keep these layers separate: a solver result is not an X6 cell tree, and graph presentation is not the optimisation model. Inspect `GraphComposer`, `GraphReconciler`, `GraphEdgeBuilder` and the selected calculation mode when a re-solve unexpectedly replaces user edits.

Solver implementation details that matter:

- Satisfactory item requests use `SatisfactoryTargets` to derive production depth from standard machine recipes. Space Elevator class IDs target the throughput of two machines at 100% (4 Smart Plating/min, 10 Versatile Framework/min). For these parts, an enabled standard recipe takes precedence over alternates throughout the calculation; alternates remain available when the standard recipe is explicitly disabled or unavailable. The top two other depths target two recipe batches per minute, intermediates five, and basic items share the remaining capacity. Enabled production routes determine batch sizes, including alternates for other items. Automatic rates are rebuilt at clean whole/half/one-decimal values where possible; sub-0.1 rates retain their maximum. Each capped target is reserved in hierarchy order, so a resource shortage can reduce later targets to zero. `ProductionRequest.satisfactoryOverride` is an optional fixed rate reserved before automatic allocation; absence preserves automatic behavior for older plans. The request serializers preserve this optional field directly. Power and sink-point Satisfactory targets retain the existing maximise-and-round behavior.
- Automatic plan icons use the same cached standard-recipe production depths, prioritising Space Elevator outputs and then the deepest requested item (or graph output for plans without item requests). Request order does not affect the icon. `PlanIconResolver` refreshes automatic icons when displaying older stored plans; custom icons and explicit no-icon selections are preserved. Automatic plan names still follow the first product.

- `SolverService` has a 90-second default timeout. Unsubscribing from a pending solve terminates/replaces the worker because HiGHS runs synchronously within it. Preserve cancellation and request-ID behavior.
- `SolverWorker.ts` fetches `/assets/highs.js`, patches its output precision, imports it through a Blob URL, and locates WASM under `/assets`. `angular.json` copies both files from `node_modules/highs/build`.
- The precision patch depends on exact upstream source anchors. A HiGHS upgrade must check those anchors and large-flow balance; otherwise output can fall back to six significant digits and create false shortages.
- Current options include a default mixed-integer relative gap of 0.05, overridable by worker options. Numerical tolerances, integer choices and display rounding are different concerns; changing one can alter feasibility or runtime.
- Assets are resolved from the origin root. Subpath hosting or restrictive CSP can break worker startup even when Angular itself loads; verify fetch, Blob module import and WASM delivery.

### Persistence and compatibility

`PlanManager` extends `SyncableService<PlanStore>`. `LocalPlanStoreBackend` uses the synchronous `AppStorage` abstraction by **version ID**, while routes select versions by **slug**. In Docker, `SharedAppStorage` supplies a preloaded server snapshot and queues revision-checked saves; in plain Angular development, `BrowserAppStorage` supplies browser storage. It tracks when the store is loaded for the active version; a version change can reload and replace the store. Wait for the proper lifecycle before importing or mutating plans.

| Logical storage key | Purpose |
| --- | --- |
| `sftools.plans.<versionId>` | Per-version plans and folders |
| `sftools.plans` | Legacy single store, migrated by `LocalPlanStoreBackend` |
| `sftools.settings` | Settings, including graph/planner defaults, hotkeys and panels |
| `sftools.lastPlanner` | Remembered planner location |
| `sftools.customVersions` | Shared custom-version IDs |
| `sftools.serverLibrary.journal` | Browser-local unsaved draft values and base revisions; never a password/session token |

Plan keys and custom-version references are server-backed in Docker; UI keys remain per-browser. This is not an exhaustive list of UI storage keys. Use `AppStorage` rather than adding direct browser-storage access to domain services. Browser migration is scoped to the origin, while the authenticated server library is shared across devices. Use exports or a disposable library when exercising destructive storage behavior. Server saves use compare-and-swap revisions; stale edits remain drafts until explicitly recovered as a copy.

Plans include identity, folder/parent-plan references, settings, requests, inputs, optional graph, metadata and revision. Existing persisted plans may lack newer fields. Update normalization/defaults and serializers alongside type changes; a TypeScript interface alone does not migrate stored JSON. Relevant boundaries include `LocalPlanStoreBackend`, `PlanSettingsNormalizer`, `SettingsDefaults`, `PlanSerializer` and `PlanDataSerializer`.

`.sft` uses comment lines followed by a format character and base64 of deflate-compressed JSON (`SftContainer`). Format `0` is legacy and `1` is this app's plan format. Containers are limited to 32 MiB of encoded text and 64 MiB of decompressed bytes; imports cancel the decompression stream at that limit. Export fewer plans at once if a file exceeds these limits. Use `PlanFileReader`/`Writer` and conversion services instead of treating files as plain JSON or copying graphs between versions without conversion.

Save parsing is a different pipeline: `SaveFileService` transfers a file buffer to a worker, applies a 120-second timeout, and terminates the worker on completion/unsubscription. `SaveSettingsMapper` maps the result into planner settings.

## 7. API, hosting and deployment

HTTP wrappers in `Model/API/` and interfaces in `Model/API/Schema/` are the local reference for external API requests. Do not infer an enabled feature solely from an API method. For example, share create/read endpoints exist, but account-related behavior must be checked against the disabled `AuthService` and the calling UI. Backend contract changes require coordination outside this repository.

Client metadata is managed by `Model/Meta/` and `RouteList.ts`. For unfurled links, `deploy/web/index.php` requests `/v1/meta?path=...`, injects escaped title/description/Open Graph tags, and falls back to generic HTML metadata on API failure. It limits the path and metadata response (64 KiB), disables redirects, uses short timeouts and allowlists public hosts. Its metadata API can be configured using `SFTOOLS_API_URL`; `src/.htaccess` also sets that value. Changing the frontend `env.apiUrl` does not automatically change PHP's metadata API.

Route comments explicitly require titles/descriptions and reserved first segments to stay aligned with the external `tools-api` MetaResolver. Keep that coordination visible when changing routes or public metadata.

The Angular build emits `dist/` including `.htaccess` and solver assets. PHP is **not** part of that build: Docker copies `deploy/web/` into the runtime web root separately. `.htaccess` serves existing files, sends application routes to PHP when present, and otherwise falls back to `index.html`. The initial HTML is not cached; hashed JS/CSS receives long-lived caching. The beta `new.` host receives a noindex header. Root-based assets and deep-link fallback should be tested on a deployment change.

`.github/workflows/ci.yml` runs the dependency audit, Node tests, production build, PHP security tests and Compose validation on Node 24. Its token has read-only contents permission and actions are pinned to commits. The obsolete upstream SSH deployment was removed; deploy this fork using the home-server Compose instructions. Dependabot checks npm packages, Docker base images and GitHub Actions weekly.

## 8. Efficient workflow for humans and agents

1. Read this guide and the relevant source area. Run `git status --short` before editing and preserve unrelated work. Check for applicable `AGENTS.md` files when starting; none were found in the reviewed repository tree.
2. Classify the task using the map below, then search for a specific symbol or user-visible label. Avoid loading the whole large planner component or graph service when a focused search can locate the behavior.
3. Trace the complete affected boundary: template/action → manager/domain logic → persistence or worker/API contract. Use nearby implementations for naming, injection and reactive-state conventions.
4. Make focused changes. Preserve read-only shared plans, version-scoped state, cancellation, legacy defaults and manual graph edits as applicable.
5. Run the relevant validation and inspect the diff. Report which checks actually ran, results, and any environment/API blockers. Update this guide if architecture, commands or compatibility rules change.

| Request type | Start here; follow through to |
| --- | --- |
| Wrong rates, recipes, optimisation or power | `ProductionSolverService`, `Formulas`, resolver helpers → worker options and breakdowns |
| Graph appearance or layout | `PlannerGraphService`, `GraphLayoutResolver`, graph settings → theme/styles and export |
| Node/edge actions, undo, re-solve loses edits | `PlannerComponent`, `PlannerActionsService`, `GraphHistoryService` → graph composer/reconciler and `PlanManager` |
| Plan navigation, reload, wrong version | `RouteList`, `PlannerLocationService`, `VersionManager` → `PlanManager` lifecycle and local backend |
| New persisted setting | Settings types/defaults/normalizers → manager, form/template, serialization/import and affected calculation/UI |
| Plan export/import | `Model/PlanFiles/` → serializers, version conversion, legacy handling |
| Game save loading | `Model/SaveFile/` → parser worker and settings mapping |
| Codex/search bug | `Components/Codex/`, `Model/Search/` → hydrated data and indexes |
| Mod/custom-version bug | Mod editor descriptors/validator and version components → API schemas, version manager and local tracking |
| Tooltip, focus, responsive panel or hotkey bug | Shared directives, planner panel layout or hotkey catalog/service → caller and template |
| Blank startup/offline/error screen | `index.html`, `main.ts`, errors/network services → worker/assets/API network responses |
| Link preview/deep-link bug | `RouteList`, `Model/Meta/`, PHP injector and `.htaccess` → external metadata contract |

Useful searches (quote glob patterns in PowerShell):

```powershell
rg --files src/app/Model/Planner
rg -n 'buildLp|parseSolution|solveMaximise' src/app/Model/Planner/ProductionSolverService.ts
rg -n 'graphDirty|manual-upgrade|manual-append' src/app
rg -n 'settingName' src/app -g '*.ts' -g '*.html'
git diff --check
git diff --stat
```

Conventions: `.editorconfig` specifies UTF-8, tabs (size 4), final newlines and single quotes in TypeScript. Many files use PascalCase names and a separate `.html` template; follow the surrounding code rather than renaming files to CLI defaults. Import aliases are `@src/*` → `src/app/*` and `@env/*` → `src/env/*`. Strict Angular templates and injection checks are enabled. Use signals/computed values for state and existing RxJS patterns for asynchronous work; keep worker request/response types synchronized. Preserve explicit public/private typing and existing domain vocabulary.

The in-app “Codex” is the game encyclopedia; it is unrelated to the coding agent. Distinguish game version IDs, URL slugs, plan IDs, share IDs and game class names in requests and explanations. Before changing an ambiguous behavior, inspect its current route/type/default rather than assuming the product term maps to a single concept.

## 9. Verification checklist by change

For executable changes, use `npm ci` and create the missing local env file before `npm run build`. CI's initial bundle budgets warn at 3.5 MB and fail at 5 MB; component style budgets warn at 5 KB and fail at 10 KB. Build success checks compilation/templates/bundling, not numerical correctness or browser behavior.

| Change | Focused verification |
| --- | --- |
| Planner/solver | A small known production target, input-limited or infeasible case, relevant objective/power/sloop option, cancellation/recalculation; compare balances and totals |
| Graph editing | Affected operation, undo/redo, re-solve in affected mode, save/reload and graph export if presentation changed |
| Storage/settings | Existing stored data with missing fields, changed default, reload, version switch and export/import where affected |
| Routing | Direct deep link, browser back/forward, switching plans/versions, legacy/shared route when affected |
| UI/panels | Desktop and narrow viewport, focus/hotkeys, docked/floating state and affected tooltip behavior |
| PHP/deployment | PHP syntax check, built deep-link fallback, metadata with API success/failure, JS/WASM asset delivery and cache behavior |
| Documentation only | Verify referenced paths/configuration, local links and `git diff --check`; no application build is needed |

Use isolated local data and explicit fixtures for browser checks. The configured production API is an external dependency: avoid changing remote records merely to validate a local UI change. Node regression coverage is available through `npm test`; browser interaction tests still need an explicitly configured browser runner.

## 10. Ownership and maintenance

Application code is MIT licensed; see [LICENSE](../LICENSE). The README states that Satisfactory game names/icons remain Coffee Stain Studios' property and are used with permission. Keep this distinction when distributing assets.

Maintain this guide alongside changes to routes, runtime dependencies, storage formats, solver loading, deployment, or account availability. Keep [README](../README.md) as the short setup entry point and this document as the detailed repository map.
