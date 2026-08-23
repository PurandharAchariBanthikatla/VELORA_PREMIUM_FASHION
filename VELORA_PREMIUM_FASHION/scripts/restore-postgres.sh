#!/usr/bin/env bash
# Disaster-recovery restore: pulls a backup made by backup-postgres.sh and
# restores it into a target database. Intended usage is restoring into a
# FRESH, empty database — pg_restore --clean --if-exists will still drop
# conflicting objects first if the target isn't empty, but a fresh target
# is the safer, standard DR drill.
#
# Usage:
#   ./scripts/restore-postgres.sh s3://bucket/postgres/20260101T000000Z.dump postgresql://user:pass@host:5432/velorastore_restored
#   ./scripts/restore-postgres.sh /local/path/to/backup.dump postgresql://user:pass@host:5432/velorastore_restored
set -euo pipefail
: "${1:?Usage: restore-postgres.sh <s3://bucket/key.dump | /local/path.dump> <target DATABASE_URL>}"
: "${2:?Usage: restore-postgres.sh <s3://bucket/key.dump | /local/path.dump> <target DATABASE_URL>}"

SOURCE="$1"
TARGET_DATABASE_URL="$2"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOCAL_FILE="/tmp/velora-restore-${STAMP}.dump"

if [[ "$SOURCE" == s3://* ]]; then
  echo "Downloading backup from ${SOURCE}..."
  aws s3 cp "$SOURCE" "$LOCAL_FILE"
else
  LOCAL_FILE="$SOURCE"
fi

echo "Restoring into ${TARGET_DATABASE_URL%%@*}@... (credentials redacted)"
pg_restore --clean --if-exists --no-owner --no-acl --dbname "$TARGET_DATABASE_URL" "$LOCAL_FILE"

echo "Verifying restored schema..."
psql "$TARGET_DATABASE_URL" -c "\dt" 
ROW_COUNTS=$(psql "$TARGET_DATABASE_URL" -t -c "
  SELECT 'users: ' || (SELECT count(*) FROM users)
    || ', products: ' || (SELECT count(*) FROM products)
    || ', orders: ' || (SELECT count(*) FROM orders);
")
echo "Restored row counts —$ROW_COUNTS"

if [[ "$SOURCE" == s3://* ]]; then
  rm -f "$LOCAL_FILE"
fi

echo "Restore complete."
