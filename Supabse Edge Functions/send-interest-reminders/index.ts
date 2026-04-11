import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const sesKey    = Deno.env.get('AWS_ACCESS_KEY_ID')
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

  throw new Error('No email provider configured.')
}

// ── CO2 calculator ─────────────────────────────────────────────────────────────
function calcTrees(distanceKm: number): number | null {
  if (!distanceKm || distanceKm <= 0) return null
  const roundTripKm     = distanceKm * 2
  const workingDays     = 250        // ~50 working weeks/year
  const co2GramsPerKm   = 120        // avg petrol car
  const co2PerTreeGrams = 10_000     // 10 kg/year (conservative)
  return Math.round(roundTripKm * workingDays * co2GramsPerKm / co2PerTreeGrams)
}

// ── Shared social share icons ─────────────────────────────────────────────────
function buildShareBlock(shareUrl: string): string {
  const shareWA  = encodeURIComponent(`Hey! I'm on CommunityCarpool.org — it matches neighbours going the same route for free carpooling. No app, no cookies, everything over email. The more people in your area sign up, the better the matches get. Takes 30 seconds!\n${shareUrl}`)
  const shareTW  = encodeURIComponent(`Just joined communitycarpool.org to find carpooling neighbours on my route. Free, no app, email-only. The more locals sign up, the better the matches!\n${shareUrl}`)
  const shareFB  = encodeURIComponent(shareUrl)
  const shareLI  = encodeURIComponent(shareUrl)
  const shareSMS = shareWA
  return `
    <div style="border-radius:10px;padding:14px 16px;text-align:center;border:1px solid #E5E7EB;">
      <p style="color:#1F2937;font-size:14px;font-weight:700;margin:0 0 4px;font-family:Montserrat,Inter,sans-serif;">Know Someone Who Commutes the Same Way?</p>
      <p style="color:#6B7280;font-size:13px;margin:0 0 12px;">The more people in your area sign up, the better the matches get.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
        <td style="padding:0 4px;"><a href="https://wa.me/?text=${shareWA}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%2325d366%22%2F%3E%3Cg%20transform%3D%22translate%289%2C9%29%20scale%280.75%29%22%3E%3Cpath%20d%3D%22M17.472%2014.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94%201.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198%200-.52.074-.792.372-.272.297-1.04%201.016-1.04%202.479%200%201.462%201.065%202.875%201.213%203.074.149.198%202.096%203.2%205.077%204.487.709.306%201.262.489%201.694.625.712.227%201.36.195%201.871.118.571-.085%201.758-.719%202.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z%22%20fill%3D%22white%22%2F%3E%3Cpath%20d%3D%22M12%200C5.373%200%200%205.373%200%2012c0%202.136.562%204.14%201.542%205.874L0%2024l6.294-1.542A11.94%2011.94%200%200012%2024c6.627%200%2012-5.373%2012-12S18.627%200%2012%200zm0%2021.818a9.818%209.818%200%2001-5.006-1.374l-.36-.214-3.732.914.93-3.617-.234-.373A9.818%209.818%200%20012.182%2012C2.182%206.57%206.57%202.182%2012%202.182S21.818%206.57%2021.818%2012%2017.43%2021.818%2012%2021.818z%22%20fill%3D%22white%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E" width="32" height="32" style="display:block;border:0;" alt="WhatsApp" /></a></td>
        <td style="padding:0 4px;"><a href="https://www.facebook.com/sharer/sharer.php?u=${shareFB}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%231877F2%22%2F%3E%3Cg%20transform%3D%22translate%289%2C9%29%20scale%280.75%29%22%3E%3Cpath%20d%3D%22M24%2012.073c0-6.627-5.373-12-12-12s-12%205.373-12%2012c0%205.99%204.388%2010.954%2010.125%2011.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007%201.792-4.669%204.533-4.669%201.312%200%202.686.235%202.686.235v2.953H15.83c-1.491%200-1.956.925-1.956%201.874v2.25h3.328l-.532%203.47h-2.796v8.385C19.612%2023.027%2024%2018.062%2024%2012.073z%22%20fill%3D%22white%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E" width="32" height="32" style="display:block;border:0;" alt="Facebook" /></a></td>
        <td style="padding:0 4px;"><a href="https://x.com/intent/tweet?text=${shareTW}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%23000000%22%2F%3E%3Cg%20transform%3D%22translate%289%2C9%29%20scale%280.75%29%22%3E%3Cpath%20d%3D%22M18.244%202.25h3.308l-7.227%208.26%208.502%2011.24H16.17l-4.714-6.231-5.401%206.231H2.747l7.73-8.835L1.254%202.25H8.08l4.253%205.622%205.91-5.622zm-1.161%2017.52h1.833L7.084%204.126H5.117z%22%20fill%3D%22white%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E" width="32" height="32" style="display:block;border:0;" alt="X / Twitter" /></a></td>
        <td style="padding:0 4px;"><a href="https://www.linkedin.com/shareArticle?mini=true&url=${shareLI}&title=${encodeURIComponent('Free carpooling for your commute')}&summary=${encodeURIComponent('Just joined communitycarpool.org to find carpooling neighbours on my route. Free, no app, everything over email.')}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%230A66C2%22%2F%3E%3Cg%20transform%3D%22translate%289%2C9%29%20scale%280.75%29%22%3E%3Cpath%20d%3D%22M20.447%2020.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853%200-2.136%201.445-2.136%202.939v5.667H9.351V9h3.414v1.561h.046c.477-.9%201.637-1.85%203.37-1.85%203.601%200%204.267%202.37%204.267%205.455v6.286zM5.337%207.433a2.062%202.062%200%2001-2.063-2.065%202.064%202.064%200%20112.063%202.065zm1.782%2013.019H3.555V9h3.564v11.452zM22.225%200H1.771C.792%200%200%20.774%200%201.729v20.542C0%2023.227.792%2024%201.771%2024h20.451C23.2%2024%2024%2023.227%2024%2022.271V1.729C24%20.774%2023.2%200%2022.222%200h.003z%22%20fill%3D%22white%22%2F%3E%3C%2Fg%3E%3C%2Fsvg%3E" width="32" height="32" style="display:block;border:0;" alt="LinkedIn" /></a></td>
        <td style="padding:0 4px;"><a href="sms:?body=${shareSMS}" style="text-decoration:none;"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2232%22%20height%3D%2232%22%20viewBox%3D%220%200%2036%2036%22%3E%3Crect%20width%3D%2236%22%20height%3D%2236%22%20rx%3D%229%22%20fill%3D%22%2322c55e%22%2F%3E%3Cpath%20d%3D%22M9%2011a2%202%200%200%201%202-2h14a2%202%200%200%201%202%202v9a2%202%200%200%201-2%202h-5l-4%203v-3h-5a2%202%200%200%201-2-2v-9z%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E" width="32" height="32" style="display:block;border:0;" alt="SMS" /></a></td>
      </tr></table>
    </div>`
}

// ── Email template ─────────────────────────────────────────────────────────────
// Brand: #1B5C3A dark forest green · #B4E035 chartreuse · #10B981 button green
// Fonts: Montserrat (headings, 700/900) · Inter (body)
function buildReminderEmail(
  recipientName: string,
  fromLocation: string,
  toLocation: string,
  distanceKm: number,
  token: string,
  submissionId: number,
  reminderNum: number
): string {
  const matchesUrl = `${SITE_URL}/matches.html?token=${token}&journey=${submissionId}`
  const isFollowUp = reminderNum > 1
  const trees      = calcTrees(distanceKm)

  const preheader = isFollowUp
    ? `Don't miss this — someone on your route is still hoping to connect.`
    : `Someone on your route wants to share the commute — and the running costs.`

  // Emoji inline-left, smaller; "You Have" not "You've"
  const heroHeading = isFollowUp
    ? `&#9200; Your Carpool Match Is Still Waiting&#8230;`
    : `&#127881; You Have a Carpool Match, ${recipientName}!`
  const heroSubtext = isFollowUp
    ? `You received a match request a few days ago and have not responded yet. Your potential carpool partner is still hoping to connect — don't let this one slip away!`
    : `Someone is interested in sharing your commute. One tap could change your daily routine — and what it costs you to get to work.`

  // Compact impact tiles — InitCap labels, no body text on fuel, "annually" on trees
  const impactBlock = `
    <div style="margin-bottom:14px;">
      <div style="font-weight:700;color:#1F2937;font-size:12px;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px;font-family:Montserrat,Inter,sans-serif;">Why It Matters</div>
      <div style="display:flex;gap:8px;">
        ${trees ? `
        <div style="flex:1;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 12px;text-align:center;">
          <div style="font-size:18px;margin-bottom:3px;">&#127795;</div>
          <div style="font-size:20px;font-weight:400;color:#1B5C3A;line-height:1;font-family:Montserrat,Inter,sans-serif;">${trees}</div>
          <div style="font-size:13px;color:#1B5C3A;margin-top:2px;font-weight:700;">Trees Worth of CO&#8322;</div>
          <div style="font-size:12px;color:#4b7c59;margin-top:2px;">Offset from your route annually</div>
        </div>` : ''}
        <div style="flex:1;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 12px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style="font-size:18px;margin-bottom:4px;">&#9981;</div>
          <div style="font-size:14px;font-weight:700;color:#92400e;font-family:Montserrat,Inter,sans-serif;">Beat Rising Fuel Costs</div>
        </div>
      </div>
    </div>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>You have a carpool match</title>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;900&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;">

<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;</div>

<div style="max-width:580px;margin:0 auto;padding:20px 16px;">

  <!-- Logo: hardcoded prod URL — works in all email clients regardless of env -->
  <div style="text-align:center;margin-bottom:16px;">
    <a href="https://communitycarpool.org" style="text-decoration:none;">
      <img src="https://communitycarpool.org/logo-slogan.png" alt="Community Carpool" style="height:48px;width:auto;display:block;margin:0 auto;" />
    </a>
  </div>

  <!-- Card -->
  <div style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.07);margin-bottom:12px;">

    <!-- Compact header — brand #1B5C3A, emoji inline-left -->
    <div style="background:#1B5C3A;padding:16px 20px 14px;">
      <h1 style="color:#FFFFFF;font-size:22px;font-weight:900;margin:0 0 8px;line-height:1.3;font-family:Montserrat,-apple-system,sans-serif;">${heroHeading}</h1>
      <p style="color:#B4E035;font-size:14px;margin:0;line-height:1.6;">${heroSubtext}</p>
    </div>

    <!-- Body -->
    <div style="padding:16px 20px;">

      ${impactBlock}

      <!-- Compact route card -->
      <div style="margin-bottom:12px;">
        <div style="font-weight:700;color:#1F2937;font-size:12px;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;font-family:Montserrat,Inter,sans-serif;">Your Route</div>
        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <div style="width:8px;height:8px;border-radius:50%;background:#1B5C3A;flex-shrink:0;"></div>
            <div style="font-size:15px;color:#1F2937;font-weight:500;">${fromLocation}</div>
          </div>
          <div style="width:2px;height:10px;background:#B4E035;margin:0 0 0 3px;"></div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:0;">
            <div style="width:8px;height:8px;border-radius:50%;background:#dc2626;flex-shrink:0;"></div>
            <div style="font-size:15px;color:#1F2937;font-weight:500;">${toLocation}</div>
          </div>
        </div>
      </div>

      <!-- Privacy note -->
      <p style="color:#6B7280;font-size:13px;line-height:1.6;margin:0 0 14px;background:#F9FAFB;border-radius:6px;padding:9px 11px;">
        &#128274; <strong>Privacy First.</strong> We only share contact details once <em>both</em> of you say you are interested — no pressure, just a quick yes or no.
      </p>

      <!-- CTA — brand button #10B981, no "Takes less than a minute" -->
      <div style="text-align:center;margin-bottom:14px;">
        <a href="${matchesUrl}" style="display:inline-block;background:#10B981;color:#FFFFFF;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:17px;letter-spacing:0.01em;font-family:Montserrat,Inter,sans-serif;">
          View My Match &nbsp;&#x2192;
        </a>
      </div>

      ${buildShareBlock(SITE_URL)}

    </div>
  </div>

  <!-- Footer -->
  <div style="text-align:center;color:#9CA3AF;font-size:12px;padding:0 16px;">
    <p style="margin:0 0 5px;">
      <a href="${SITE_URL}/docs/" style="color:#6B7280;text-decoration:none;">Help &amp; FAQ</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/terms.html" style="color:#6B7280;text-decoration:none;">Terms</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/privacy.html" style="color:#6B7280;text-decoration:none;">Privacy</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/unsubscribe.html?token=${token}" style="color:#6B7280;text-decoration:none;">Unsubscribe</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/support.html" style="color:#6B7280;text-decoration:none;">Feedback</a>
    </p>
    <p style="margin:0;">Community Carpool &middot; communitycarpool.org</p>
  </div>

</div>
</body>
</html>`
}

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const url     = new URL(req.url)
    const testTo  = url.searchParams.get('test_to')
    const testNum = parseInt(url.searchParams.get('test_num') || '1')

    // Preview/test mode: ?test_to=email&test_num=1 (or 2)
    if (testTo) {
      const resendKey = Deno.env.get('RESEND_API_KEY')
      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''
      const html = buildReminderEmail(
        'Alex',
        'Dubai Marina',
        'Dubai International Financial Centre (DIFC)',
        22,
        'preview-token-000',
        0,
        testNum
      )
      const subject = testNum > 1
        ? `Your Carpool Match Is Still Waiting &#9200;`
        : `You Have a Carpool Match! &#127881;`
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `Community Carpool <${fromEmail}>`, to: [testTo], subject, html })
      })
      const body = await res.json()
      return new Response(JSON.stringify({ preview: true, reminder_num: testNum, to: testTo, resend: body }), {
        headers: { 'Content-Type': 'application/json' }, status: res.ok ? 200 : 500
      })
    }

    if (await getConfig('interest_reminder_enabled') !== 'true') {
      return new Response(JSON.stringify({ success: true, message: 'Interest reminders disabled' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const testingMode       = (await getConfig('testing_mode')) !== 'false'
    const firstReminderDays = parseInt(await getConfig('interest_reminder_days'))           || 3
    const intervalDays      = parseInt(await getConfig('interest_reminder_interval_days'))  || 4
    const maxReminders      = parseInt(await getConfig('interest_reminder_max'))            || 2
    const dailyLimit        = parseInt(await getConfig('resend_daily_limit'))               || 90

    const now = new Date()
    const firstCutoff = new Date(now)
    firstCutoff.setDate(firstCutoff.getDate() - firstReminderDays)

    const todayStart = new Date(now)
    todayStart.setUTCHours(0, 0, 0, 0)
    const { count: sentToday } = await supabase.from('email_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'email.sent')
      .eq('provider', 'resend')
      .gte('occurred_at', todayStart.toISOString())

    let quotaRemaining = dailyLimit - (sentToday || 0)
    if (quotaRemaining <= 0) {
      console.log(`[interest-reminder] Daily quota exhausted (${sentToday}/${dailyLimit}) — skipping`)
      return new Response(JSON.stringify({ success: true, message: 'Daily quota exhausted', sentToday, dailyLimit }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
    console.log(`[interest-reminder] Quota: ${sentToday} sent today, ${quotaRemaining} remaining`)

    const { data: matches, error } = await supabase.from('matches')
      .select(`
        match_id, interest_a, interest_b, interest_a_at, interest_b_at,
        interest_reminders_sent,
        sub_a:submissions!sub_a_id (
          submission_id, from_location, to_location, distance_km, journey_status,
          users(user_id, name, email, match_page_token, email_whitelist, unsubscribed_matches, email_bounced, deletion_requested_at)
        ),
        sub_b:submissions!sub_b_id (
          submission_id, from_location, to_location, distance_km, journey_status,
          users(user_id, name, email, match_page_token, email_whitelist, unsubscribed_matches, email_bounced, deletion_requested_at)
        )
      `)
      .eq('status', 'interest_expressed')

    if (error) throw error

    let remindersSent = 0, remindersSkipped = 0

    for (const match of matches || []) {
      let interestedSub: any, pendingSub: any, interestAt: string | null

      if (match.interest_a === 'yes' && !match.interest_b) {
        interestedSub = match.sub_a; pendingSub = match.sub_b; interestAt = match.interest_a_at
      } else if (match.interest_b === 'yes' && !match.interest_a) {
        interestedSub = match.sub_b; pendingSub = match.sub_a; interestAt = match.interest_b_at
      } else {
        continue
      }

      if (!interestAt || new Date(interestAt) > firstCutoff) continue

      const reminderHistory: string[] = Array.isArray(match.interest_reminders_sent)
        ? match.interest_reminders_sent : []

      if (reminderHistory.length >= maxReminders) continue

      if (reminderHistory.length > 0) {
        const lastSentAt = new Date(reminderHistory[reminderHistory.length - 1])
        const intervalCutoff = new Date(now)
        intervalCutoff.setDate(intervalCutoff.getDate() - intervalDays)
        if (lastSentAt > intervalCutoff) continue
      }

      if (pendingSub.journey_status !== 'active') { remindersSkipped++; continue }

      const pendingUser = pendingSub.users

      if (pendingUser.email_bounced || pendingUser.unsubscribed_matches || pendingUser.deletion_requested_at) {
        remindersSkipped++
        await supabase.from('events').insert({
          event_type: 'interest_reminder_skipped', user_id: pendingUser.user_id, match_id: match.match_id,
          metadata: { reason: pendingUser.email_bounced ? 'bounced' : pendingUser.unsubscribed_matches ? 'unsubscribed' : 'deletion_pending' }
        })
        continue
      }

      if (testingMode && !pendingUser.email_whitelist) { remindersSkipped++; continue }
      if (quotaRemaining <= 0) { console.log(`[interest-reminder] Quota reached mid-run — stopping`); break }

      const reminderNum = reminderHistory.length + 1

      try {
        const html = buildReminderEmail(
          pendingUser.name, pendingSub.from_location, pendingSub.to_location,
          pendingSub.distance_km || 0, pendingUser.match_page_token,
          pendingSub.submission_id, reminderNum
        )
        const subject = reminderNum > 1
          ? `Your Carpool Match Is Still Waiting`
          : `You Have a Carpool Match!`

        await sendEmail(pendingUser.email, subject, html)

        const updatedHistory = [...reminderHistory, now.toISOString()]
        await supabase.from('matches').update({ interest_reminders_sent: updatedHistory }).eq('match_id', match.match_id)
        await supabase.from('events').insert({
          event_type: 'interest_reminder_sent', user_id: pendingUser.user_id, match_id: match.match_id,
          metadata: { recipient: pendingUser.email, reminder_num: reminderNum, interested_submission_id: interestedSub.submission_id }
        })

        remindersSent++; quotaRemaining--
        console.log(`[interest-reminder] #${reminderNum} sent to ${pendingUser.email} for match ${match.match_id}`)
      } catch (emailErr: any) {
        console.error(`[interest-reminder] Failed for ${pendingUser.email}:`, emailErr.message)
      }
    }

    console.log(`[interest-reminder] Done — sent: ${remindersSent}, skipped: ${remindersSkipped}`)
    return new Response(JSON.stringify({ success: true, remindersSent, remindersSkipped }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('[interest-reminder] Error:', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { 'Content-Type': 'application/json' }, status: 500
    })
  }
})
