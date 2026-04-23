# Community Carpool — Agent Handoff Document

**Last updated:** 2026-04-15 (session 2)  
**Project:** Community Carpool (communitycarpool.org)  
**Purpose:** Complete context for a new agent to continue work without needing prior conversation history.

---

## 1. Project Overview

A carpooling matchmaking platform. Users submit journeys (from/to locations), the system finds nearby matches, and emails both parties. Interest is expressed on a matches page; when mutual, contact details are revealed.

**Stack:** Static HTML/CSS/JS frontend · Supabase (Postgres + Edge Functions) backend · Resend for email · Mapbox for road distances (optional) · Umami for analytics

---

## 2. Critical Config (memorise these)

| Item | Value |
|---|---|
| Prod Supabase project ID | `tbkjealpnoriwdosvmju` |
| Dev Supabase project ID | `jboohdwihsiuvyrfeftp` |
| Codebase path | `/Users/ny/Downloads/Carpooling CodeBase/` |
| Edge functions dir | `Supabse Edge Functions/` *(note typo — do not rename)* |
| Prod anon key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRia2plYWxwbm9yaXdkb3N2bWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMTg2ODAsImV4cCI6MjA4Njg5NDY4MH0.K0iS87GLgAZhYwFIQNphVFrarMzFxECkFYFvxpeVcsA` |
| Git prod remote | `origin` → `carpooling0/communitycarpool` |
| Git dev remote | `dev-repo` → `carpooling0/communitycarpool-dev` |

---

## 3. Deployment Rules (CRITICAL)

### Edge Functions
- **Always** deploy via Supabase MCP `deploy_edge_function` tool
- Deploy to **both** prod (`tbkjealpnoriwdosvmju`) **and** dev (`jboohdwihsiuvyrfeftp`) for every change
- Source of truth: `Supabse Edge Functions/<function-name>/index.ts`
- There is also a rogue `supabase/functions/` directory created by Cursor — **ignore it**, it is not the source of truth

### Frontend (HTML/CSS/JS)
- **Never** use raw `git push` to deploy
- Always use the deploy scripts:
  - `bash deploy-prod.sh` → pushes to `origin` (prod)
  - `bash deploy-dev.sh` → swaps config, pushes to `dev-repo`, restores prod config
  - Run **both** after every frontend change
- **Commit first**, then deploy: `git add … && git commit` → `deploy-prod.sh` → `deploy-dev.sh`

---

## 4. Edge Functions — All 24

All deployed and in parity as of 2026-04-14. Source in `Supabse Edge Functions/<name>/index.ts`.

| Function | verify_jwt | Notes |
|---|---|---|
| admin-api | false | Token via `Authorization: Bearer` header. Reads from req header, NOT body. |
| admin-auth | false | Login/logout/reset for admin panel |
| batch-send-emails | false | Groups unsent matches, sends via Resend, updates match status to `notified` |
| confirm-deletion | false | Handles deletion confirmation link clicks |
| deactivate-journey | false | Sets journey_status = archived |
| expire-journeys | **true** | Cron job — expires journeys past `expires_at` |
| find-matches | false | Haversine/Mapbox/hybrid distance matching, upserts matches |
| get-analytics | false | Calls Umami API (17 parallel requests), admin token auth |
| get-matches-page | **true** | User-facing matches page, token auth, name masking pre-mutual |
| get-org-locations | false | Returns org locations for journey form |
| manage-deletion | false | Mode 1: request deletion token. Mode 2: confirm deletion, deactivate subs/matches |
| mutual-match-notify | **true** | Sends mutual match notification emails (cron or manual trigger) |
| process-deletions | **true** | Cron — deletes users past retention window |
| request-deletion | false | Generates deletion token, sends confirm email |
| resend-webhook | false | Svix HMAC verification, stores email_events, handles bounce suppression |
| send-interest-reminders | false | Daily cron — sends reminders for unresponded matches |
| submit-feedback | false | Saves feedback to DB |
| submit-intern-application | false | Saves intern application, sends admin notification, bot protection |
| submit-journey | false | Creates user + submission, triggers find-matches on hybrid/instant mode |
| submit-support-ticket | false | Saves ticket, blocks deletion type, emails admin |
| sync-analytics | false | Syncs Umami → analytics_daily table |
| track-event | false | Generic event tracking |
| update-email-prefs | false | GET/POST for unsubscribe preferences (camelCase body keys) |
| update-match-status | false | Interest/decline/reset, mutual match detection → contact_revealed, sends emails |

### Key impl details
- `admin-api`: validates session by reading `Authorization: Bearer <token>` header. The deployed v12 was broken (read token from body) — was fixed to v13 on 2026-04-14.
- `batch-send-emails` + `update-match-status`: testing_mode check — if `config.testing_mode != 'false'`, only sends to users with `email_whitelist = true`.
- `find-matches`: uses `find_nearby_users` RPC (returns float lat/lng, not WKB geography). Do NOT switch back to direct column access on geography columns.
- `send-interest-reminders`: reads `interest_reminders_sent` JSONB column on `matches` table.

---

## 5. Key Database Tables

| Table | Purpose |
|---|---|
| users | email, name, match_page_token, email_bounced, deletion_requested_at, journey_limit |
| submissions | from/to locations, lat/lng (float), journey_status (active/archived/deletion_pending/expired) |
| matches | sub_a_id, sub_b_id, status, interest_a/b, interest_reminders_sent (JSONB) |
| config | key/value pairs for runtime settings |
| admin_users | admin accounts (PBKDF2 hashed passwords) |
| admin_sessions | session tokens, 8-hour expiry |
| email_events | Resend webhook events for bounce/quota tracking |
| referral_links | ref_code, mode (individual/client), url, person_campaign_name |
| deletion_log | audit trail for deleted users |

### Key config keys (prod, as of 2026-04-14)

```
testing_mode = false              (live — emails go to all users)
matching_mode = hybrid            (or instant/batch)
distance_method = haversine       (or mapbox/hybrid)
match_token_expiry_days = 120
journey_expiry_days = 90
max_journeys_per_user = 10
required_terms_version = (check live)
interest_reminder_enabled = true
interest_reminder_days = 3
interest_reminder_interval_days = 6
interest_reminder_max = 4
resend_daily_limit = 90
```

### DB functions (RPCs)
- `get_submission_coords(p_id INT)` — returns submission with lat/lng as floats
- `find_nearby_users(...)` — returns from_lat, from_lng, to_lat, to_lng as FLOAT (not geography)
- `get_admin_metrics(...)` — dashboard metrics
- `get_admin_growth_chart(...)` — growth chart data

---

## 6. Known Bugs Fixed (do not revert)

1. **PostGIS WKB**: Geography columns return WKB hex, not GeoJSON. `find-matches` uses float columns (`from_lat` etc.) and the `find_nearby_users` RPC — never use `.coordinates` on geography columns.
2. **SES module-level init**: SESClient must be initialised lazily inside the handler, not at module top-level (causes 502 on cold start if secrets missing).
3. **`!inner` + `.or()`**: Using `!inner` join notation with `.or()` returns empty results. Use plain FK column name joins without `!inner`.
4. **admin-api token auth**: Token must be read from `Authorization: Bearer` header, not request body. Frontend `apiPost()` sends token in header only — never in body. (Fixed in v13/prod, v29/dev on 2026-04-14.)
5. **email_events missing columns**: `resend-webhook` inserts `provider`, `batch_id`, `raw_payload`, `occurred_at` but the table originally lacked those 4 columns → every webhook silently failed, bounce tracking non-functional since day 1. Fixed via migration on 2026-04-14. No historical data recoverable.
6. **sync-analytics silent 401 (6-day gap)**: Nightly cron read `app.settings.sync_secret` from DB (NULL) → sent `{"secret":""}` → empty string is falsy in JS → auth check failed → 401 every night for 6 days (Apr 9-14). `SYNC_SECRET` env var IS set correctly, but cron read from wrong source. Fix: removed auth entirely from `sync-analytics` (write-only analytics, no sensitive data). Backfill triggered for Apr 9-14 and confirmed. (v9/prod on 2026-04-15, v7/dev on 2026-04-15.)

---

## 7. Cron Jobs (prod)

All confirmed active on **both prod and dev** as of 2026-04-15.

| Job | Schedule | Function |
|---|---|---|
| batch-emails | `0 15 * * *` (15:00 UTC) | batch-send-emails |
| expire-journeys | `0 22 * * *` (22:00 UTC) | expire-journeys |
| process-deletions-daily | `0 22 * * *` (22:00 UTC) | process-deletions |
| send-interest-reminders-daily | `50 23 * * *` (23:50 UTC) | send-interest-reminders |
| sync-analytics-nightly | `5 0 * * *` (00:05 UTC) | sync-analytics |
| keep-warm-get-matches-page | `*/2 * * * *` (every 2 min) | get-matches-page (OPTIONS ping) |
| keep-warm-submit-journey | `*/2 * * * *` (every 2 min) | submit-journey (OPTIONS ping) |

---

## 8. Admin Panel

- URL: `https://communitycarpool.org/admin.html`
- Auth: email/password → 8-hour session token stored in `localStorage` as `ccp_admin_token`
- `admin-auth`: login/me/logout/forgot_password/reset_password
- `admin-api`: all dashboard actions — metrics, tickets, deletions, users, blacklist, audit, team management, orgs, referral links

---

## 9. Other Agent's Changes (2026-04-13) — Status

Another agent (Cursor) made these changes. Assessment:

| Change | Status | Action needed |
|---|---|---|
| Git remotes updated (`origin` = prod, `dev-repo` = dev) | ✅ Correct — matches expected config | None |
| Pre-push hook created then removed | ✅ Removed — no residue | None |
| Cron reconciled (removed send-interest-reminders from dev, then re-added) | ✅ End state correct — cron exists on both prod and dev | None |
| `supabase/functions/send-interest-reminders/index.ts` added to repo | ✅ Rogue directory `supabase/functions/` confirmed deleted (2026-04-15) | None |
| Deployed send-interest-reminders to both envs | ✅ Already re-deployed from local source in current session | No further action |

**Two agents on the codebase:** Yes, this is a problem. The Cursor agent:
- Created a duplicate edge functions directory (`supabase/functions/`)
- May push to wrong git remotes if not careful
- Can diverge the deployed edge functions from the local source

**Recommendation:** Use only one agent at a time. Before starting a session, verify deployed SHA256 hashes match local source using `get_edge_function` MCP on both envs. The re-deploy of all 24 functions done in this session re-established parity as of 2026-04-14.

---

## 10. What Was Done in Session 2026-04-14

1. Re-deployed all 24 edge functions to both prod and dev to restore SHA256 parity after Cursor diverged them
2. Fixed `admin-api` login loop bug (token was being read from body instead of Authorization header)
3. Applied `send-interest-reminders` prod prerequisites (column + config keys + cron — all were already present)
4. Inserted `referral_links` row for DAMAC Campaign (`mode=client`, `url=https://communitycarpool.org/?client=damac`, `ref_code=NULL`)
5. Backfilled `person_campaign_name` for ref codes 001–007 (008/DAMAC was missing row, handled as insert)
6. Deleted test user 288 (Anvith / anvithy09@gmail.com) — no matches, 1 submission, logged to deletion_log
7. Fixed `email_events` missing columns — applied migration to add `provider`, `batch_id`, `raw_payload`, `occurred_at`; bounce tracking now functional
8. Fixed `sync-analytics` 6-day gap — root cause: cron sent empty `secret` string (read from NULL DB setting), auth check failed silently; removed auth from function (write-only, safe); backfilled Apr 9-14 confirmed; deployed auth-free version to both prod (v9) and dev (v7)

---

## 11. What Was Done in Session 2026-04-15

1. Confirmed all cron jobs exist and are active on both prod and dev — updated section 7 with full cron list
2. Confirmed rogue `supabase/functions/` directory is deleted — updated section 9

---

## 12. What Was Done in Session 2026-04-20 / 2026-04-21

1. **email_read_at stamping** — Implemented in `get-matches-page`: stamps `email_read_at_a`/`email_read_at_b` on first page visit (non-poll). Fixed fire-and-forget bug (must use `await Promise.all`). Deployed prod v28, dev v13.
2. **email_read_at backfill** — Backfilled historical data using first `matches_page_viewed` event per user after match creation. 233 side A + 285 side B stamped; 93 matches remain NULL (genuinely never visited). Run on both prod and dev.
3. **Terms v1.3** — Created `legal/terms-v1.3.html` archive (NOT yet activated). 6 changes: non-commercial clause, reciprocal carpooling bullet, driver warranty, prohibited uses (passenger-only), right to refuse wording. Do NOT activate until user approves — copy to `terms.html` and set `required_terms_version=1.3` in config on both envs.
4. **user_deleted match UI** — Confirmed already on prod (HANDOFF was stale). Greyed row + "No longer available" pill working.
5. **Deleted test user** — anvithy09@gmail.com (user_id=419) deleted from prod. Logged to deletion_log.
6. **support.html** — Added "Enquiry" as 4th ticket category (2×2 radio grid, left-aligned circles), email format validation on all fields. Deployed prod + dev. Edge function `submit-support-ticket` updated with `enquiry: '💬 Enquiry'` label (prod v14, dev v13).
7. **admin-auth session** — Extended from 8h to 7 days. Deployed prod v8 + dev v8. Existing sessions unaffected until next login.
8. **index.html OG tags** — Added `og:image:width/height/type`, changed `twitter:card` to `summary_large_image`. Deployed prod + dev. WhatsApp OG preview confirmed working with `https://communitycarpool.org` (https:// prefix required).

---

## 13. Dev-Only Features (do NOT deploy to prod)

**Everything under the "Agents" category is dev-only.** This includes the frontend page, the edge function, the DB table, the cron jobs, and the AWS Bedrock secrets. None of this should ever be deployed to prod until explicitly decided.

The `deploy-prod.sh` script automatically stubs `agents.html` with a blank placeholder before pushing to prod and restores the real file after. No manual action needed — but do not bypass this.

| Feature | Dev pieces | Notes |
|---|---|---|
| **agents.html** | Frontend page | Standalone page (not inside admin.html). Linked from admin sidebar under "Agents > Reddit Agent". `deploy-prod.sh` replaces it with a blank stub on prod push. |
| **Reddit Agent** | `fetch-reddit-posts` edge function (v3), `reddit_digest` DB table, 2x daily cron jobs (04:00 + 10:00 UTC) | Monitors 30 subreddits, sends posts to Claude Haiku on AWS Bedrock for relevance scoring and reply drafting. Results reviewed manually in `agents.html`. |
| **Subreddits monitored** | Configured in `fetch-reddit-posts/index.ts` | 30 subreddits across: carpooling/commuting, sustainability, urban/transport, UAE/Gulf (dubai, DubaiExpats, abudhabi, sharjah), India (Kerala, mumbai, bangalore, hyderabad, delhi, Chennai, pune, india), expat/frugal. |
| **AWS Bedrock** | `AWS_BEDROCK_ACCESS_KEY_ID`, `AWS_BEDROCK_SECRET_ACCESS_KEY`, `AWS_BEDROCK_REGION=eu-west-1` | Set in dev Supabase secrets only. Model: `anthropic.claude-3-haiku-20240307-v1:0`. Separate from future SES credentials. |
| **admin.html Agents nav** | "Agents" section in sidebar (admin-only) | Links to `agents.html` in a new tab. The nav section itself is in admin.html on both prod and dev — but in prod it just opens the blank stub page. |

---

## 14. Pending Items (not yet built)

### A. Admin Dashboard — Analytics "last synced" label

**What:** The Web Traffic analytics section shows data synced once daily from Cloudflare (at ~4 AM Dubai). When an admin selects "last 24 hours", they're actually seeing yesterday's data — which is confusing (e.g., 100% bounce rate when 85 users signed up today).

**Fix:** Add a small "last synced: 19 Apr, 04:05 AM" note below the Web Traffic section header so it's clear the data is not real-time. Source: `synced_at` column in `analytics_daily` — use the most recent row's value.

**File:** `admin.html` — the `if (an)` block that renders the Web Traffic KPI grid (~line 1647).

---

### B. Terms v1.3 Activation (when ready)

1. Copy `legal/terms-v1.3.html` → `terms.html` (overwrite)
2. Set `required_terms_version = '1.3'` in config table on both prod and dev
3. Deploy frontend to both envs
4. Users will be prompted to re-accept on next matches page visit

---

## 14. How to Start a New Session

1. Check memory: `/Users/ny/.claude/projects/-Users-ny-Downloads-Carpooling-CodeBase/memory/MEMORY.md`
2. Check this handoff: `/Users/ny/Downloads/Carpooling CodeBase/HANDOFF.md`
3. Verify any edge function before editing: use `get_edge_function` MCP to check deployed version
4. Always deploy to **both** envs after any edge function change
5. Never commit or push frontend without running deploy scripts
