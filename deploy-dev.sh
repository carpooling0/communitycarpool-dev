#!/bin/bash
# Deploy to dev GitHub Pages (carpooling0/communitycarpool-dev)
# Swaps config.js and CNAME to dev values, force-pushes, then restores.

set -e
cd "$(dirname "$0")"

echo "→ Switching to dev config..."
cp config.dev.js config.js
echo "dev.communitycarpool.org" > CNAME

git add config.js CNAME
git commit -m "chore: apply dev config for deployment"

echo "→ Force-pushing to dev-repo..."
git push dev-repo main --force

echo "→ Restoring prod config locally..."
git reset HEAD~1
git checkout -- config.js CNAME

echo "✓ Dev deployed. Local config restored to prod."
