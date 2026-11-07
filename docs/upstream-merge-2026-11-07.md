# Upstream integration, 7 November 2026

Merged 13 commits from `SatisfactoryTools/SFTools` through
`eee14868a0f0f2c54e312bdbd68090c58f8429e0` ("Fixed a few small issues").
The source checkout was `C:\Users\dolyn\Documents\Repos\Satisfactory Tools\SFTools`;
its HEAD matched the upstream GitHub master branch when checked. The common
ancestor was `7f7f2080678f5afd1be99e63db2b5a9d83ee1fde` and this fork started at
`a243682529e36ce0db9606a5e09d7b33708d7776`.

## Included updates

- Fullscreen and planner world maps, resource areas, factory location viability,
  map export, and save-derived resource/collectible/player information.
- Per-machine optimisation weights and whole-machine counting.
- Node type conversion and subplan inlining.
- Recipe/search improvements, settings-error handling, layout and Firefox fixes,
  blocked browser-storage fallback, and official version-file cache revalidation.
- Upstream frontend security headers and external boot fallback script.

## Fork behavior retained

- Satisfactory mode's tier allocation, Space Elevator recipe preferences,
  custom rates, factory refinement, cancellation and automatic plan icons.
- Planner-first navigation, compact navbar, graph view and resource-use columns.
- Password-protected server plan library, revision conflicts, recovery and backups.
- Docker/Compose deployment, private deployment URL, CI/security checks, modern
  Angular build toolchain and sanitized Markdown rendering.
- Account, analytics and desktop integrations remain removed/disabled. The new
  GameManager uses the existing browser storage path without desktop dependencies.
  Imported map games/marker overrides remain browser-local; map settings attached
  to plans persist through the shared library with other plan settings.

Conflicts combined the planner/map behavior with this fork's UI and solver changes.
An automatically merged duplicate resource-usage method was replaced with the
upstream split between per-graph mining and plan-with-subplans summaries, avoiding
double counting in folder pools. Leaflet and its types were added to this fork's
dependencies; the lockfile was regenerated without restoring obsolete build tools.

The pre-existing uncommitted solver diagnostics change was saved separately during
the merge and restored afterward, remaining uncommitted.

## Validation

- Node regression suite: 60 tests passed, including new machine weighting,
  whole-machine/Satisfactory interaction, resource-pool and cache-policy cases.
- Production Angular build passed; the Home component retains its 5.95 kB style
  budget warning (5 kB warning threshold).
- `npm audit --audit-level=low`: zero vulnerabilities.
- PHP syntax, web-security tests (both cURL and stream fallback), and shared-storage
  integration tests passed using the existing local Docker image's PHP runtime.
- Production Compose configuration validated with placeholder credentials.
- Browser smoke test: planner startup, item picker/new plan with Satisfactory mode
  selected, populated map panel, and fullscreen map navigation with live game data.
  This was not exhaustive browser coverage. Development console also reported an
  Angular component-ID collision warning and one ResizeObserver notification warning.

The installed host Node version was 24.15.0, below this fork's declared security
baseline; npm reported an engine warning. Dependencies installed and checks passed.
Use the documented supported Node version for deployment. No remote branch was
pushed and no deployment was performed.
