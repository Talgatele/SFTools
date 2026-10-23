# Docker

The container builds the Angular frontend and serves the production bundle through Apache/PHP.
The PHP layer supplies route-specific metadata for link previews; all other application routes
fall back to the Angular app. The frontend uses the production API configured in
`src/env/env.prod.ts`. This build has no sign-in, account sync, or analytics; plans and settings
stay in the local browser storage. Public game data, mod listings, and shared links still use the
configured API.

## Prerequisites

- Docker Engine or Docker Desktop
- Docker Compose

## Run with Docker Compose

From the repository root:

```bash
docker compose up --build
```

Open <http://localhost:8080/>. Stop the container with:

```bash
docker compose down
```

If port 8080 is already in use, set `SFTOOLS_PORT` to another host port before starting Compose.

## Home server: Caddy + Cloudflare Tunnel

The standalone `docker-compose.prod.yml` follows the other home-server projects:

```text
https://satisfactory.bitstacker.net -> Cloudflare -> cloudflared -> Caddy:80 -> sftools:80
```

Each app has its own Caddy and remotely managed tunnel. All three containers share
the stack's private Docker network. No host ports are published, so this stack can
run alongside the other apps without port conflicts. Cloudflare terminates public
HTTPS; Caddy uses HTTP inside Docker and preserves the public Host header. See
[Caddy's proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

### First deployment

1. Put this repository on the home server and change into its directory.
2. In the [Cloudflare dashboard](https://developers.cloudflare.com/tunnel/get-started/),
   create a remotely managed Cloudflare Tunnel for this app (for example, `satisfactory`).
   Copy the tunnel token from its Docker installation instructions.
3. Copy `.env.example` to `.env` and fill in `CLOUDFLARE_TUNNEL_TOKEN`:

   ```bash
   cp .env.example .env
   nano .env
   chmod 600 .env
   ```

   `.env` is excluded from Git and Docker's build context. Keep it on the server;
   do not commit the token.
4. Add a published application route (called **Public Hostname** in some dashboard
   versions) to that tunnel:

   | Setting | Value |
   | --- | --- |
   | Public hostname | `satisfactory.bitstacker.net` |
   | Service type | HTTP |
   | Service URL | `http://caddy:80` (or `caddy:80` in the separate URL field) |
   | HTTP Host Header | Leave unset to preserve the public hostname |

   Use `caddy`, not `localhost`: cloudflared runs in its own container. The dashboard
   creates the tunnel's DNS record; replace any conflicting record for this hostname.
   See [Cloudflare routing](https://developers.cloudflare.com/tunnel/concepts/routing/).
5. Build and start the production stack:

   ```bash
   docker compose -f docker-compose.prod.yml config --quiet
   docker compose -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.prod.yml ps
   docker compose -f docker-compose.prod.yml logs --tail=100 cloudflared
   ```

   Use this production file **on its own**; combining it with the local Compose file
   would also publish the development port. The token is required for production
   commands and missing values fail immediately. Caddy waits for the app's health
   check; cloudflared waits for Caddy's proxy health check.
6. Open `https://satisfactory.bitstacker.net`. Reload a deep link such as `/help`
   and confirm the planner loads game data. Check the HTML through the complete route:

   ```bash
   curl -fsS https://satisfactory.bitstacker.net/help | grep 'og:url'
   ```

   The URL should use `https://satisfactory.bitstacker.net/help`.

No router port forwarding or Caddy public certificate setup is required. The server
must be able to make outbound tunnel connections to Cloudflare. If the tunnel is
healthy but the site returns 404, check that the hostname and any Host override match
`Caddyfile`. For 502 errors, check `docker compose -f docker-compose.prod.yml logs
--tail=100 sftools caddy cloudflared` and container health in `ps`.

The production frontend URL and link-preview allowlist use `satisfactory.bitstacker.net`.
The external game-data API remains `https://api.new.satisfactorytools.com`; this stack
does not include that backend. Its versions endpoint returned `Access-Control-Allow-Origin: *`
when checked with the new origin on 23 October 2026. Plans stored on another domain must be exported and imported on the new
domain because browser storage is scoped to the origin.

### Updates and stopping

After pulling the desired repository changes, rebuild and recreate:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

To refresh the Caddy and cloudflared images as well, run
`docker compose -f docker-compose.prod.yml pull caddy cloudflared` before that command.
To stop the stack, run `docker compose -f docker-compose.prod.yml down`.
The application needs no server-side data volume; plans and settings live in users'
browsers. Caddy's state has named volumes and the tunnel configuration lives in Cloudflare.

## Memory and concurrency

Calculations and graph rendering run in the user's browser, including the HiGHS WebAssembly
worker. The running container serves files and the PHP metadata front controller; it does not
run Node or the calculation engine.

The image starts five Apache workers, retains five to ten spare workers, and allows up to 64
concurrent workers. Workers recycle after 10,000 connections, and idle keep-alive connections
expire after two seconds. Requests beyond that concurrency wait for capacity. Adjust
`docker/apache.conf` for a busier deployment and rebuild the image.

The existing PHP OPcache is limited to 16 MiB with a 1 MiB interned-string buffer, enough for
the single front controller. These are cache budgets, not measurements of resident memory.
Timestamp checks are disabled because deployed PHP files change only with an image rebuild.
If you mount edited PHP files into a development container, enable timestamp checks or restart
the container after changes.

JavaScript (both `text/javascript` and `application/javascript`) and WebAssembly responses
support gzip through Apache DEFLATE. Hashed JavaScript/CSS assets retain immutable caching.

Angular builds default to two parallel workers to reduce build-time memory pressure. This
does not change runtime concurrency. On a larger build host you can use:

```bash
docker build --build-arg NG_BUILD_MAX_WORKERS=4 -t sftools:local .
```

Build memory requirements are substantially higher than serving memory requirements. For a
runtime smoke test with a limit, use `docker run --rm --memory 256m -p 8080:80 sftools:local`;
size production limits against your actual concurrent workload.

## Run with Docker CLI

```bash
docker build -t sftools:local .
docker run --rm -p 8080:80 sftools:local
```
