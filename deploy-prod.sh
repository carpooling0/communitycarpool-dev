#!/bin/bash
# Deploy to production GitHub Pages (carpooling0/communitycarpool)
# config.js already holds prod values. Only need to ensure CNAME is correct.
#
# ── DEV-ONLY FEATURES (do NOT deploy to prod) ─────────────────────────────────
# The following are intentionally restricted to dev (jboohdwihsiuvyrfeftp):
#   - Reddit Agent (fetch-reddit-posts edge function)
#   - reddit_digest DB table
#   - Reddit cron job (fetch-reddit-posts schedule)
#   - AWS Bedrock secrets (AWS_BEDROCK_ACCESS_KEY_ID, AWS_BEDROCK_SECRET_ACCESS_KEY, AWS_BEDROCK_REGION)
#     are set in dev Supabase only — not required by prod until SES migration
# ──────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")"

# Safety check: confirm config.js points to prod project
if grep -q "jboohdwihsiuvyrfeftp" config.js; then
  echo "✗ ERROR: config.js still has dev Supabase credentials. Aborting."
  exit 1
fi

echo "→ Ensuring prod CNAME..."
echo "communitycarpool.org" > CNAME

echo "→ Stubbing agents.html for prod (Reddit Agent is dev-only)..."
cp agents.html /tmp/agents-dev-backup.html
cat > agents.html << 'AGENTS_EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agents | Community Carpool</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f3f4f6; color: #111827; }
    .box { text-align: center; }
    h2 { font-size: 17px; font-weight: 700; margin-bottom: 8px; }
    p { font-size: 13px; color: #6b7280; margin-bottom: 20px; }
    a { color: #15803d; font-size: 13px; font-weight: 500; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Agents</h2>
    <p>No agents are configured for this environment.</p>
    <a href="admin.html">← Back to Admin</a>
  </div>
</body>
</html>
AGENTS_EOF

git add config.js CNAME agents.html
git diff --cached --quiet && echo "Nothing to commit, pushing as-is..." || git commit -m "chore: apply prod config for deployment"

echo "→ Pushing to origin (production)..."
git push origin main

echo "→ Restoring agents.html (dev version)..."
cp /tmp/agents-dev-backup.html agents.html

echo "✓ Production deployed."
