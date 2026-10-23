# Codebase and security review — 23 October 2026

## Scope

**Shared-library follow-up:** the installation now also contains a private SQLite plan
library and independent password/session API. See [shared-library documentation](shared-library.md)
for its authentication, storage, migration and deployment requirements. Its regression tests
cover cross-device access, CSRF/origin enforcement, stale writes/deletes, session rotation,
browser-draft recovery and server persistence. References below to browser-only plans
describe the earlier review state, before this feature was added. Image scan results are
the dated snapshots recorded in that review, not a scan of every later application build.

Reviewed the application entry points and route graph, dependency lockfile,
Markdown-to-DOM boundary, plan and save-file imports, local storage and share
hydration, HTTP interceptors and error reporting, PHP metadata front controller,
Docker/Caddy/Tunnel configuration, and GitHub Actions. Static import tracing includes
dynamic worker entry points; Angular's production build checks templates and types.
This is a repository review with automated regression checks, not a penetration test
of the home server, Cloudflare account or external game-data API.

## Findings addressed

| Finding | Change |
| --- | --- |
| Locked packages had 45 npm advisories: 4 critical, 26 high, 12 moderate, 3 low | Updated Angular to 22.2.3 and its build/CLI to 22.2.4, refreshed vulnerable transitive packages, and removed the unused webpack toolchain. Some original findings affected development/SSR tooling rather than this browser-only deployment. |
| Angular's build package pins a vulnerable Vite release | Override Vite to the patched 8.3.5 line. Review/remove this override when upgrading the builder to a version with a patched dependency. |
| Peer checks were disabled and ngx-bootstrap required Angular 21 | Upgraded ngx-bootstrap to 22 and removed `legacy-peer-deps`. Normal dependency resolution now succeeds. |
| Help HTML bypassed Angular sanitization based solely on a custom renderer | Added DOMPurify after Markdown rendering, preserving the required SVG icons and data attributes. Tests cover script URLs, raw HTML, attribute injection and unsafe resolver output. Also fixed protocol-relative link classification and malformed email URL handling. |
| `.sft` decompression could allocate unbounded output | Limit encoded files to 32 MiB of characters and expanded data to 64 MiB of bytes, cancel oversized decompression streams, and apply matching export limits. Both current and legacy formats remain supported. |
| Gateway errors were assumed to mean a write had not reached the API | Retry only GET, HEAD and OPTIONS. POST/PUT/PATCH/DELETE are never automatically replayed after a gateway failure. |
| PHP metadata fetches followed redirects in the stream fallback and had no response-size limit | Disable redirects in both transports, cap responses at 64 KiB, retain short timeouts, and fall back to local metadata on errors. Tests exercise escaping, Host allowlisting and canonical URL filtering. |
| Production responses disclosed unnecessary runtime information and lacked basic browser policies | Disable PHP exposure/error display, hide detailed Apache version signatures, disable TRACE, and add MIME-sniffing, framing, referrer, permissions and restricted base/object/form policies. The CSP does not restrict script sources; it is not a complete XSS defense. |
| Production containers could acquire new privileges | Set `no-new-privileges` on all production services and make cloudflared's filesystem read-only. Existing private networking and token exclusions remain. |
| PHP's base image retained extension-build compilers, development headers and CLI curl | Remove these unused packages from the runtime and apply available Debian updates during the image build. Node remains confined to the build stage. |
| CI contained an obsolete SSH deployment to the upstream Satisfactory Tools site | Removed that deployment. CI now has read-only repository permissions, pinned actions, regression tests, dependency auditing and Compose validation. Added weekly Dependabot checks. |

## Dead-code removal

- Removed unused webpack configuration/stubs, custom-webpack, build-angular,
  direct webpack, platform-browser-dynamic, and the unused AntV layout dependency.
  The active builder is now declared directly as `@angular/build`.
- Removed unused login/logout/return-URL services and token/profile schemas.
- Removed the remote help editor, its API, permission guard and editor-only topic
  coverage types. Accounts were already disabled, so this UI was inaccessible.
  Existing editor URLs still redirect home.
- Removed the unreferenced production-target component/template, obsolete hydrated
  entity types, file-opening service and unused conflict resolver.
- Removed verified unused imports and unnecessary stored constructor properties.
  Angular query setters and services injected for startup effects are retained.

The lockfile decreased from 1,017 to 464 package entries, including platform-specific
optional packages. Static tracing finds no orphan TypeScript application files
after these removals. Dynamic solver/save workers and legacy import/conversion
paths are retained.

## Remaining container-image advisories

Trivy scanned the rebuilt runtime and freshly pulled proxy/tunnel images on
23 October 2026. These are package findings, not confirmed exploitable application
paths. Duplicate CVEs can appear against multiple binary packages.

| Image | Critical findings | High findings | Findings with a published package fix |
| --- | ---: | ---: | ---: |
| Rebuilt PHP/Apache runtime | 2 | 56 | 0 |
| Official Caddy 2.11.7 (`caddy:2-alpine`) | 0 | 5 | 5 |
| Official cloudflared 2026.10.3 (`cloudflare/cloudflared:latest`) | 0 | 1 | 1 |

The PHP image initially had 127 high/critical package findings; removing compiler
packages and development headers reduced that to 58 across 19 distinct CVEs.
Available Debian updates were applied. The two remaining critical scanner findings
are [Brotli CVE-2026-111497](https://security-tracker.debian.org/tracker/CVE-2026-111497)
and [libxml2 CVE-2026-6653](https://security-tracker.debian.org/tracker/CVE-2026-6653).
Debian currently has no fixed package for this release; Debian classifies the latter
as a minor issue with no DSA planned. The front controller processes JSON, but that
alone does not establish the reachability of every vulnerable routine in the image.

The latest official Caddy image still includes affected Go standard-library and
`golang.org/x/net` versions. The latest official tunnel image still includes affected
`github.com/klauspost/compress` v1.18.0 (fixed in v1.18.7). Updated vendor images with
patched compiled dependencies are needed for these findings. These remain open;
the deployment cannot be described as free of known container vulnerabilities.

See [machine-readable image scan summary](security-image-scan.json) for CVEs,
installed/fixed versions, image identifiers and scan timestamps. Follow vendor
image/package releases and rescan after updating. Docker Scout required a login in
this environment, so the image checks used Trivy instead.

## Validation and maintenance

```bash
npm ci
npm audit
npm test
npm run build
php -l deploy/web/index.php
php tests/web-security.php
php -d disable_functions=curl_init tests/web-security.php
```

Use Node 24.22.1+ on the Node 24 line or another range allowed by `package.json`.
The local Windows Node installation was 24.14.0 at review time and should be updated;
Docker/CI use the supported Node 24 image/runtime.

The Node engine ranges require the
[21 October security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
or newer on their supported lines. The Docker build/test runtime was Node 24.22.1.

The review's full Node suite contains 35 tests, including 10 security regressions.
`npm audit` reports zero known vulnerabilities for both the complete lockfile and
production dependencies as of the review date. This result is time-sensitive;
CI audits future installs and Dependabot proposes updates.

Verification also passed a clean Docker production build, normal peer-dependency
resolution, both PHP metadata transport test runs, production Compose health checks,
and HTTP checks through Caddy for deep links, public metadata, security headers,
blocked dotfiles/unrecognized hosts, gzip integrity and JavaScript/WASM MIME delivery.

Rebuild deployed images with current base images when applying updates:

```bash
docker compose -f docker-compose.prod.yml build --pull --no-cache
docker compose -f docker-compose.prod.yml pull caddy cloudflared
docker compose -f docker-compose.prod.yml up -d
```

Cloudflare TLS, DNS, tunnel token lifecycle and any Access policies remain server/account
configuration. Nothing in this review changes the live deployment. The upstream API,
its authorization/CORS rules and its availability are outside this repository. Shared
links can intentionally expose the selected plans to anyone with the link; local plans
remain scoped to the browser origin. Back up plans through export before moving origins.

The existing Home component stylesheet exceeds its warning budget by 946 bytes;
it remains below the build's error budget.

## Primary references

- [Angular sanitization advisory](https://github.com/angular/angular/security/advisories/GHSA-hh8m-fm6v-7cvg)
- [Angular router SSR advisory](https://github.com/angular/angular/security/advisories/GHSA-ff3f-86qr-9cv3)
- [Marked security guidance](https://marked.js.org/#usage)
- [DOMPurify](https://github.com/cure53/DOMPurify)
