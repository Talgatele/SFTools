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
