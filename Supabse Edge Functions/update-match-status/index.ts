import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
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

function buildImmediateInterestEmail(
  recipientName: string,
  fromLocation: string,
  toLocation: string,
  myToken: string,
  mySubmissionId: number
): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${SITE_URL}" style="text-decoration:none;">
        <img src="${SITE_URL}/logo-email.png" alt="Community Carpool" style="height:56px;width:auto;display:block;margin:0 auto;" />
      </a>
    </div>
    <div style="background:white;border-radius:16px;padding:28px 28px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
      <div style="text-align:center;margin-bottom:20px;">
        <h2 style="color:#111827;font-size:24px;margin:0 0 8px;">Someone Just Said YES to Your Match!</h2>
        <p style="color:#4b5563;margin:0;font-size:15px;line-height:1.6;">Hi ${recipientName}. Someone just said YES to carpooling with you and is waiting for your response.</p>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;margin-bottom:18px;">
        <div style="font-weight:700;color:#111827;margin-bottom:10px;font-size:14px;">Your route</div>
        <div style="font-size:14px;color:#374151;margin-bottom:4px;"><span style="color:#16a34a;">●</span>&nbsp;${fromLocation}</div>
        <div style="font-size:12px;color:#9ca3af;margin:0 0 4px 8px;">↓</div>
        <div style="font-size:14px;color:#374151;"><span style="color:#dc2626;">●</span>&nbsp;${toLocation}</div>
      </div>
      <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 18px;background:#f9fafb;border-radius:8px;padding:10px 12px;">
        <strong>Privacy First.</strong> Contact details are only shared once both of you say yes.
      </p>
      <div style="text-align:center;">
        <a href="${SITE_URL}/matches.html?token=${myToken}&journey=${mySubmissionId}" style="display:inline-block;background:#10b981;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">Respond to My Match →</a>
      </div>
    </div>
    <div style="text-align:center;margin-top:22px;color:#9ca3af;font-size:12px;">
      <p style="margin:0 0 6px;">
        <a href="${SITE_URL}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/unsubscribe.html?token=${myToken}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a>
      </p>
      <p style="margin:0;">Community Carpool &middot; communitycarpool.org</p>
    </div>
  </div></body></html>`
}

// ── Build mutual match email HTML for one recipient ──
function buildMutualEmail(recipientName: string, otherName: string, otherEmail: string, otherFrom: string, otherTo: string, myToken: string, mySubmissionId: number): string {
  const shareUrl = SITE_URL
  const shareWA  = encodeURIComponent(`Hey! I just signed up on CommunityCarpool.org to find carpooling partners for my commute.\n\nIt matches neighbors going the same route — completely FREE, No Cookies, No App, and you only connect when both sides are interested. Everything over email.\n\nThe more people sign up in our area, the better the matches get. Takes 30 seconds!\n${shareUrl}`)
  const shareTW  = encodeURIComponent(`Just joined communitycarpool.org to find carpooling neighbors on my route. Free, no app, email-only. The more locals sign up, the better the matches! Check it out 👇\n${shareUrl}`)
  const shareFB  = encodeURIComponent(shareUrl)
  const shareLI  = encodeURIComponent(shareUrl)
  const shareSMS = shareWA  // Same message as WhatsApp
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <a href="${SITE_URL}" style="text-decoration:none;">
        <img src="${SITE_URL}/logo-email.png" alt="Community Carpool" style="height:64px;width:auto;display:block;margin:0 auto;" />
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
        <a href="${SITE_URL}/matches.html?token=${myToken}&journey=${mySubmissionId}" style="display:inline-block;background:#16a34a;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View My Matches &#x2192;</a>
      </div>
    </div>
    <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">Know someone who commutes the same way?</p>
      <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">The more people in your area sign up, the better the matches get.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
        <td style="padding:0 5px;"><a href="https://wa.me/?text=${shareWA}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2236%22%20height%3D%2236%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%2325d366%22%2F%3E%3Cg%20transform%3D%22translate%289%2C9%29%20scale%280.75%29%22%3E%3Cpath%20d%3D%22M17.472%2014.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94%201.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198%200-.52.074-.792.372-.272.297-1.04%201.016-1.04%202.479%200%201.462%201.065%202.875%201.213%203.074.149.198%202.096%203.2%205.077%204.487.709.306%201.262.489%201.694.625.712.227%201.36.195%201.871.118.571-.085%201.758-.719%202.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z%22%20fill%3D%22white%22%2F%3E%3Cpath%20d%3D%22M12%200C5.373%200%200%205.373%200%2012c0%202.136.562%204.14%201.542%205.874L0%2024l6.294-1.542A11.94%2011.94%200%200012%2024c6.627%200%2012-5.373%2012-12S18.627%200%2012%200zm0%2021.818a9.818%209.818%200%2001-5.006-1.374l-.36-.214-3.732.914.93-3.617-.234-.373A9.818%209.818%200%20012.182%2012C2.182%206.57%206.57%202.182%2012%202.182S21.818%206.57%2021.818%2012%2017.43%2021.818%2012%2021.818z%22%20fill%3D%22white%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
        <td style="padding:0 5px;"><a href="https://www.facebook.com/sharer/sharer.php?u=${shareFB}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2236%22%20height%3D%2236%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%231877F2%22%2F%3E%3Cg%20transform%3D%22translate%289%2C9%29%20scale%280.75%29%22%3E%3Cpath%20d%3D%22M24%2012.073c0-6.627-5.373-12-12-12s-12%205.373-12%2012c0%205.99%204.388%2010.954%2010.125%2011.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007%201.792-4.669%204.533-4.669%201.312%200%202.686.235%202.686.235v2.953H15.83c-1.491%200-1.956.925-1.956%201.874v2.25h3.328l-.532%203.47h-2.796v8.385C19.612%2023.027%2024%2018.062%2024%2012.073z%22%20fill%3D%22white%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
        <td style="padding:0 5px;"><a href="https://x.com/intent/tweet?text=${shareTW}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2236%22%20height%3D%2236%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%23000000%22%2F%3E%3Cg%20transform%3D%22translate%289%2C9%29%20scale%280.75%29%22%3E%3Cpath%20d%3D%22M18.244%202.25h3.308l-7.227%208.26%208.502%2011.24H16.17l-4.714-6.231-5.401%206.231H2.747l7.73-8.835L1.254%202.25H8.08l4.253%205.622%205.91-5.622zm-1.161%2017.52h1.833L7.084%204.126H5.117z%22%20fill%3D%22white%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Twitter / X" /></a></td>
        <td style="padding:0 5px;"><a href="https://www.linkedin.com/shareArticle?mini=true&url=${shareLI}&title=${encodeURIComponent('Free carpooling for your commute')}&summary=${encodeURIComponent('Just joined communitycarpool.org to find carpooling neighbors on my route. Free, no app, everything over email.')}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2236%22%20height%3D%2236%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%230A66C2%22%2F%3E%3Cg%20transform%3D%22translate%289%2C9%29%20scale%280.75%29%22%3E%3Cpath%20d%3D%22M20.447%2020.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853%200-2.136%201.445-2.136%202.939v5.667H9.351V9h3.414v1.561h.046c.477-.9%201.637-1.85%203.37-1.85%203.601%200%204.267%202.37%204.267%205.455v6.286zM5.337%207.433a2.062%202.062%200%2001-2.063-2.065%202.064%202.064%200%20112.063%202.065zm1.782%2013.019H3.555V9h3.564v11.452zM22.225%200H1.771C.792%200%200%20.774%200%201.729v20.542C0%2023.227.792%2024%201.771%2024h20.451C23.2%2024%2024%2023.227%2024%2022.271V1.729C24%20.774%2023.2%200%2022.222%200h.003z%22%20fill%3D%22white%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
        <td style="padding:0 5px;"><a href="sms:?body=${shareSMS}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2236%22%20height%3D%2236%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%2322c55e%22%2F%3E%3Cpath%20d%3D%22M9%2011a2%202%200%200%201%202-2h14a2%202%200%200%201%202%202v9a2%202%200%200%201-2%202h-5l-4%203v-3h-5a2%202%200%200%201-2-2v-9z%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
      </tr></table>
    </div>
    <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:13px;">
      <p style="margin:0 0 6px;">
        <a href="${SITE_URL}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/unsubscribe.html?token=${myToken}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a>
      </p>
      <p style="margin:0;">Community Carpool &middot; communitycarpool.org</p>
    </div>
  </div></body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { token, action, matchId, submissionId, interest, termsVersion } = await req.json()

    const { data: user, error: userError } = await supabase.from('users')
      .select('user_id, name, email').eq('match_page_token', token).single()
    if (userError || !user) return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 })

    // ── Accept updated Terms & Conditions ─────────────────────────────────────
    if (action === 'accept_terms') {
      if (!termsVersion) return new Response(JSON.stringify({ success: false, error: 'termsVersion required' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
      await supabase.from('users').update({ terms_accepted_version: termsVersion, terms_accepted_at: new Date().toISOString() }).eq('user_id', user.user_id)
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: match } = await supabase.from('matches').select(`
      match_id, status, sub_a_id, sub_b_id, interest_a, interest_b,
      sub_a:submissions!sub_a_id (submission_id, user_id, journey_num, from_location, to_location, journey_status, users(name, email, match_page_token, email_whitelist, email_bounced, unsubscribed_matches, deletion_requested_at)),
      sub_b:submissions!sub_b_id (submission_id, user_id, journey_num, from_location, to_location, journey_status, users(name, email, match_page_token, email_whitelist, email_bounced, unsubscribed_matches, deletion_requested_at))
    `).eq('match_id', matchId).single()

    if (!match) return new Response(JSON.stringify({ success: false, error: 'Match not found' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 })

    const isSubA = match.sub_a.submission_id === submissionId
    const mySub = isSubA ? match.sub_a : match.sub_b
    const otherSub = isSubA ? match.sub_b : match.sub_a
    const myExistingInterest = isSubA ? match.interest_a : match.interest_b

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
    const interestAtField = isSubA ? 'interest_a_at' : 'interest_b_at'
    // is_mutual_click is sticky — only ever set to true, never explicitly reset to false
    // (resetting it caused the flag to wipe if a user later undid their interest)
    const matchUpdatePayload: Record<string, any> = {
      [myInterestField]: interestValue,
      [interestAtField]: interestValue !== null ? new Date().toISOString() : null,
      status: newStatus
    }
    if (newStatus === 'mutual_confirmed') matchUpdatePayload.is_mutual_click = true
    await supabase.from('matches').update(matchUpdatePayload).eq('match_id', matchId)

    // If I expressed interest and the other side's journey is inactive, flag it so
    // the UI can nudge them to reactivate ("someone's interested in your archived journey")
    if (interest === 'yes' && otherSub.journey_status !== 'active') {
      await supabase.from('submissions').update({ interest_while_inactive: true }).eq('submission_id', otherSub.submission_id)
    }
    // If I reset my interest and was the one who triggered the flag, clear it
    if (interest === 'reset' && mySub.journey_status !== 'active') {
      await supabase.from('submissions').update({ interest_while_inactive: false }).eq('submission_id', mySub.submission_id)
    }

    await supabase.from('events').insert({
      event_type: interest === 'yes' ? 'match_interest_expressed' : interest === 'reset' ? 'match_interest_reset' : 'match_declined',
      user_id: user.user_id, submission_id: submissionId, match_id: matchId,
      metadata: { interest, other_submission_id: otherSub.submission_id }
    })

    const shouldSendImmediateYesNudge =
      interest === 'yes' &&
      myExistingInterest !== 'yes' &&
      !otherInterest &&
      otherSub.journey_status === 'active'

    if (shouldSendImmediateYesNudge) {
      ;(async () => {
        try {
          const { data: cfg } = await supabase.from('config').select('value').eq('key', 'testing_mode').single()
          const testingMode = cfg?.value !== 'false'
          const otherUser = otherSub.users
          const whitelisted = otherUser.email_whitelist === true

          if (
            !otherUser.email_bounced &&
            !otherUser.unsubscribed_matches &&
            !otherUser.deletion_requested_at &&
            (!testingMode || whitelisted)
          ) {
            const html = buildImmediateInterestEmail(
              otherUser.name,
              otherSub.from_location,
              otherSub.to_location,
              otherUser.match_page_token,
              otherSub.submission_id
            )
            await sendEmail(otherUser.email, 'Someone Just Said YES to Your Match!', html)
            await supabase.from('events').insert({
              event_type: 'interest_yes_nudge_sent',
              user_id: otherSub.user_id,
              submission_id: otherSub.submission_id,
              match_id: matchId,
              metadata: { recipient: otherUser.email, triggered_by_submission_id: submissionId }
            })
          }
        } catch (emailErr: any) {
          console.error('Immediate YES email failed:', emailErr.message)
          await supabase.from('events').insert({
            event_type: 'interest_yes_nudge_failed',
            submission_id: otherSub.submission_id,
            match_id: matchId,
            metadata: { error: emailErr.message, triggered_by_submission_id: submissionId }
          })
        }
      })()
    }

    // Capture isMutual BEFORE overwriting newStatus — response must reflect the final DB state
    const isMutual = newStatus === 'mutual_confirmed'

    // Handle mutual match — reveal contacts and send email to both users
    if (isMutual) {
      newStatus = 'contact_revealed'
      await supabase.from('matches').update({ status: 'contact_revealed' }).eq('match_id', matchId)
      await supabase.from('events').insert([
        { event_type: 'mutual_match_confirmed', user_id: user.user_id, submission_id: submissionId, match_id: matchId },
        { event_type: 'contact_details_revealed', user_id: user.user_id, submission_id: submissionId, match_id: matchId }
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
          if ((!testingMode || aWhitelisted) && !userA.email_bounced) {
            const htmlA = buildMutualEmail(
              userA.name, userB.name, userB.email,
              subB.from_location, subB.to_location,
              userA.match_page_token,
              subA.submission_id
            )
            await sendEmail(userA.email, '🎉 You have a mutual match! Contact details revealed', htmlA)
            supabase.from('events').insert({ event_type: 'mutual_match_email_sent', match_id: matchId, metadata: { recipient: userA.email } })
          }

          // Send to user B (about user A)
          const bWhitelisted = userB.email_whitelist === true
          if ((!testingMode || bWhitelisted) && !userB.email_bounced) {
            const htmlB = buildMutualEmail(
              userB.name, userA.name, userA.email,
              subA.from_location, subA.to_location,
              userB.match_page_token,
              subB.submission_id
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
