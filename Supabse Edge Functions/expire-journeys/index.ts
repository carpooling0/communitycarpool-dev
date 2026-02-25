import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SESClient, SendEmailCommand } from "https://esm.sh/@aws-sdk/client-ses@3"

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = 'https://communitycarpool.org'
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

// Lazy SES init — only instantiated when actually needed (avoids 502 on cold start if secrets missing)
function getSES(): SESClient {
  return new SESClient({
    region: Deno.env.get('AWS_REGION')!,
    credentials: {
      accessKeyId: Deno.env.get('AWS_ACCESS_KEY_ID')!,
      secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY')!
    }
  })
}

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
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

      // name and email live on users table, not submissions
      const { data: nudgeJourneys } = await supabase.from('submissions')
        .select('submission_id, journey_num, from_location, to_location, expires_at, users!inner(name, email, match_page_token)')
        .eq('journey_status', 'active').lt('expires_at', nudgeDate.toISOString())
        .gt('expires_at', now.toISOString()).is('expiry_nudge_sent_at', null)

      const ses = getSES()
      const FROM_EMAIL = Deno.env.get('SES_FROM_EMAIL')!

      for (const sub of nudgeJourneys || []) {
        try {
          const expiryDate = new Date(sub.expires_at).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dubai' })
          const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
            <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
              <div style="text-align:center;margin-bottom:32px;"><h1 style="color:#16a34a;">🚗 Community Carpool</h1></div>
              <div style="background:white;border-radius:16px;padding:32px;">
                <h2 style="color:#111827;">Hi ${sub.users.name}!</h2>
                <p style="color:#6b7280;">Your Journey #${sub.journey_num} (${sub.from_location} → ${sub.to_location}) will expire on <strong>${expiryDate}</strong>.</p>
                <p style="color:#6b7280;">Are you still commuting this route? If so, no action needed. If not, you can deactivate it from your matches page.</p>
                <a href="${SITE_URL}/matches.html?token=${sub.users.match_page_token}" style="display:inline-block;background:#16a34a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;">View My Journeys</a>
              </div>
              <div style="text-align:center;margin-top:24px;font-size:13px;">
                <a href="${SITE_URL}/unsubscribe.html?token=${sub.users.match_page_token}" style="color:#6b7280;">Unsubscribe</a>
              </div>
            </div></body></html>`

          await ses.send(new SendEmailCommand({
            Source: `Community Carpool <${FROM_EMAIL}>`,
            Destination: { ToAddresses: [sub.users.email] },
            Message: { Subject: { Data: `Your journey expires on ${expiryDate} — still commuting?` }, Body: { Html: { Data: html } } }
          }))
          await supabase.from('submissions').update({ expiry_nudge_sent_at: now.toISOString() }).eq('submission_id', sub.submission_id)
          await supabase.from('events').insert({ event_type: 'expiry_nudge_sent', submission_id: sub.submission_id })
          nudgesSent++
        } catch (e) { console.error('Nudge failed:', e) }
      }
    }

    // 3. Interest nudge for inactive journeys
    if (await getConfig('interest_nudge_enabled') === 'true') {
      // name and email live on users table, not submissions
      const { data: inactiveWithInterest } = await supabase.from('submissions')
        .select('submission_id, journey_num, from_location, to_location, users!inner(name, email, match_page_token)')
        .eq('journey_status', 'inactive_with_interest').is('interest_nudge_sent_at', null)

      const ses = getSES()
      const FROM_EMAIL = Deno.env.get('SES_FROM_EMAIL')!

      for (const sub of inactiveWithInterest || []) {
        try {
          const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
            <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
              <div style="text-align:center;margin-bottom:32px;"><h1 style="color:#16a34a;">🚗 Community Carpool</h1></div>
              <div style="background:white;border-radius:16px;padding:32px;">
                <h2 style="color:#f59e0b;">⚡ Someone is interested!</h2>
                <p style="color:#6b7280;">Your Journey #${sub.journey_num} (${sub.from_location} → ${sub.to_location}) is currently inactive, but someone on your route has expressed interest.</p>
                <a href="${SITE_URL}/matches.html?token=${sub.users.match_page_token}&journey=${sub.submission_id}" style="display:inline-block;background:#f59e0b;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500;">View & Reactivate</a>
              </div>
              <div style="text-align:center;margin-top:24px;font-size:13px;">
                <a href="${SITE_URL}/unsubscribe.html?token=${sub.users.match_page_token}" style="color:#6b7280;">Unsubscribe</a>
              </div>
            </div></body></html>`

          await ses.send(new SendEmailCommand({
            Source: `Community Carpool <${FROM_EMAIL}>`,
            Destination: { ToAddresses: [sub.users.email] },
            Message: { Subject: { Data: 'Someone is interested in your archived journey!' }, Body: { Html: { Data: html } } }
          }))
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
