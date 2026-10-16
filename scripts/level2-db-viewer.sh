#!/usr/bin/env bash
# Level 2 — a browser UI for looking at the database.
#
# Adminer in a container: nothing is installed on the machine, and stopping it
# leaves no trace. It can open both the local mirror and the live Supabase
# database; the mirror is the safe one to browse, because a stray edit there
# cannot reach anything the application reads.
set -euo pipefail
export PATH="$HOME/.docker/bin:$PATH"

NAME=openmaic-db-viewer
PORT="${PORT:-8080}"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Open Docker Desktop, then run this again."
  echo "Without it you can still read the mirror with:  psql -U postgres -d openmaic_mirror"
  exit 1
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "${PORT}:8080" \
  -e ADMINER_DEFAULT_SERVER=host.docker.internal \
  adminer:latest >/dev/null

echo "Database viewer running:  http://localhost:${PORT}"
echo
echo "  Live database (Supabase) - what the application reads and writes."
echo "  Use the POOLER host: the direct db.<ref>.supabase.co name resolves only"
echo "  over IPv6 and a container cannot reach it."
echo "    System    PostgreSQL"
echo "    Server    aws-0-us-east-1.pooler.supabase.com:5432"
echo "    Username  postgres.elajhcoyeqdlhznijvuq"
echo "    Password  see POSTGRES_PASSWORD in .env.level2"
echo "    Database  postgres"
echo
echo "  Local mirror - read it with psql. Adminer refuses this machine's"
echo "  PostgreSQL because it trusts any password over TCP:"
echo "    psql -U postgres -d openmaic_mirror"
echo
echo "  Stop the viewer with:  docker rm -f ${NAME}"
