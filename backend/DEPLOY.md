# Deploying strong-notes-api to Proxmox

Following the standard "add a new Docker service" recipe:

1. `ssh proxmox`
2. `sudo zfs create tank/apps/strong-notes` then `sudo chown -R 999:999 /tank/apps/strong-notes` (postgres UID)
3. `mkdir -p /opt/stacks/strong-notes-api` and copy this directory's `docker-compose.yml`, `Dockerfile`, and source there (or `git clone` this repo on the host)
4. Create `/opt/stacks/strong-notes-api/.env` with `POSTGRES_PASSWORD`, `API_TOKEN` (long random value), `ANTHROPIC_API_KEY`
5. `cd /opt/stacks/strong-notes-api && sudo docker compose up -d --build`
6. Run migrations once: `sudo docker compose exec api npx prisma migrate deploy`
7. Run the seed once: `sudo docker compose exec api npm run prisma:seed`
8. Append to `/opt/stacks/caddy/Caddyfile`:
   ```
   strong-notes-api.lurkhuset.com {
       reverse_proxy api:3000
   }
   ```
9. `sudo docker exec caddy-caddy-1 caddy reload --config /etc/caddy/Caddyfile`
10. Verify: `curl -fsS https://strong-notes-api.lurkhuset.com/health` returns `{"status":"ok"}`
11. Add an Uptime Kuma HTTP monitor for `https://strong-notes-api.lurkhuset.com/health`.

This stack is public via the existing Cloudflare Tunnel wildcard ingress, so no tunnel config change is needed.
