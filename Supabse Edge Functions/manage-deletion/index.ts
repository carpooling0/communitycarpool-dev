import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = 'https://communitycarpool.org'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''
  if (!resendKey || !fromEmail) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Community Carpool <${fromEmail}>`, to: [to], subject, html })
  })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai'
  })
}

// ─── Email templates ──────────────────────────────────────────────────────────

function confirmRequestEmail(name: string, confirmUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
      <div style="text-align:center;margin-bottom:32px;">
        <a href="${SITE_URL}"><img src="${SITE_URL}/logo_with_slogan.png" alt="Community Carpool" style="height:60px;width:auto;"></a>
      </div>
      <div style="background:white;border-radius:16px;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <h2 style="color:#111827;font-size:20px;margin:0 0 20px;">Confirm Data Deletion</h2>
        <p style="color:#374151;font-size:15px;margin:0 0 12px;">Hi ${name},</p>
        <p style="color:#374151;font-size:15px;margin:0 0 12px;">We received a request to permanently delete your Community Carpool account.</p>
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:16px;margin:0 0 20px;">
          <p style="color:#7f1d1d;font-size:14px;margin:0 0 6px;font-weight:600;">The following will be deleted:</p>
          <p style="color:#991b1b;font-size:14px;margin:0;line-height:1.8;">✕&nbsp; All journey registrations<br>✕&nbsp; All match history<br>✕&nbsp; Account profile &amp; settings</p>
        </div>
        <p style="color:#374151;font-size:15px;margin:0 0 24px;">To confirm, click the button below. <strong>This link expires in 24 hours.</strong></p>
        <div style="text-align:center;margin-bottom:28px;">
          <a href="${confirmUrl}" style="display:inline-block;background:#dc2626;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;">Confirm Deletion →</a>
        </div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px;">
        <p style="color:#6b7280;font-size:13px;margin:0;line-height:1.6;">Didn't request this? Ignore this email — your data will <strong>not</strong> be deleted. For help, visit <a href="${SITE_URL}/support.html" style="color:#16a34a;">Support</a>.</p>
      </div>
      <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:13px;">Community Carpool &middot; communitycarpool.org</div>
    </div>
  </body></html>`
}

function deletionScheduledEmail(name: string, matchesUrl: string, deletionDate: Date, retentionDays: number): string {
  const dateStr = formatDate(deletionDate)
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
      <div style="text-align:center;margin-bottom:32px;">
        <a href="${SITE_URL}"><img src="${SITE_URL}/logo_with_slogan.png" alt="Community Carpool" style="height:60px;width:auto;"></a>
      </div>
      <div style="background:white;border-radius:16px;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <h2 style="color:#111827;font-size:20px;margin:0 0 20px;">Deletion Scheduled — ${dateStr}</h2>
        <p style="color:#374151;font-size:15px;margin:0 0 12px;">Hi ${name},</p>
        <p style="color:#374151;font-size:15px;margin:0 0 20px;">Your deletion request has been confirmed. Your account data will be permanently deleted on <strong>${dateStr}</strong>.</p>
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:16px;margin:0 0 24px;">
          <p style="color:#7f1d1d;font-size:14px;margin:0 0 6px;font-weight:600;">Scheduled for deletion on ${dateStr}:</p>
          <p style="color:#991b1b;font-size:14px;margin:0;line-height:1.8;">✕&nbsp; All journey registrations<br>✕&nbsp; All match history<br>✕&nbsp; Account profile &amp; settings</p>
        </div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px;">
        <p style="color:#374151;font-size:15px;font-weight:600;margin:0 0 8px;">Changed your mind?</p>
        <p style="color:#374151;font-size:14px;margin:0 0 20px;line-height:1.6;">Contact us via <a href="${SITE_URL}/support.html" style="color:#16a34a;">Support</a> before ${dateStr} — we can cancel the deletion before it's processed.</p>
        <p style="color:#6b7280;font-size:13px;margin:0;line-height:1.6;">After ${dateStr}, your data cannot be recovered.</p>
      </div>
      <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:13px;">Community Carpool &middot; communitycarpool.org</div>
    </div>
  </body></html>`
}

function partnerNotificationEmail(partnerName: string, matchesUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
      <div style="text-align:center;margin-bottom:32px;">
        <a href="${SITE_URL}"><img src="${SITE_URL}/logo_with_slogan.png" alt="Community Carpool" style="height:60px;width:auto;"></a>
      </div>
      <div style="background:white;border-radius:16px;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <h2 style="color:#111827;font-size:20px;margin:0 0 16px;">A Match is No Longer Available</h2>
        <p style="color:#374151;font-size:15px;margin:0 0 12px;">Hi ${partnerName},</p>
        <p style="color:#374151;font-size:15px;margin:0 0 20px;line-height:1.6;">One of your carpool matches is no longer available. Your other active matches are unaffected.</p>
        <div style="text-align:center;margin-bottom:8px;">
          <a href="${matchesUrl}" style="display:inline-block;background:#16a34a;color:white;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;">View My Matches →</a>
        </div>
      </div>
      <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:13px;">Community Carpool &middot; communitycarpool.org</div>
    </div>
  </body></html>`
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const body = await req.json()

    // ── MODE 1: REQUEST — { email } ──────────────────────────────────────────
    if (body.email && !body.token) {
      const cleanEmail = String(body.email).toLowerCase().trim()

      const { data: user } = await supabase
        .from('users')
        .select('user_id, name, deletion_requested_at')
        .eq('email', cleanEmail)
        .single()

      // Always return success — prevent email enumeration
      if (!user) return json({ success: true })

      // If already confirmed, inform (without leaking that it was confirmed)
      if (user.deletion_requested_at) return json({ success: true })

      const deletionToken = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      await supabase.from('users').update({
        deletion_token: deletionToken,
        deletion_token_expires_at: expiresAt
      }).eq('user_id', user.user_id)

      const confirmUrl = `${SITE_URL}/confirm-deletion.html?token=${deletionToken}`
      await sendEmail(cleanEmail, 'Confirm your data deletion — Community Carpool', confirmRequestEmail(user.name, confirmUrl))

      return json({ success: true })
    }

    // ── MODE 2: CONFIRM — { token } ──────────────────────────────────────────
    if (body.token) {
      const { data: user } = await supabase
        .from('users')
        .select('user_id, name, email, match_page_token, deletion_token_expires_at, deletion_requested_at')
        .eq('deletion_token', body.token)
        .single()

      if (!user) {
        return json({ success: false, error: 'Invalid or expired link. Please submit a new deletion request via support.' }, 404)
      }

      // Already confirmed — idempotent response
      if (user.deletion_requested_at) {
        return json({ success: true, alreadyConfirmed: true })
      }

      // Check expiry
      if (new Date(user.deletion_token_expires_at) < new Date()) {
        return json({ success: false, error: 'This link has expired. Please submit a new deletion request.' }, 410)
      }

      const now = new Date().toISOString()
      const retentionDays = parseInt(await getConfig('data_retention_days') || '30', 10)
      const deletionDate = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)

      // Get user's submission IDs
      const { data: submissions } = await supabase
        .from('submissions')
        .select('submission_id')
        .eq('user_id', user.user_id)
      const subIds = (submissions || []).map((s: any) => s.submission_id)

      // 1. Mark user as deletion confirmed + unsubscribe all
      await supabase.from('users').update({
        deletion_requested_at:     now,
        deletion_token:            null,
        deletion_token_expires_at: null,
        unsubscribed_matches:      true,
        unsubscribed_reminders:    true,
        unsubscribed_marketing:    true,
        unsubscribed_at:           now
      }).eq('user_id', user.user_id)

      // 2. Deactivate submissions + mark matches (run in parallel)
      const dbUpdates: Promise<any>[] = []

      if (subIds.length > 0) {
        dbUpdates.push(
          supabase.from('submissions')
            .update({ journey_status: 'deletion_pending' })
            .in('submission_id', subIds)
        )
        dbUpdates.push(
          supabase.from('matches')
            .update({ status: 'user_deleted' })
            .in('sub_a_id', subIds)
            .in('status', ['new', 'notified', 'interest_expressed', 'contact_revealed'])
        )
        dbUpdates.push(
          supabase.from('matches')
            .update({ status: 'user_deleted' })
            .in('sub_b_id', subIds)
            .in('status', ['new', 'notified', 'interest_expressed', 'contact_revealed'])
        )
      }

      await Promise.allSettled(dbUpdates)

      // 3. Notify affected match partners (anonymous — no name/reason given)
      if (subIds.length > 0) {
        const [{ data: matchesAsA }, { data: matchesAsB }] = await Promise.all([
          supabase.from('matches')
            .select('sub_b:submissions!sub_b_id(user_id, users(name, email, match_page_token))')
            .in('sub_a_id', subIds),
          supabase.from('matches')
            .select('sub_a:submissions!sub_a_id(user_id, users(name, email, match_page_token))')
            .in('sub_b_id', subIds)
        ])

        const partnersNotified = new Set<string>()
        const allPartners = [
          ...((matchesAsA || []).map((m: any) => m.sub_b?.users).filter(Boolean)),
          ...((matchesAsB || []).map((m: any) => m.sub_a?.users).filter(Boolean))
        ]

        for (const partner of allPartners) {
          if (!partner?.email || partnersNotified.has(partner.email)) continue
          partnersNotified.add(partner.email)
          const matchesUrl = `${SITE_URL}/matches.html?token=${partner.match_page_token}`
          sendEmail(partner.email, 'One of your carpool matches is no longer available', partnerNotificationEmail(partner.name, matchesUrl))
            .catch(() => {}) // fire-and-forget
        }
      }

      // 4. Send "deletion scheduled" email to the user
      const matchesUrl = `${SITE_URL}/matches.html?token=${user.match_page_token}`
      await sendEmail(user.email, `Deletion scheduled for ${formatDate(deletionDate)} — Community Carpool`, deletionScheduledEmail(user.name, matchesUrl, deletionDate, retentionDays))

      return json({ success: true, deletionDate: deletionDate.toISOString(), retentionDays })
    }

    return json({ success: false, error: 'Invalid request — provide email or token' }, 400)

  } catch (err: any) {
    console.error('manage-deletion error:', err)
    return json({ success: false, error: err.message }, 500)
  }
})
