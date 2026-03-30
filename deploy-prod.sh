#!/bin/bash
# Deploy to production GitHub Pages (carpooling0/communitycarpool)
# config.js already holds prod values. Only need to ensure CNAME is correct.

set -e
cd "$(dirname "$0")"

# Safety check: confirm config.js points to prod project
if grep -q "jboohdwihsiuvyrfeftp" config.js; then
  echo "✗ ERROR: config.js still has dev Supabase credentials. Aborting."
  exit 1
fi

echo "→ Ensuring prod CNAME..."
echo "communitycarpool.org" > CNAME

git add config.js CNAME
git diff --cached --quiet && echo "Nothing to commit, pushing as-is..." || git commit -m "chore: apply prod config for deployment"

echo "→ Pushing to origin (production)..."
git push origin main

echo "✓ Production deployed."
