import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/send-email.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // ── Preview / test mode ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const testTo = url.searchParams.get('test_to')
    const type = url.searchParams.get('type') || 'expiry'
    if (testTo) {
      const token = 'preview-token-000'
      const siteUrl = SITE_URL
      let html = '', subject = ''
      if (type === 'interest') {
        subject = 'Someone is interested in your archived journey!'
        html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
  <div style="text-align:center;margin-bottom:32px;"><a href="${siteUrl}" style="text-decoration:none;"><img src="${siteUrl}/logo-email.png" alt="Community Carpool" style="height:56px;width:auto;display:block;margin:0 auto;" /></a></div>
  <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <h2 style="color:#f59e0b;margin:0 0 12px;">⚡ Someone is interested!</h2>
    <p style="color:#6b7280;margin:0 0 20px;">Your Journey #1 (Dubai Marina → DIFC) is currently inactive, but someone on your route has expressed interest.</p>
    <div style="text-align:center;margin-bottom:24px;"><a href="${siteUrl}/matches.html?token=${token}&journey=1" style="display:inline-block;background:#f59e0b;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View &amp; Reactivate &#x2192;</a></div>
    <!-- Journey Tracker — Step 2 active -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td style="border-top:1px solid #E5E7EB;padding-bottom:16px;"></td></tr></table>
    <div style="font-size:11px;font-weight:700;color:#1B5C3A;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;">Your Carpool Status</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
      <tr>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#1B5C3A;color:#fff;font-size:13px;font-weight:700;line-height:28px;margin:0 auto 4px;">&#10003;</div><div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;line-height:1.3;word-break:break-word;">Joined the Pool</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#1B5C3A;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#B4E035;color:#1B5C3A;font-size:12px;font-weight:900;line-height:28px;margin:0 auto 4px;border:2px solid #1B5C3A;">2</div><div style="font-size:9px;color:#1B5C3A;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Matched</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">3</div><div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Connected</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">4</div><div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Carpooling!</div></td>
      </tr>
    </table>
  </div>
  <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">Know someone who commutes the same way?</p>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">The more people in your area sign up, the better the matches get.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
      <td style="padding:0 5px;"><a href="${siteUrl}/share/whatsapp.html" style="text-decoration:none;"><img src="${siteUrl}/email-icons/whatsapp.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
      <td style="padding:0 5px;"><a href="${siteUrl}/share/facebook.html" style="text-decoration:none;"><img src="${siteUrl}/email-icons/facebook.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
      <td style="padding:0 5px;"><a href="${siteUrl}/share/twitter.html" style="text-decoration:none;"><img src="${siteUrl}/email-icons/twitter.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="X" /></a></td>
      <td style="padding:0 5px;"><a href="${siteUrl}/share/linkedin.html" style="text-decoration:none;"><img src="${siteUrl}/email-icons/linkedin.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
      <td style="padding:0 5px;"><a href="${siteUrl}/share/sms.html" style="text-decoration:none;"><img src="${siteUrl}/email-icons/sms.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
    </tr></table>
  </div>
  <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:14px;">
    <p style="margin:0 0 6px;"><a href="${siteUrl}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;<a href="${siteUrl}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;<a href="${siteUrl}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;<a href="${siteUrl}/unsubscribe.html?token=${token}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;<a href="${siteUrl}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a></p>
  </div>
</div></body></html>`
      } else {
        subject = 'Your journey expires soon — still commuting?'
        html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
  <div style="text-align:center;margin-bottom:32px;"><a href="${siteUrl}" style="text-decoration:none;"><img src="${siteUrl}/logo-email.png" alt="Community Carpool" style="height:56px;width:auto;display:block;margin:0 auto;" /></a></div>
  <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <h2 style="color:#111827;margin:0 0 12px;">Hi Alex!</h2>
    <p style="color:#6b7280;margin:0 0 20px;">Your Journey #1 (Dubai Marina → DIFC) will expire in 7 days.</p>
    <div style="text-align:center;margin-bottom:24px;"><a href="${siteUrl}/matches.html?token=${token}" style="display:inline-block;background:#16a34a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View My Journeys &#x2192;</a></div>
    <!-- Journey Tracker — Step 1 active -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td style="border-top:1px solid #E5E7EB;padding-bottom:16px;"></td></tr></table>
    <div style="font-size:11px;font-weight:700;color:#1B5C3A;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;">Your Carpool Status</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
      <tr>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#B4E035;color:#1B5C3A;font-size:12px;font-weight:900;line-height:28px;margin:0 auto 4px;border:2px solid #1B5C3A;">1</div><div style="font-size:9px;color:#1B5C3A;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;line-height:1.3;word-break:break-word;">Joined the Pool</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">2</div><div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Matched</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">3</div><div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Connected</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">4</div><div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Carpooling!</div></td>
      </tr>
    </table>
  </div>
  <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">Know someone who commutes the same way?</p>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">The more people in your area sign up, the better the matches get.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
      <td style="padding:0 5px;"><a href="${siteUrl}/share/whatsapp.html" style="text-decoration:none;"><img src="${siteUrl}/email-icons/whatsapp.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
      <td style="padding:0 5px;"><a href="${siteUrl}/share/facebook.html" style="text-decoration:none;"><img src="${siteUrl}/email-icons/facebook.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
      <td style="padding:0 5px;"><a href="${siteUrl}/share/twitter.html" style="text-decoration:none;"><img src="${siteUrl}/email-icons/twitter.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="X" /></a></td>
      <td style="padding:0 5px;"><a href="${siteUrl}/share/linkedin.html" style="text-decoration:none;"><img src="${siteUrl}/email-icons/linkedin.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
      <td style="padding:0 5px;"><a href="${siteUrl}/share/sms.html" style="text-decoration:none;"><img src="${siteUrl}/email-icons/sms.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
    </tr></table>
  </div>
  <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:14px;">
    <p style="margin:0 0 6px;"><a href="${siteUrl}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;<a href="${siteUrl}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;<a href="${siteUrl}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;<a href="${siteUrl}/unsubscribe.html?token=${token}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;<a href="${siteUrl}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a></p>
  </div>
</div></body></html>`
      }
      await sendEmail(testTo, subject, html)
      return new Response(JSON.stringify({ preview: true, to: testTo, type }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
  }

  try {
    const now = new Date()
    let expiredCount = 0, nudgesSent = 0

    // 1. Auto-expire past expiry date
    const { data: expiredJourneys } = await supabase.from('submissions')
      .update({ journey_status: 'expired' }).eq('journey_status', 'active').lt('expires_at', now.toISOString())
      .select('submission_id')
    expiredCount = expiredJourneys?.length || 0
    for (const sub of expiredJourneys || []) {
      await supabase.from('events').insert({ event_type: 'journey_expired', submission_id: sub.submission_id })
    }

    // 2. Expiry nudge emails
    if (await getConfig('expiry_nudge_enabled') === 'true') {
      const nudgeDays = parseInt(await getConfig('expiry_nudge_days')) || 7
      const nudgeDate = new Date()
      nudgeDate.setDate(nudgeDate.getDate() + nudgeDays)

      const { data: nudgeJourneys } = await supabase.from('submissions')
        .select('submission_id, journey_num, from_location, to_location, expires_at, users!inner(name, email, match_page_token)')
        .eq('journey_status', 'active').lt('expires_at', nudgeDate.toISOString())
        .gt('expires_at', now.toISOString()).is('expiry_nudge_sent_at', null)

      for (const sub of nudgeJourneys || []) {
        try {
          const expiryDate = new Date(sub.expires_at).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dubai' })
          const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
  <div style="text-align:center;margin-bottom:32px;"><a href="${SITE_URL}" style="text-decoration:none;"><img src="${SITE_URL}/logo-email.png" alt="Community Carpool" style="height:56px;width:auto;display:block;margin:0 auto;" /></a></div>
  <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <h2 style="color:#111827;margin:0 0 12px;">Hi ${sub.users.name}!</h2>
    <p style="color:#6b7280;margin:0 0 8px;">Your Journey #${sub.journey_num} (${sub.from_location} → ${sub.to_location}) will expire on <strong>${expiryDate}</strong>.</p>
    <p style="color:#6b7280;margin:0 0 20px;">Still commuting? No action needed — it stays active. Otherwise you can deactivate it from your matches page.</p>
    <div style="text-align:center;margin-bottom:24px;"><a href="${SITE_URL}/matches.html?token=${sub.users.match_page_token}" style="display:inline-block;background:#16a34a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View My Journeys &#x2192;</a></div>
    <!-- Journey Tracker — Step 1 active -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td style="border-top:1px solid #E5E7EB;padding-bottom:16px;"></td></tr></table>
    <div style="font-size:11px;font-weight:700;color:#1B5C3A;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;">Your Carpool Status</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
      <tr>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#B4E035;color:#1B5C3A;font-size:12px;font-weight:900;line-height:28px;margin:0 auto 4px;border:2px solid #1B5C3A;">1</div><div style="font-size:9px;color:#1B5C3A;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;line-height:1.3;word-break:break-word;">Joined the Pool</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">2</div><div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Matched</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">3</div><div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Connected</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">4</div><div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Carpooling!</div></td>
      </tr>
    </table>
  </div>
  <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">Know someone who commutes the same way?</p>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">The more people in your area sign up, the better the matches get.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/whatsapp.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/whatsapp.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/facebook.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/facebook.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/twitter.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/twitter.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="X" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/linkedin.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/linkedin.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/sms.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/sms.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
    </tr></table>
  </div>
  <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:14px;">
    <p style="margin:0 0 6px;"><a href="${SITE_URL}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;<a href="${SITE_URL}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;<a href="${SITE_URL}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;<a href="${SITE_URL}/unsubscribe.html?token=${sub.users.match_page_token}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;<a href="${SITE_URL}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a></p>
  </div>
</div></body></html>`

          await sendEmail(sub.users.email, `Your journey expires on ${expiryDate} — still commuting?`, html)
          await supabase.from('submissions').update({ expiry_nudge_sent_at: now.toISOString() }).eq('submission_id', sub.submission_id)
          await supabase.from('events').insert({ event_type: 'expiry_nudge_sent', submission_id: sub.submission_id })
          nudgesSent++
        } catch (e) { console.error('Nudge failed:', e) }
      }
    }

    // 3. Interest nudge for inactive journeys
    // Note: interest_nudge_days config key exists but is not currently used here —
    // this block fires for all inactive_with_interest journeys regardless of age.
    // Day-based filtering is reserved for a future iteration.
    if (await getConfig('interest_nudge_enabled') === 'true') {
      const { data: inactiveWithInterest } = await supabase.from('submissions')
        .select('submission_id, journey_num, from_location, to_location, users!inner(name, email, match_page_token)')
        .eq('journey_status', 'inactive_with_interest').is('interest_nudge_sent_at', null)

      for (const sub of inactiveWithInterest || []) {
        try {
          const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
  <div style="text-align:center;margin-bottom:32px;"><a href="${SITE_URL}" style="text-decoration:none;"><img src="${SITE_URL}/logo-email.png" alt="Community Carpool" style="height:56px;width:auto;display:block;margin:0 auto;" /></a></div>
  <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <h2 style="color:#f59e0b;margin:0 0 12px;">⚡ Someone is interested!</h2>
    <p style="color:#6b7280;margin:0 0 20px;">Your Journey #${sub.journey_num} (${sub.from_location} → ${sub.to_location}) is currently inactive, but someone on your route has expressed interest.</p>
    <div style="text-align:center;margin-bottom:24px;"><a href="${SITE_URL}/matches.html?token=${sub.users.match_page_token}&journey=${sub.submission_id}" style="display:inline-block;background:#f59e0b;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View &amp; Reactivate &#x2192;</a></div>
    <!-- Journey Tracker — Step 2 active -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td style="border-top:1px solid #E5E7EB;padding-bottom:16px;"></td></tr></table>
    <div style="font-size:11px;font-weight:700;color:#1B5C3A;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;">Your Carpool Status</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
      <tr>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#1B5C3A;color:#fff;font-size:13px;font-weight:700;line-height:28px;margin:0 auto 4px;">&#10003;</div><div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;line-height:1.3;word-break:break-word;">Joined the Pool</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#1B5C3A;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#B4E035;color:#1B5C3A;font-size:12px;font-weight:900;line-height:28px;margin:0 auto 4px;border:2px solid #1B5C3A;">2</div><div style="font-size:9px;color:#1B5C3A;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Matched</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">3</div><div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Connected</div></td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
        <td align="center" width="20%"><div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">4</div><div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Carpooling!</div></td>
      </tr>
    </table>
  </div>
  <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">Know someone who commutes the same way?</p>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">The more people in your area sign up, the better the matches get.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/whatsapp.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/whatsapp.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/facebook.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/facebook.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/twitter.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/twitter.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="X" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/linkedin.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/linkedin.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/sms.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/sms.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
    </tr></table>
  </div>
  <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:14px;">
    <p style="margin:0 0 6px;"><a href="${SITE_URL}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;<a href="${SITE_URL}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;<a href="${SITE_URL}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;<a href="${SITE_URL}/unsubscribe.html?token=${sub.users.match_page_token}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;<a href="${SITE_URL}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a></p>
  </div>
</div></body></html>`

          await sendEmail(sub.users.email, 'Someone is interested in your archived journey!', html)
          await supabase.from('submissions').update({ interest_nudge_sent_at: now.toISOString() }).eq('submission_id', sub.submission_id)
          await supabase.from('events').insert({ event_type: 'interest_nudge_sent', submission_id: sub.submission_id })
        } catch (e) { console.error('Interest nudge failed:', e) }
      }
    }

    return new Response(JSON.stringify({ success: true, expiredCount, nudgesSent }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
