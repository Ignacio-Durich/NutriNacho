#!/usr/bin/env bash
# Fails if a tracked file looks like it contains a real credential.
# Patterns only; matches are never printed (only file names), so CI logs stay clean.
set -u

patterns=(
  'AIza[0-9A-Za-z_-]{35}'                       # Google / Gemini API key
  '[0-9]{8,10}:[A-Za-z0-9_-]{35}'               # Telegram bot token
  'sb_secret_[A-Za-z0-9_-]{10,}'                # Supabase secret key
  'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'  # JWT (anon / service_role keys)
  '[A-Za-z0-9-]+\.netlify\.app'                 # personal Netlify URL
  '(?<![A-Za-z0-9-])(?!(example-project|example|your-project-ref)\.supabase)[A-Za-z0-9-]+\.supabase\.co'  # real Supabase project URL
  'ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}'  # GitHub tokens
)

status=0
for p in "${patterns[@]}"; do
  files=$(git grep -lIP -e "$p" -- . ':!.github/scripts/check_secrets.sh' || true)
  if [ -n "$files" ]; then
    echo "::error::Possible secret found (pattern: ${p%%[ ]*}) in:"
    echo "$files" | sed 's/^/  - /'
    status=1
  fi
done

[ $status -eq 0 ] && echo "No secrets found in tracked files."
exit $status
