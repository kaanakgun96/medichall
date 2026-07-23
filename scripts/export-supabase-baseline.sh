#!/usr/bin/env bash

set -euo pipefail
umask 077

output_dir="${1:-supabase/baseline/live}"

if [[ -z "${output_dir}" || "${output_dir}" == "/" || "${output_dir}" == "." ]]; then
  echo "Refusing unsafe output directory: ${output_dir}" >&2
  exit 1
fi

required_commands=(git jq pg_dump psql shasum supabase)
for required_command in "${required_commands[@]}"; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required command: ${required_command}" >&2
    exit 1
  fi
done

: "${SUPABASE_PROJECT_REF:?Set SUPABASE_PROJECT_REF without committing it.}"
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN without committing it.}"
: "${SUPABASE_DB_URL:?Set the read-only or owner database connection URL without committing it.}"

mkdir -p "${output_dir}"

repo_commit="$(git rev-parse HEAD)"
captured_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

pg_dump "${SUPABASE_DB_URL}" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=storage \
  > "${output_dir}/database-schema.sql"

psql "${SUPABASE_DB_URL}" \
  -X \
  -v ON_ERROR_STOP=1 \
  --csv \
  -f scripts/sql/supabase-baseline-structural.sql \
  > "${output_dir}/database-structural-inventory.csv"

supabase functions list \
  --project-ref "${SUPABASE_PROJECT_REF}" \
  --output json \
  | jq 'map({
      id,
      slug,
      name,
      version,
      status,
      verify_jwt,
      created_at,
      updated_at
    })' \
  > "${output_dir}/edge-functions.json"

jq -n \
  --arg captured_at "${captured_at}" \
  --arg repository_commit "${repo_commit}" \
  --arg project_ref_sha256 "$(printf '%s' "${SUPABASE_PROJECT_REF}" | shasum -a 256 | awk '{print $1}')" \
  '{
    captured_at: $captured_at,
    repository_commit: $repository_commit,
    project_ref_sha256: $project_ref_sha256,
    scope: "structural metadata only",
    customer_data_exported: false,
    secrets_exported: false
  }' \
  > "${output_dir}/capture-metadata.json"

(
  cd "${output_dir}"
  shasum -a 256 \
    database-schema.sql \
    database-structural-inventory.csv \
    edge-functions.json \
    capture-metadata.json \
    > SHA256SUMS
)

echo "Sanitized Supabase baseline written to ${output_dir}"
echo "Review every artifact before sharing it. The directory is ignored by Git."
