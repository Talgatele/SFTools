# Shared plans across devices

The Docker application has one password-protected plan library for the installation.
Your browser loads it before the planner starts. Plans, folders, graphs, per-plan settings
and custom-version references are shared. Display preferences, panel layout and hotkeys
remain specific to each browser.

## Upgrade an existing home-server installation

1. Pull the updated repository on the server.
2. Edit your existing `.env`, keeping the Cloudflare tunnel token, and add a strong private
   library password of at least 12 characters:

   ```env
   SFTOOLS_PASSWORD=your-long-private-password
   ```

3. Rebuild and restart using the production file:

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

4. Open `https://satisfactory.bitstacker.dev` in the browser that currently has your plans.
   Enter the library password and wait for **Plans saved to server**.
5. Open the same site on another device and enter the same password. Your saved library
   is now available there. You do not need a separate account or username.

Every browser with existing local plans imports them once on first sign-in. Existing server
plans are preserved. If the same IDs contain different data, the browser's tree is copied
under **Imported browser plans**, with fresh IDs and its folder/subplan relationships intact.
Keep an export of important plans before upgrading. Plans saved on a different origin must
be exported there and imported into this site; browsers cannot read another origin's storage.

The password is a server setting, never embedded in the frontend build. Changing it and
recreating the app invalidates existing sessions without deleting plans. Sessions last up to
seven days, can coexist on multiple devices, and are revoked individually by **Log out**.
The external Satisfactory Tools account/login system remains disabled; this password protects
the library on your own server.

## Saving, other devices and connection failures

Edits save automatically after a short debounce. The status panel distinguishes saving,
saved, connection errors and expired sessions. Wait for **Plans saved to server** before
switching devices. A new page loads the latest server data. An already-open page checks for
newer revisions on focus and every 30 seconds, then offers **Refresh library**; it does not
discard an unfinished dialog by automatically reloading the page.

Saving includes a revision check. If another device changed the same game-version library,
the stale write is rejected. **Save my edits as a copy** preserves your edits in the current
server library rather than overwriting the other device's work. It may copy the associated
tree, including unchanged plans, to preserve references safely. Stale deletes are not applied
over another device's newer edits.

Unsaved edits are journaled in that browser and retried when the connection returns. A
reloaded browser recovers its unsaved draft and still checks for conflicts. If browser storage
is full, the app warns you: keep the page open until the server save succeeds or use
**Download backup**. A failed initial server load stops startup rather than pretending an
empty or browser-only library is the server's data. Initial sign-in requires a working server.

## Backups and persistence

The Docker named volume `sftools-data` is mounted at `/var/lib/sftools`. It contains
`library.sqlite` and SQLite's transaction files. Normal container replacement and
`docker compose down` preserve the volume. **Do not use `down --volumes` when updating**:
that removes the saved library.

**Download backup** exports all currently loaded game-version libraries and custom-version
references as JSON. **Import backup** imports that file without replacing existing plans;
conflicting trees become separate copies. Existing `.sft` per-plan/folder export and import
also remain available.

For a server-side backup including sessions, stop the sole app writer before copying all
SQLite files together, then start it again:

```bash
docker compose -f docker-compose.prod.yml stop sftools
docker compose -f docker-compose.prod.yml cp sftools:/var/lib/sftools ./backups/sftools-data
docker compose -f docker-compose.prod.yml start sftools
```

Create the `backups` directory first, choose a fresh destination for each backup, and protect
its contents. That directory is excluded from Git and Docker builds. Copying only the main
SQLite file while the application is running can omit committed WAL transactions.

## Runtime and development

`server-storage.php` exposes same-origin session/login/logout/data/revision endpoints. Private
data requires an opaque HttpOnly, SameSite Strict cookie (Secure and host-only on HTTPS).
Writes additionally require the exact configured origin and a session CSRF token. Password
guessing is rate limited. SQLite transactions enforce optimistic revisions, including deleted
document tombstones. The database lives outside the public web root with private permissions.
Save request bodies are limited to 16 MiB; split very large game-version libraries if needed.

Production Compose fixes `SFTOOLS_ORIGIN` to `https://satisfactory.bitstacker.dev`. Local Docker
defaults to `http://localhost:8080`; update `SFTOOLS_ORIGIN` along with `SFTOOLS_PORT` when using
another port. HTTP origins are allowed only on loopback hosts. The plain `npm start` dev server
has no PHP API and explicitly uses browser-only storage; use Docker to test shared persistence.

Validation: `npm test` includes shared-storage client regressions. Run
`php tests/shared-storage.php` for HTTP tests of separate device sessions, CSRF/origin checks,
stale writes/deletes, persistence, logout, password rotation and rate limiting.
