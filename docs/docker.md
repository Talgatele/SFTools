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

## Run with Docker CLI

```bash
docker build -t sftools:local .
docker run --rm -p 8080:80 sftools:local
```
