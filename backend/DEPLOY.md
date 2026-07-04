# Deploying to Proxmox

This deploys the self-contained stack from `docker-compose.yml` (backend +
Postgres, both on the host network). S3 storage and River background jobs
stay disabled per the project's constraints — `S3_ENDPOINT` and
`JOBS_ENABLED` are left unset/false, so there's nothing to provision for them.

1. `ssh proxmox`
2. `sudo zfs create tank/apps/strong-notes` then `sudo chown -R 999:999 /tank/apps/strong-notes` (the official `postgres` image runs as UID 999)
3. `mkdir -p /opt/stacks/strong-notes-api`, copy this repo's `backend/` there (or `git clone`)
4. Create `/opt/stacks/strong-notes-api/.env.local` (copy `.env.example` as a starting point) and set at minimum:
   - `DATABASE_URL=postgres://strongnotes:<same-password-as-below>@localhost:5432/strongnotes?sslmode=disable` (the `postgres` service listens on the default port 5432 via `network_mode: host`)
   - `POSTGRES_PASSWORD=<random>` (consumed by `docker-compose.yml`, must match the password embedded in `DATABASE_URL` above)
   - `POSTGRES_DATA_DIR=/tank/apps/strong-notes/pgdata` (bind-mounts Postgres's data dir onto the ZFS dataset from step 2 instead of an anonymous Docker volume, so `docker compose down -v` can't wipe it and it's covered by normal ZFS backup/snapshot policy)
   - `JWT_SECRET=<32+ random chars>`
   - `DEV_MODE=false`
   - `DEMO_LOGIN_EMAILS=<your real email>` (lets you sign in via inline magic-link token before real email delivery is confirmed working)
   - `LLM_PROVIDER=anthropic`
   - `ANTHROPIC_API_KEY=<key>`
   - Leave `S3_ENDPOINT=` and `JOBS_ENABLED=false` as shipped — both features are out of scope for this deploy.
5. `cd /opt/stacks/strong-notes-api && sudo docker compose --env-file .env.local up -d --build`

   The `--env-file` flag is required here: `env_file: .env.local` in
   `docker-compose.yml` only injects vars into the *backend container's*
   runtime environment, but `${POSTGRES_PASSWORD}` / `${POSTGRES_DATA_DIR}`
   are substituted into the compose file itself at parse time, which Compose
   only does from the shell environment or an explicit `--env-file` — never
   from a service's `env_file:`. Omitting the flag silently defaults
   `POSTGRES_PASSWORD` to an empty string and `POSTGRES_DATA_DIR` to
   `./.pgdata`.
6. Migrations run automatically on backend startup (`runMigrations` in `cmd/api/main.go`) — no manual migration step needed.
7. Append to `/opt/stacks/caddy/Caddyfile`:
   ```
   strong-notes-api.lurkhuset.com {
       reverse_proxy localhost:8080
   }
   ```
8. `sudo docker exec caddy-caddy-1 caddy reload --config /etc/caddy/Caddyfile`
9. Verify: `curl -fsS https://strong-notes-api.lurkhuset.com/api/health/liveness`
10. Add an Uptime Kuma monitor for that URL.

## Notes

- Since `DEV_MODE=false` here, magic-link sign-in requires `RESEND_API_KEY` or
  `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` to be set too — add whichever
  email delivery method you choose alongside the vars above. `DEMO_LOGIN_EMAILS`
  only affects mode-agnostic inline-token delivery for the listed addresses; it
  doesn't replace real email config for everyone else.
- Both containers run with `network_mode: host`, so `docker compose` port
  mappings don't apply — the backend binds directly to `:8080` (from `ADDR`)
  and Postgres to its default `:5432` on the host's loopback/network
  interfaces. Make sure nothing else on the box already owns those ports.
- Postgres data lives at `POSTGRES_DATA_DIR` (`/tank/apps/strong-notes/pgdata`
  in this deploy), bind-mounted into the `postgres` service, so it survives
  `docker compose down` / container recreation and isn't at risk from a
  stray `-v` flag. Back that path up like any other stateful ZFS dataset.
  If `POSTGRES_DATA_DIR` is unset, Compose falls back to `./.pgdata` next to
  the compose file — fine for a laptop, not for this deploy.
- To roll out a new version: `git pull && sudo docker compose --env-file .env.local up -d --build`.
  The backend's healthcheck (`/api/health/liveness`) gates Compose's own
  `service_healthy` semantics if you chain this stack behind another that
  depends on it.
