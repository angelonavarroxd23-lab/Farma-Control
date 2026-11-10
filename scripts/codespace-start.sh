#!/usr/bin/env bash
# Arranque en GitHub Codespaces (o cualquier Linux con Docker):
#   1) genera un .env local con contraseñas aleatorias (nunca se sube: .gitignore),
#   2) inicia SQL Server 2022 en un contenedor,
#   3) crea/verifica la base con database/FarmaControl_Database.sql,
#   4) inicia FarmaControl conectado a SQL Server en el puerto 3000.
# Uso: bash scripts/codespace-start.sh          (FC_NO_START=1 para solo preparar la base)
set -euo pipefail
cd "$(dirname "$0")/.."
CONT=farmacontrol-sql
IMG=mcr.microsoft.com/mssql/server:2022-latest

if [ ! -f .env ]; then
  SA="Fc1!$(openssl rand -hex 12)"
  JWT="$(openssl rand -hex 48)"
  cat > .env <<ENV
PORT=3000
DB_DRIVER=mssql
DB_AUTH=sql
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=FarmaControlBD
DB_USER=sa
DB_PASSWORD=$SA
DB_ENCRYPT=true
DB_TRUST_SERVER_CERT=true
JWT_SECRET=$JWT
TOKEN_TTL_MINUTES=480
SERVE_FRONTEND=true
CORS_ORIGIN=
ENV
  echo "[FarmaControl] .env generado con contraseñas aleatorias (solo en este entorno)."
fi
SA="$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)"

if [ -n "$(docker ps -q -f name=^${CONT}$)" ]; then
  echo "[FarmaControl] SQL Server ya está en ejecución."
elif [ -n "$(docker ps -aq -f name=^${CONT}$)" ]; then
  docker start "$CONT" >/dev/null
else
  echo "[FarmaControl] Iniciando SQL Server 2022 (la primera vez descarga la imagen, ~2 min)..."
  docker run -d --name "$CONT" -p 1433:1433 -e ACCEPT_EULA=Y -e "MSSQL_SA_PASSWORD=$SA" "$IMG" >/dev/null
fi

echo -n "[FarmaControl] Esperando a SQL Server"
for i in $(seq 1 60); do
  if docker exec "$CONT" /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$SA" -Q "SELECT 1" >/dev/null 2>&1; then echo " listo."; break; fi
  echo -n "."; sleep 3
  if [ "$i" = 60 ]; then echo; echo "SQL Server no respondió. Últimas líneas del registro:"; docker logs "$CONT" | tail -20; exit 1; fi
done

[ -d node_modules ] || npm install --no-audit --no-fund
npm run db:setup
npm run db:check

if [ "${FC_NO_START:-0}" = 1 ]; then exit 0; fi
if (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then
  echo "[FarmaControl] Ya hay un servidor en el puerto 3000. Abra la pestaña PORTS para ver el enlace."; exit 0
fi
echo "[FarmaControl] Iniciando la aplicación. Abra la pestaña PORTS → puerto 3000 para obtener el enlace."
exec npm start
