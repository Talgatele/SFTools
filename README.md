# Satisfactory Tools

New generation of [Satisfactory Tools](https://www.satisfactorytools.com/) - a production planner and toolset for the game Satisfactory.

Built with Angular (standalone components), Bootstrap 5 + ngx-bootstrap, AntV X6 for the interactive planner graph, and the HiGHS LP solver for production calculations.

## Requirements

- Node v20.19+ (or v22.12+)
- npm

## Installation

```bash
npm install
```

Then create your local environment file (it is gitignored; CI generates it from the production one):

```bash
cp src/env/env.prod.ts src/env/env.ts
```

Adjust `apiUrl` in `src/env/env.ts` if you want to point at a different backend.

## Development

```bash
npm start
```

Then visit `http://localhost:4200/`. The app reloads automatically on source changes.

Other useful scripts:

```bash
npm run watch   # Development build in watch mode (no dev server)
```

## Build

```bash
npm run build
```

The production build is emitted to the `dist/` folder. It uses `src/env/env.prod.ts` via build-time file replacement.

## Docker

Build and run the production web app with Docker Compose:

```bash
docker compose up --build
```

Then visit `http://localhost:8080/`. See [docs/docker.md](docs/docker.md) for Docker CLI usage and deployment details.

## Desktop app

A Tauri wrapper around the same bundle, released on every push to master.
Installers are published next to the API; the app updates itself from there.

### Code signing

Windows installers are built by GitHub Actions from this repository
(`.github/workflows/ci.yml`) and signed with a Certum code signing certificate. macOS
builds are ad-hoc signed and not notarized, so macOS asks for "Open Anyway" in
System Settings → Privacy & Security on first launch.

### Privacy

This local-only build has no sign-in, account sync, or analytics. Plans and
settings are stored on this device. The app still connects to the configured
API to load game data and public versions, create shared links, and check
desktop-app updates.

## License

[MIT](LICENSE). Satisfactory is made by Coffee Stain Studios; game icons and
names are used with their permission and remain their property.
