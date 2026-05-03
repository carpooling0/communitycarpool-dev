# Community Carpool — Agent Handoff Document

**Last updated:** 2026-04-27  
**Project:** Community Carpool (communitycarpool.org)  
**Purpose:** Complete context for a new agent to continue work without needing prior conversation history.

---

## 1. Project Overview

A carpooling matchmaking platform. Users submit journeys (from/to locations), the system finds nearby matches, and emails both parties. Interest is expressed on a matches page; when mutual, contact details are revealed.

**Stack:** Static HTML/CSS/JS frontend · Supabase (Postgres + Edge Functions) backend · Resend for email · Mapbox for road distances · Umami for analytics

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

## 4. Edge Functions — Full Inventory (as of 2026-04-27)

### Prod (`tbkjealpnoriwdosvmju`) — 27 functions

| Function | verify_jwt | Version | Notes |
|---|---|---|---|
| admin-api | false | v15 | Token via `Authorization: Bearer` header |
| admin-auth | false | v9 | Login/logout/reset for admin panel. 7-day sessions |
| batch-send-emails | false | v41 | Groups unsent matches, sends via Resend, updates match to `notified` |
| confirm-deletion | false | v8 | Handles deletion confirmation link clicks |
| deactivate-journey | false | v13 | Sets journey_status = archived |
| expire-journeys | **true** | v16 | Cron job — expires journeys past `expires_at` |
| find-matches | false | v22 | Haversine/Mapbox/hybrid distance matching, upserts matches |
| get-analytics | false | v9 | Calls Umami API (17 parallel requests), admin token auth |
| get-matches-page | **true** | v29 | User-facing matches, token auth, name masking pre-mutual |
| get-org-locations | false | v13 | Returns org locations for journey form |
| manage-deletion | false | v11 | Request deletion token / confirm deletion |
| mutual-match-notify | **true** | v12 | Sends mutual match notification emails |
| process-deletions | **true** | v10 | Cron — deletes users past retention window |
| request-deletion | false | v9 | Generates deletion token, sends confirm email |
| resend-webhook | false | v9 | Svix HMAC verification, stores email_events, bounce suppression |
| school-share-batch | false | v5 | **Prod only** — One-off school parent email batch sender |
| send-interest-reminders | false | v5 | Daily cron — reminders for unresponded matches (days 3/7/11/15) |
| submit-feedback | false | v8 | Saves feedback to DB |
| submit-intern-application | false | v4 | Saves intern application, sends admin notification |
| submit-journey | false | v31 | Creates user + submission, triggers find-matches |
| submit-support-ticket | false | v15 | Saves ticket, blocks deletion type, emails admin |
| sync-analytics | false | v10 | Syncs Umami → analytics_daily table |
| test-ses | false | v2 | Temporary test function — can be deleted |
| track-email-open | false | v7 | Pixel tracker for email open events |
| track-event | false | v19 | Generic event tracking |
| update-email-prefs | false | v9 | GET/POST for unsubscribe preferences (camelCase body keys) |
| update-match-status | false | v36 | Interest/decline/reset, mutual match detection, immediate YES nudge email |

### Dev (`jboohdwihsiuvyrfeftp`) — 28 functions

Same as prod plus these **dev-only** functions:

| Function | verify_jwt | Version | Notes |
|---|---|---|---|
| email-events-query | false | v1 | Dev-only debugging helper |
| fetch-reddit-posts | false | v14 | Reddit Agent — dev only |
| school-share-test | false | v7 | Dev-only school share test function |

Dev is **missing** `school-share-batch` (prod-only campaign function).

---

## 5. Prod vs Dev — Key Differences

| Dimension | Prod | Dev |
|---|---|---|
| **testing_mode** | `false` (live sends to all users) | Likely `true` (sends only to whitelisted emails) |
| **journey_expiry_days** | `180` | `180` |
| **agents.html** | Blank stub (auto-stubbed by deploy-prod.sh) | Full page — Reddit Agent UI |
| **fetch-reddit-posts** | ❌ Not deployed | ✅ Deployed (v14) |
| **school-share-batch** | ✅ Deployed (v5) | ❌ Not deployed |
| **school-share-test** | ❌ Not deployed | ✅ Deployed (v7) |
| **email-events-query** | ❌ Not deployed | ✅ Deployed (v1) |
| **Edge function code** | Most functions have higher version numbers and different SHA256 from dev — prod has been more actively deployed to | Lower version numbers on most functions |
| **Data** | ~770 active submissions, live user data | Test data only |
| **AWS Bedrock secrets** | Not set | Set (`AWS_BEDROCK_ACCESS_KEY_ID`, `AWS_BEDROCK_SECRET_ACCESS_KEY`, `AWS_BEDROCK_REGION=eu-west-1`) |

### Why version numbers differ between prod and dev
Dev was set up **after** prod was already running. Every function started at v1 on dev when prod was already at v10–v30+. Lower version numbers on dev simply reflect the later start date — the code content deployed from the same local source files should be functionally identical. If SHA256 hashes differ, it means a function was updated on one env but not yet redeployed to the other (e.g. deployed to prod first, dev deployment was skipped or came later). Always redeploy to both envs after any change.

### What is intentionally dev-only (never deploy to prod)
Everything under the "Agents" category: `agents.html`, `fetch-reddit-posts`, Reddit Agent DB table (`reddit_digest`), AWS Bedrock secrets, Agents nav cron jobs. `deploy-prod.sh` automatically stubs `agents.html` before pushing to prod.

---

## 6. Key Database Tables

| Table | Purpose |
|---|---|
| users | email, name, match_page_token, email_bounced, deletion_requested_at, journey_limit, unsubscribed_matches/reminders/marketing |
| submissions | from/to locations, journey_status (active/inactive/expired), expires_at |
| matches | sub_a_id, sub_b_id, status, interest_a/b, interest_a_at/b_at, interest_reminders_sent (JSONB) |
| config | key/value pairs for all runtime settings |
| admin_users | admin accounts (PBKDF2 hashed passwords) |
| admin_sessions | session tokens, 7-day expiry |
| email_events | Resend webhook events — bounce tracking, open tracking, send audit |
| referral_links | ref_code, mode (individual/client), url, person_campaign_name |
| deletion_log | audit trail for deleted users |
| events | general event log (match_interest_expressed, nudge_sent, etc.) |
| analytics_daily | daily web traffic synced from Umami (synced nightly at 00:05 UTC) |

### Key config values (prod, as of 2026-04-27)

```
testing_mode = false              ← live — emails go to all users
matching_mode = instant
distance_method = mapbox
match_token_expiry_days = 120
journey_expiry_days = 180         ← changed from 90 on 2026-04-27
max_journeys_per_user = 10
required_terms_version = 1.2
interest_reminder_enabled = true
interest_reminder_days = 3        ← first reminder fires on day 3
interest_reminder_interval_days = 6
interest_reminder_max = 4         ← reminders at days 3 / 7 / 11 / 15
resend_daily_limit = 90
batch_email_hour_utc = 15
expiry_nudge_days = 7
```

### DB functions (RPCs)
- `get_submission_coords(p_id INT)` — returns submission with lat/lng as floats
- `find_nearby_users(...)` — returns from_lat, from_lng, to_lat, to_lng as FLOAT (not geography)
- `get_admin_metrics(...)` — dashboard metrics
- `get_admin_growth_chart(...)` — growth chart data

---

## 7. Known Bugs Fixed (do not revert)

1. **PostGIS WKB**: Geography columns return WKB hex, not GeoJSON. `find-matches` uses float columns (`from_lat` etc.) and the `find_nearby_users` RPC — never use `.coordinates` on geography columns.
2. **SES module-level init**: SESClient must be initialised lazily inside the handler, not at module top-level (causes 502 on cold start if secrets missing).
3. **`!inner` + `.or()`**: Using `!inner` join notation with `.or()` returns empty results. Use plain FK column name joins without `!inner`.
4. **admin-api token auth**: Token must be read from `Authorization: Bearer` header, not request body. Frontend `apiPost()` sends token in header only — never in body.
5. **email_events missing columns**: `resend-webhook` inserts `provider`, `batch_id`, `raw_payload`, `occurred_at`. Applied migration to add those 4 columns — bounce tracking now functional.
6. **sync-analytics silent 401**: Cron sent empty `secret` string (read from NULL DB setting). Fixed: removed auth from `sync-analytics` (write-only, safe). Auth-free version on both prod + dev since 2026-04-15.

---

## 8. Cron Jobs (prod & dev)

All confirmed active on **both prod and dev**.

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

## 9. Admin Panel

- URL: `https://communitycarpool.org/admin.html`
- Auth: email/password → 7-day session token stored in `localStorage` as `ccp_admin_token`
- `admin-auth`: login/me/logout/forgot_password/reset_password
- `admin-api`: all dashboard actions — metrics, tickets, deletions, users, blacklist, audit, team management, orgs, referral links

---

## 10. Email System

### Provider
- **Primary:** Resend (`RESEND_API_KEY` in Supabase secrets)
- **From address:** `hello@mail.communitycarpool.org` (set in `RESEND_FROM_EMAIL` secret)
- **Fallback:** AWS SES (secrets not yet configured — `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_FROM_EMAIL` all unset)

### Email types sent
| Type | Trigger | Function |
|---|---|---|
| Match notification | New match found | batch-send-emails (daily cron 15:00 UTC) |
| Immediate YES nudge | User A clicks YES, User B hasn't responded | update-match-status (fires immediately) |
| Interest reminders | Day 3, 7, 11, 15 after one-way interest | send-interest-reminders (nightly 23:50 UTC) |
| Mutual match reveal | Both sides say YES | update-match-status |
| Deletion confirmation | User requests deletion | request-deletion |
| Support notification | Support ticket submitted | submit-support-ticket |
| School parent share | One-off campaign | School share Python script / school-share-batch |

### Bounce handling
`resend-webhook` receives bounce events from Resend (Svix HMAC verified), sets `email_bounced=true` on the user, logs to `email_events`. Users with `email_bounced=true` are excluded from all future sends.

### Testing mode
When `config.testing_mode = 'true'`, emails only go to users with `email_whitelist = true`. Prod has been in live mode (`false`) since 2026-04-02.

---

## 11. Journey Expiry (updated 2026-04-27)

- **Config:** `journey_expiry_days = 180` (updated from 90)
- **All existing submissions** extended to `created_at + 180 days` (applied 2026-04-27)
- **Current state:** 767 active, 11 inactive; earliest expiry now 2026-08-28
- **How it works:** `expire-journeys` cron (22:00 UTC) sets `journey_status = 'expired'` for submissions where `expires_at < NOW()`
- **New submissions:** `expires_at = NOW() + 180 days` (set by `submit-journey` reading from config)

---

## 12. School Parent Email Campaign (2026-04-26/27)

### What was done
1. **CSV export:** `prod_school_routes_2026-04-26.csv` — 190 parents whose `to_location` or `from_location` matches a school keyword. Columns: `submission_id, name, email, school_name, from_location, to_location`.
2. **Template:** Custom HTML email with logo, body copy, green share message box, 5 share icons (WhatsApp, Facebook, X, LinkedIn, SMS). Uses referral URL `https://communitycarpool.org?ref=013`.
3. **Sends completed:**
   - 184 school parent share emails sent (6 were pre-sent and skipped), batch_id: `school-share-prod-batch`
   - 91 "Someone Just Said YES" nudge emails sent on 2026-04-27, batch_id: `yes-nudge-blast-2026-04-27`
4. **All logged** to `email_events` table.
5. **Referral link `ref=013`** created for this campaign.

### Script location
One-off Python script was run from `/tmp/` (not in repo). Template HTML is in `school-share-helper.js` in the codebase root. For future sends, use `school-share-batch` edge function on prod.

---

## 13. Pending Items

### A. Terms v1.3 Activation (when ready)
1. Copy `legal/terms-v1.3.html` → `terms.html` (overwrite)
2. Set `required_terms_version = '1.3'` in config on both prod and dev
3. Deploy frontend to both envs
4. Users prompted to re-accept on next matches page visit

### B. Admin Dashboard — "Last Synced" Label
Add a small `last synced: [date]` note below the Web Traffic section in `admin.html`. Source: `synced_at` column in `analytics_daily` (most recent row). The `if (an)` block ~line 1647 in `admin.html`.

### C. matches.html — `user_deleted` Match Status UI
When a match has `status = 'user_deleted'`, the matches page should show a greyed row with "No longer available" pill. Not yet built.

### E. landing.html — Split-Pane Landing Page (dev only, not yet built)
Design spec:
- **Desktop (>900px):** 50/50 split. Left column (52%): `scroll-driver` (height:400vh) with `sticky-left` (position:sticky, top:60px, height:calc(100vh-60px)) containing 4 sections that transition via JS on scroll. Right column (48%): `form-sticky` (position:sticky, top:60px) with the **exact** form from `index.html` (no changes, preserve all JS).
- **Mobile (≤900px):** Stacked single column. Content sections as `.mobile-section` divs, form at bottom. Sticky CTA bar fixed at bottom; fades away via IntersectionObserver when user scrolls to form.
- **Nav:** Fixed, 60px, logo left + links right + green CTA button.
- **4 content sections:**
  1. Hero — "Find someone going your way" + route visual (green/red dots + line)
  2. How it works — 3 numbered steps
  3. Privacy — "Your details stay hidden until you're ready" + before/after cards
  4. Community — Stats (770+ journeys, Free)
- **Confirmation screen:** Add PIN verification step (email/mobile verification) after the current success screen
- **Colours:** White background, `#10b981` green accents
- **Deploy to dev only** (`bash deploy-dev.sh`) — do NOT touch prod until explicit approval
- **Kimi reference page** `https://zvb33q2cftcfi.kimi.show` — use Chrome MCP tool (`mcp__Claude_in_Chrome__navigate` + `mcp__Claude_in_Chrome__get_page_text`) to retrieve content before writing the page

### D. Future Email Queue
When the daily Resend quota (90/day) is exhausted, emails are silently skipped. Future improvement: build a proper `email_queue` table with retry logic. Not built yet.

---

## 14. How to Start a New Session

1. Read memory: `/Users/ny/.claude/projects/-Users-ny-Downloads-Carpooling-CodeBase/memory/MEMORY.md`
2. Read this handoff: `/Users/ny/Downloads/Carpooling CodeBase/HANDOFF.md`
3. Before editing any edge function: use `get_edge_function` MCP to verify deployed version on both envs
4. Always deploy to **both** envs after any edge function change
5. Never commit or push frontend without running `deploy-prod.sh` and `deploy-dev.sh`
6. For DB inspection: use the Supabase MCP `execute_sql` tool — do not use Python HTTPS in this macOS environment (SSL cert issue with `urllib`); use `subprocess.run(['curl', ...])` if HTTP calls are needed from scripts
7. To send emails from a local script: get the `RESEND_API_KEY` from the user, write it to a temp `.env` file, source it, run the Python script, then **delete the `.env` file immediately after**

---

## 15. Architecture Notes

- All DB access via service role in edge functions — RLS is on, no policies = correct (anon blocked from direct table access)
- `spatial_ref_sys` is a PostGIS system table — can't enable RLS on it, safe to ignore in security advisor
- `get-matches-page` is `verify_jwt: true` — requires valid anon JWT in Authorization header
- `batch-send-emails` + `update-match-status` both check `testing_mode` before sending
- Two git remotes: `origin` = prod, `dev-repo` = dev. **Always verify before pushing.**

---

## 16. Session History Summary

| Session | Date | Key Work |
|---|---|---|
| Session 1 | 2026-02-18 | Fixed 4 critical bugs: PostGIS WKB, SES init, `!inner`+`.or()`, missing interest columns |
| Session 2 | 2026-03-03 | End-to-end test all edge functions; all passing |
| Session 3 | 2026-04-14 | Re-deployed all 24 functions; fixed admin-api bug; fixed email_events columns; fixed sync-analytics 6-day gap |
| Session 4 | 2026-04-15 | Confirmed all crons active; cleaned up rogue `supabase/functions/` dir |
| Session 5 | 2026-04-20/21 | email_read_at stamping + backfill; Terms v1.3 draft; support.html Enquiry type; admin session 7-day; OG tags |
| Session 6 | 2026-04-24 | Reminder cadence analysis; YES nudge + reminder copy overhaul; prod rollout of update-match-status + send-interest-reminders |
| Session 7 | 2026-04-26 | School parent CSV export (190 parents); 184 school share emails sent; template rebuilt with correct SVG share icons |
| Session 8 | 2026-04-27 | 91 "YES nudge" blast emails sent; journey expiry changed 90→180 days on prod+dev; user 781 (bose.yalamanchili@gmai.com — typo) merged into user 134 (correct email); final HANDOFF written |
| Session 9 | 2026-05-03 | landing.html redesign rolled into index.html; share buttons via /share/*.html redirects (ad blocker fix); email icons locally hosted at /email-icons/; RESEND_FROM_EMAIL → hello@mail.communitycarpool.org; Umami script moved to end of body, page identifier → 'home'; feedback modal added to footer; GitHub backup workflow fixed (filename-based 7-day retention, was broken -mtime); workflow run history cleaned up; confirmed edge functions identical between prod and dev (SHA256 difference is bundler artifact, not code drift); super-admin docs updated |

---

## 17. Frontend Notes (as of 2026-05-03)

- `index.html` is the redesigned landing page (rolled from `landing.html` on 2026-05-02); backup of old design at `index-backup-2026-05-02.html`
- All social share buttons route through `/share/*.html` redirect pages (whatsapp, facebook, x, linkedin, sms) — avoids ad blocker and popup blocker interference on desktop
- Email templates use locally hosted icons at `/email-icons/` (PNG files) — do not replace with external URLs
- Umami: script loaded at end of `<body>` (not `<head>` with `defer`); page identifier is `'home'`
- Feedback modal triggered by footer Feedback link (`openFeedbackModal()`) — submits to `submit-feedback` edge function
- GitHub Actions backup workflow (`community-carpool-data-backup`): runs daily 20:00 UTC, keeps 7 days of pg_dumps — retention now works correctly (fixed filename-based date check)
