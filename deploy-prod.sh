#!/bin/bash
# Deploy to production GitHub Pages (carpooling0/communitycarpool)
# Swaps config.js and CNAME to prod values, pushes, then restores.

set -e
cd "$(dirname "$0")"

echo "→ Switching to prod config..."
cp config.prod.js config.js
echo "communitycarpool.org" > CNAME

git add config.js CNAME
git commit -m "chore: apply prod config for deployment"

echo "→ Pushing to origin (production)..."
git push origin main

echo "→ Restoring dev config locally..."
git reset HEAD~1
git checkout -- config.js CNAME

echo "✓ Production deployed. Local config restored to dev."
