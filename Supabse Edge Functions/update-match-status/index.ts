import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = 'https://communitycarpool.org'
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

// ── Email helper (same pattern as batch-send-emails — Resend preferred, SES fallback) ──
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

// ── Build mutual match email HTML for one recipient ──
function buildMutualEmail(recipientName: string, otherName: string, otherEmail: string, otherFrom: string, otherTo: string, myToken: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <a href="${SITE_URL}" style="text-decoration:none;">
        <img src="${SITE_URL}/logo_with slogan.png" alt="Community Carpool" style="height:64px;width:auto;display:block;margin:0 auto;" />
      </a>
    </div>
    <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:40px;margin-bottom:8px;">🎉</div>
        <h2 style="color:#111827;font-size:22px;margin:0 0 6px;">It&rsquo;s a mutual match!</h2>
        <p style="color:#6b7280;margin:0;font-size:14px;">Hi ${recipientName}! You and ${otherName} have both expressed interest in carpooling together.</p>
      </div>
      <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:20px;margin-bottom:24px;">
        <div style="font-weight:700;color:#111827;margin-bottom:12px;font-size:15px;">Their contact details</div>
        <div style="font-size:15px;color:#15803d;font-weight:600;margin-bottom:16px;">&#9993;&nbsp;${otherEmail}</div>
        <div style="font-weight:700;color:#111827;margin-bottom:10px;font-size:14px;">Their journey</div>
        <div style="font-size:14px;color:#374151;margin-bottom:4px;"><span style="color:#16a34a;font-size:12px;">&#9679;</span>&nbsp;${otherFrom}</div>
        <div style="font-size:13px;color:#9ca3af;margin:0 0 4px 6px;">&#8595;</div>
        <div style="font-size:14px;color:#374151;"><span style="color:#dc2626;font-size:12px;">&#9679;</span>&nbsp;${otherTo}</div>
      </div>
      <div style="text-align:center;">
        <a href="${SITE_URL}/matches.html?token=${myToken}" style="display:inline-block;background:#16a34a;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View My Matches &#x2192;</a>
      </div>
    </div>
    <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:13px;">
      <p><a href="${SITE_URL}/unsubscribe.html?token=${myToken}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a></p>
      <p style="margin:6px 0 0;">Community Carpool &middot; communitycarpool.org</p>
    </div>
  </div></body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { token, matchId, submissionId, interest } = await req.json()

    const { data: user, error: userError } = await supabase.from('users')
      .select('user_id, name, email').eq('match_page_token', token).single()
    if (userError || !user) return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 })

    const { data: match } = await supabase.from('matches').select(`
      match_id, status, sub_a_id, sub_b_id, interest_a, interest_b,
      sub_a:submissions!sub_a_id (submission_id, user_id, journey_num, from_location, to_location, users(name, email, match_page_token, email_whitelist)),
      sub_b:submissions!sub_b_id (submission_id, user_id, journey_num, from_location, to_location, users(name, email, match_page_token, email_whitelist))
    `).eq('match_id', matchId).single()

    if (!match) return new Response(JSON.stringify({ success: false, error: 'Match not found' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 })

    const isSubA = match.sub_a.submission_id === submissionId
    const mySub = isSubA ? match.sub_a : match.sub_b
    const otherSub = isSubA ? match.sub_b : match.sub_a

    if (mySub.user_id !== user.user_id) return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 })

    // Check if other side already declined
    const otherInterest = isSubA ? match.interest_b : match.interest_a
    if (otherInterest === 'no' && interest !== 'reset') return new Response(JSON.stringify({ success: false, error: 'The other user has declined this match.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    // Determine new status
    const myInterestField = isSubA ? 'interest_a' : 'interest_b'
    let newStatus = match.status
    if (interest === 'reset') newStatus = 'notified'         // undo: clear interest, revert to unresponded
    else if (interest === 'no') newStatus = 'failed'
    else if (interest === 'yes' && otherInterest === 'yes') newStatus = 'mutual_confirmed'
    else if (interest === 'yes') newStatus = 'interest_expressed'

    const interestValue = interest === 'reset' ? null : interest
    await supabase.from('matches').update({ [myInterestField]: interestValue, status: newStatus, is_mutual_click: newStatus === 'mutual_confirmed' }).eq('match_id', matchId)

    await supabase.from('events').insert({
      event_type: interest === 'yes' ? 'match_interest_expressed' : interest === 'reset' ? 'match_interest_reset' : 'match_declined',
      user_id: user.user_id, submission_id: submissionId, match_id: matchId,
      metadata: { interest, other_submission_id: otherSub.submission_id }
    })

    // Capture isMutual BEFORE overwriting newStatus — response must reflect the final DB state
    const isMutual = newStatus === 'mutual_confirmed'

    // Handle mutual match — reveal contacts and send email to both users
    if (isMutual) {
      newStatus = 'contact_revealed'
      await supabase.from('matches').update({ status: 'contact_revealed' }).eq('match_id', matchId)
      await supabase.from('events').insert([
        { event_type: 'mutual_match_confirmed', user_id: user.user_id, match_id: matchId },
        { event_type: 'contact_details_revealed', match_id: matchId }
      ])

      // Send mutual match emails to both users — fire-and-forget (don't block response)
      ;(async () => {
        try {
          const { data: cfg } = await supabase.from('config').select('value').eq('key', 'testing_mode').single()
          const testingMode = cfg?.value !== 'false'

          const subA = match.sub_a
          const subB = match.sub_b
          const userA = subA.users
          const userB = subB.users

          // Send to user A (about user B)
          const aWhitelisted = userA.email_whitelist === true
          if (!testingMode || aWhitelisted) {
            const htmlA = buildMutualEmail(
              userA.name, userB.name, userB.email,
              subB.from_location, subB.to_location,
              userA.match_page_token
            )
            await sendEmail(userA.email, '🎉 You have a mutual match! Contact details revealed', htmlA)
            supabase.from('events').insert({ event_type: 'mutual_match_email_sent', match_id: matchId, metadata: { recipient: userA.email } })
          }

          // Send to user B (about user A)
          const bWhitelisted = userB.email_whitelist === true
          if (!testingMode || bWhitelisted) {
            const htmlB = buildMutualEmail(
              userB.name, userA.name, userA.email,
              subA.from_location, subA.to_location,
              userB.match_page_token
            )
            await sendEmail(userB.email, '🎉 You have a mutual match! Contact details revealed', htmlB)
            supabase.from('events').insert({ event_type: 'mutual_match_email_sent', match_id: matchId, metadata: { recipient: userB.email } })
          }
        } catch (emailErr: any) {
          console.error('Mutual match email failed:', emailErr.message)
          supabase.from('events').insert({ event_type: 'mutual_match_email_failed', match_id: matchId, metadata: { error: emailErr.message } })
        }
      })()
    }

    return new Response(JSON.stringify({ success: true, newStatus, isMutual }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
