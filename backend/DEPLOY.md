# Deploying the API (Lurkhuset)

Production runs on the Proxmox host as `/opt/stacks/strong-notes-api`, following
the same conventions as the other stacks there:

- **Image**: `ghcr.io/dowlucas/strong-notes-backend:latest`, built and pushed by
  `.github/workflows/backend-image.yml` on every push to `main` that touches
  `backend/`. Nothing is built on the server.
- **Auto-deploy**: the backend container carries
  `com.centurylinklabs.watchtower.enable=true`; the host's Watchtower polls GHCR
  every 5 minutes and restarts the container on a new `latest`. Rolling out =
  merge to `main`, wait ≤ 5 min.
- **Compose**: `backend/deploy/docker-compose.yml` (copy of what lives in
  `/opt/stacks/strong-notes-api/docker-compose.yml`). Postgres 16 with its data
  bind-mounted on the ZFS dataset `/tank/apps/strong-notes/pgdata`; the API joins
  the external `caddy-net` bridge.
- **Ingress**: Caddy block `strong-notes-api.lurkhuset.com → strong-notes-backend:8080`
  (TLS via DNS-01), and a proxied Cloudflare CNAME to the existing tunnel so the
  API is reachable publicly (TestFlight testers are not on the tailnet).
- **Secrets**: `/opt/stacks/strong-notes-api/.env` (mode 600, never committed).

Migrations run automatically on backend startup (`runMigrations` in `cmd/api/main.go`).

## First-time provisioning (already done — kept for reference)

```bash
ssh proxmox
sudo zfs create tank/apps/strong-notes && sudo zfs create tank/apps/strong-notes/pgdata
sudo chown -R 999:999 /tank/apps/strong-notes/pgdata          # postgres image runs as 999
sudo mkdir -p /opt/stacks/strong-notes-api
# copy backend/deploy/docker-compose.yml there, create .env (see below)
cd /opt/stacks/strong-notes-api && sudo docker compose up -d
# Caddy: append the block to /opt/stacks/caddy/Caddyfile, then
sudo docker exec caddy-caddy-1 caddy reload --config /etc/caddy/Caddyfile
# Cloudflare: proxied CNAME strong-notes-api → <tunnel-id>.cfargotunnel.com
curl -fsS https://strong-notes-api.lurkhuset.com/api/health/liveness
```

Then add an Uptime Kuma HTTP monitor for that URL (https://uptime.lurkhuset.com).

### `.env` — set at minimum

- `INSTANCE_MODE=selfhost`, `BASE_URL=https://strong-notes-api.lurkhuset.com`, `DEV_MODE=false`
- `POSTGRES_PASSWORD=<random>` — compose derives `DATABASE_URL` from it
- `JWT_SECRET=<32+ random chars>`
- `LLM_PROVIDER=gemini`, `GEMINI_API_KEY=<key>` (`GEMINI_MODEL` optional)
- `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` — magic-link email
  (`DEV_MODE=false` requires a real transport)
- `APPLE_BUNDLE_ID=com.dowlucas.strongnotes` — enables `POST /api/auth/apple/native`
- `DEMO_LOGIN_EMAILS=<your email>` — inline magic-link token for these addresses
- Leave `S3_ENDPOINT=` empty and `JOBS_ENABLED=false` (features out of scope)

## Day-2 operations

```bash
# status / logs
cd /opt/stacks/strong-notes-api && sudo docker compose ps && sudo docker logs -f strong-notes-backend
# force an update without waiting for Watchtower
sudo docker compose pull && sudo docker compose up -d
# Postgres shell
sudo docker exec -it strong-notes-postgres psql -U strongnotes -d strongnotes
```

Backups: `/tank/apps/strong-notes` is a ZFS dataset — cover it with the same
snapshot/backup policy as the other `tank/apps/*` datasets.

## Local development

`docker compose --env-file .env.local up -d --build` in `backend/` still runs a
self-contained dev stack (see `docker-compose.yml`; this machine's
`docker-compose.override.yml` moves Postgres to 5433).
