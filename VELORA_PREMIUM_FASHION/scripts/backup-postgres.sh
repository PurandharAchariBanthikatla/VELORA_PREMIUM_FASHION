#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${S3_BACKUP_BUCKET:?S3_BACKUP_BUCKET is required}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="/tmp/velora-${STAMP}.dump"
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > "$FILE"
aws s3 cp "$FILE" "s3://${S3_BACKUP_BUCKET}/postgres/${STAMP}.dump" --storage-class STANDARD_IA
rm -f "$FILE"
