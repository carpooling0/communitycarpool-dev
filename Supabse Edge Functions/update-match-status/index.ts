import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

// ── Send WhatsApp template via Meta Cloud API ────────────────────────────────
async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  bodyParams: Array<{ parameter_name: string; text: string }>,
  buttonToken?: string
): Promise<void> {
  const accessToken   = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  if (!accessToken || !phoneNumberId)
    throw new Error('WhatsApp secrets not configured')

  const components: any[] = [{
    type: 'body',
    parameters: bodyParams.map(p => ({ type: 'text', parameter_name: p.parameter_name, text: p.text })),
  }]
  if (buttonToken) {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: buttonToken }] })
  }

  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: { name: templateName, language: { code: 'en' }, components },
    }),
  })
  if (!res.ok) throw new Error(`WhatsApp API error ${res.status}: ${await res.text()}`)
}

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
    <!-- Journey Tracker — Step 2 active -->
    <div style="background:white;border-radius:12px;padding:16px 20px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <div style="font-size:11px;font-weight:700;color:#1B5C3A;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;">Your Carpool Status</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
        <tr>
          <td align="center" width="20%">
            <div style="width:28px;height:28px;border-radius:50%;background:#1B5C3A;color:#fff;font-size:13px;font-weight:700;line-height:28px;margin:0 auto 4px;">&#10003;</div>
            <div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;line-height:1.3;word-break:break-word;">Joined the Pool</div>
          </td>
          <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#1B5C3A;"></div></td>
          <td align="center" width="20%">
            <div style="width:28px;height:28px;border-radius:50%;background:#B4E035;color:#1B5C3A;font-size:12px;font-weight:900;line-height:28px;margin:0 auto 4px;border:2px solid #1B5C3A;">2</div>
            <div style="font-size:9px;color:#1B5C3A;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Matched</div>
          </td>
          <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
          <td align="center" width="20%">
            <div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">3</div>
            <div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Connected</div>
          </td>
          <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
          <td align="center" width="20%">
            <div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">4</div>
            <div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Carpooling!</div>
          </td>
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
    <div style="text-align:center;margin-top:22px;color:#9ca3af;font-size:13px;">
      <p style="margin:0 0 6px;">
        <a href="${SITE_URL}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/unsubscribe.html?token=${myToken}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a>
      </p>
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
    <!-- Journey Tracker — Step 3 active -->
    <div style="background:white;border-radius:12px;padding:16px 20px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <div style="font-size:11px;font-weight:700;color:#1B5C3A;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;">Your Carpool Status</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
        <tr>
          <td align="center" width="20%">
            <div style="width:28px;height:28px;border-radius:50%;background:#1B5C3A;color:#fff;font-size:13px;font-weight:700;line-height:28px;margin:0 auto 4px;">&#10003;</div>
            <div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;line-height:1.3;word-break:break-word;">Joined the Pool</div>
          </td>
          <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#1B5C3A;"></div></td>
          <td align="center" width="20%">
            <div style="width:28px;height:28px;border-radius:50%;background:#1B5C3A;color:#fff;font-size:13px;font-weight:700;line-height:28px;margin:0 auto 4px;">&#10003;</div>
            <div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Matched</div>
          </td>
          <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#1B5C3A;"></div></td>
          <td align="center" width="20%">
            <div style="width:28px;height:28px;border-radius:50%;background:#B4E035;color:#1B5C3A;font-size:12px;font-weight:900;line-height:28px;margin:0 auto 4px;border:2px solid #1B5C3A;">3</div>
            <div style="font-size:9px;color:#1B5C3A;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Connected</div>
          </td>
          <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#D1FAE5;"></div></td>
          <td align="center" width="20%">
            <div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">4</div>
            <div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Carpooling!</div>
          </td>
        </tr>
      </table>
    </div>
    <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">Know someone who commutes the same way?</p>
      <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">The more people in your area sign up, the better the matches get.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
        <td style="padding:0 5px;"><a href="${SITE_URL}/share/whatsapp.html" style="text-decoration:none;"><img src="https://communitycarpool.org/email-icons/whatsapp.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
        <td style="padding:0 5px;"><a href="${SITE_URL}/share/facebook.html" style="text-decoration:none;"><img src="https://communitycarpool.org/email-icons/facebook.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
        <td style="padding:0 5px;"><a href="${SITE_URL}/share/x.html" style="text-decoration:none;"><img src="https://communitycarpool.org/email-icons/twitter.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="X / Twitter" /></a></td>
        <td style="padding:0 5px;"><a href="${SITE_URL}/share/linkedin.html" style="text-decoration:none;"><img src="https://communitycarpool.org/email-icons/linkedin.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
        <td style="padding:0 5px;"><a href="${SITE_URL}/share/sms.html" style="text-decoration:none;"><img src="https://communitycarpool.org/email-icons/sms.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
      </tr></table>
    </div>
    <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:14px;">
      <p style="margin:0 0 6px;">
        <a href="${SITE_URL}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/unsubscribe.html?token=${myToken}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;
        <a href="${SITE_URL}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a>
      </p>
    </div>
  </div></body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (req.method === 'GET') {
    const url = new URL(req.url)
    const testTo = url.searchParams.get('test_to')
    const type = url.searchParams.get('type') || 'interest'
    if (testTo) {
      if (type === 'mutual') {
        const html = buildMutualEmail('Alex', 'Jordan', 'jordan@example.com', 'Dubai Marina', 'Dubai International Financial Centre (DIFC)', 'preview-token-000', 0)
        await sendEmail(testTo, '🎉 You have a mutual match! Contact details revealed', html)
      } else {
        const html = buildImmediateInterestEmail('Alex', 'Dubai Marina', 'Dubai International Financial Centre (DIFC)', 'preview-token-000', 0)
        await sendEmail(testTo, 'Someone Just Said YES to Your Match!', html)
      }
      return new Response(JSON.stringify({ preview: true, to: testTo, type }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
  }

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
      sub_a:submissions!sub_a_id (submission_id, user_id, journey_num, from_location, to_location, journey_status, whatsapp_number, whatsapp_verification_status, users(name, email, match_page_token, email_whitelist, email_bounced, unsubscribed_matches, unsubscribed_whatsapp, deletion_requested_at)),
      sub_b:submissions!sub_b_id (submission_id, user_id, journey_num, from_location, to_location, journey_status, whatsapp_number, whatsapp_verification_status, users(name, email, match_page_token, email_whitelist, email_bounced, unsubscribed_matches, unsubscribed_whatsapp, deletion_requested_at))
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

            // WhatsApp nudge
            const waMatchesEnabled = (await supabase.from('config').select('value').eq('key', 'whatsapp_matches_notification_enabled').single()).data?.value === 'true'
            if (waMatchesEnabled && otherSub.whatsapp_number && otherSub.whatsapp_verification_status === 'whatsapp_verified' && !otherUser.unsubscribed_whatsapp) {
              try {
                await sendWhatsAppTemplate(
                  otherSub.whatsapp_number,
                  'whatsapp_interest_expressed_cc',
                  [
                    { parameter_name: 'first_name',    text: otherUser.name },
                    { parameter_name: 'from_location', text: otherSub.from_location },
                    { parameter_name: 'to_location',   text: otherSub.to_location },
                  ],
                  otherUser.match_page_token
                )
              } catch (waErr: any) {
                console.error('[WA] YES nudge failed:', waErr.message)
              }
            }

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
          // WhatsApp mutual match notifications
          const waMatchesEnabled2 = (await supabase.from('config').select('value').eq('key', 'whatsapp_matches_notification_enabled').single()).data?.value === 'true'
          if (waMatchesEnabled2) {
            for (const [sub, user] of [[subA, userA], [subB, userB]] as any) {
              if (sub.whatsapp_number && sub.whatsapp_verification_status === 'whatsapp_verified' && !user.unsubscribed_whatsapp) {
                try {
                  await sendWhatsAppTemplate(
                    sub.whatsapp_number,
                    'whatsapp_mutual_match_cc',
                    [
                      { parameter_name: 'first_name',    text: user.name },
                      { parameter_name: 'from_location', text: sub.from_location },
                      { parameter_name: 'to_location',   text: sub.to_location },
                    ],
                    user.match_page_token
                  )
                } catch (waErr: any) {
                  console.error('[WA] Mutual match failed:', waErr.message)
                }
              }
            }
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
