import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

// Shared email helper — uses RESEND_API_KEY if set, falls back to AWS SES.
// Mirrors the same logic in batch-send-emails so both functions always use
// whatever provider is configured via the email_service config key.
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const sesKey = Deno.env.get('AWS_ACCESS_KEY_ID')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || Deno.env.get('SES_FROM_EMAIL') || ''

  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `Community Carpool <${fromEmail}>`, to: [to], subject, html })
    })
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`)
    return
  }

  if (sesKey) {
    const region = Deno.env.get('AWS_REGION') || 'us-east-1'
    const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY') || ''
    if (!secretAccessKey || !fromEmail) throw new Error('AWS SES secrets not fully configured')
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\\.\\d{3}/g, '').slice(0, 15) + 'Z'
    const dateStamp = amzDate.slice(0, 8)
    const body = new URLSearchParams({ 'Action': 'SendEmail', 'Source': `Community Carpool <${fromEmail}>`, 'Destination.ToAddresses.member.1': to, 'Message.Subject.Data': subject, 'Message.Subject.Charset': 'UTF-8', 'Message.Body.Html.Data': html, 'Message.Body.Html.Charset': 'UTF-8' }).toString()
    const host = `email.${region}.amazonaws.com`
    const encoder = new TextEncoder()
    const sign = async (key: ArrayBuffer, msg: string) => { const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return crypto.subtle.sign('HMAC', k, encoder.encode(msg)) }
    const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
    const sha256 = async (msg: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(msg)))
    const bodyHash = await sha256(body)
    const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:${host}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'content-type;host;x-amz-date'
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`
    const credentialScope = `${dateStamp}/${region}/ses/aws4_request`
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`
    const kDate = await sign(encoder.encode(`AWS4${sesKey}`), dateStamp)
    const kRegion = await sign(kDate, region)
    const kService = await sign(kRegion, 'ses')
    const kSigning = await sign(kService, 'aws4_request')
    const signature = hex(await sign(kSigning, stringToSign))
    const res = await fetch(`https://${host}/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Amz-Date': amzDate, 'Authorization': `AWS4-HMAC-SHA256 Credential=${sesKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}` }, body })
    if (!res.ok) throw new Error(`SES error ${res.status}: ${await res.text()}`)
    return
  }

  throw new Error('No email provider configured. Set RESEND_API_KEY or AWS SES secrets.')
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

      const { data: nudgeJourneys } = await supabase.from('submissions')
        .select('submission_id, journey_num, from_location, to_location, expires_at, users!inner(name, email, match_page_token)')
        .eq('journey_status', 'active').lt('expires_at', nudgeDate.toISOString())
        .gt('expires_at', now.toISOString()).is('expiry_nudge_sent_at', null)

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
