import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/send-email.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

function buildCheckupEmail(
  recipientName: string,
  otherName: string,
  fromLocation: string,
  toLocation: string,
  myToken: string,
  matchId: number,
  mySubmissionId: number
): string {
  const confirmBase = `${Deno.env.get('DB_URL')}/functions/v1/carpool-confirm`
  const yesUrl = `${confirmBase}?token=${myToken}&matchId=${matchId}&answer=yes`
  const noUrl  = `${confirmBase}?token=${myToken}&matchId=${matchId}&answer=no`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Are you carpooling yet?</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">Quick check-in: are you and ${otherName} carpooling yet?&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>

<div style="max-width:600px;margin:0 auto;padding:32px 20px;">

  <!-- Logo -->
  <div style="text-align:center;margin-bottom:24px;">
    <a href="${SITE_URL}" style="text-decoration:none;">
      <img src="${SITE_URL}/logo-email.png" alt="Community Carpool" style="height:56px;width:auto;display:block;margin:0 auto;" />
    </a>
  </div>

  <!-- Main card -->
  <div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#1B5C3A;padding:20px 28px 18px;text-align:center;">
      <div style="font-size:36px;margin-bottom:8px;">&#x1F697;</div>
      <h1 style="margin:0;font-size:22px;font-weight:900;color:#FFFFFF;font-family:Montserrat,Inter,sans-serif;">Are You Carpooling Yet?</h1>
      <p style="margin:8px 0 0;font-size:14px;color:#B4E035;line-height:1.5;">Hi ${recipientName}! A few days ago you and ${otherName} exchanged contact details. How did it go?</p>
    </div>

    <!-- Body -->
    <div style="padding:24px 28px;">

      <!-- Route -->
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:20px;">
        <div style="font-weight:700;color:#111827;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Your Route</div>
        <div style="font-size:14px;color:#374151;margin-bottom:4px;"><span style="color:#16a34a;">&#9679;</span>&nbsp;${fromLocation}</div>
        <div style="font-size:12px;color:#9ca3af;margin:0 0 4px 8px;">&#8595;</div>
        <div style="font-size:14px;color:#374151;"><span style="color:#dc2626;">&#9679;</span>&nbsp;${toLocation}</div>
      </div>

      <!-- Question -->
      <p style="color:#374151;font-size:15px;font-weight:600;text-align:center;margin:0 0 20px;">Are you and ${otherName} carpooling together?</p>

      <!-- Buttons -->
      <div style="margin-bottom:8px;">
        <a href="${yesUrl}" style="display:block;background:#16a34a;color:white;padding:14px 10px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;text-align:center;font-family:Montserrat,Inter,sans-serif;">&#x2705;&nbsp; Yes, we&rsquo;re carpooling!</a>
      </div>
      <div>
        <a href="${noUrl}" style="display:block;background:#f3f4f6;color:#374151;padding:14px 10px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;text-align:center;border:1px solid #e5e7eb;">Not yet / Didn&rsquo;t work out</a>
      </div>

      <p style="color:#9ca3af;font-size:12px;text-align:center;margin:16px 0 0;">
        Your response helps us improve the platform. It only takes one click.
      </p>
    </div>
  </div>

  <!-- Journey Tracker — Step 4 active -->
  <div style="background:white;border-radius:12px;padding:16px 20px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <div style="font-size:11px;font-weight:700;color:#1B5C3A;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;">Your Carpool Status</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
      <tr>
        <td align="center" width="20%">
          <div style="width:28px;height:28px;border-radius:50%;background:#1B5C3A;color:#fff;font-size:13px;font-weight:700;line-height:28px;margin:0 auto 4px;">&#10003;</div>
          <div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Joined the Pool</div>
        </td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#1B5C3A;"></div></td>
        <td align="center" width="20%">
          <div style="width:28px;height:28px;border-radius:50%;background:#1B5C3A;color:#fff;font-size:13px;font-weight:700;line-height:28px;margin:0 auto 4px;">&#10003;</div>
          <div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Matched</div>
        </td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#1B5C3A;"></div></td>
        <td align="center" width="20%">
          <div style="width:28px;height:28px;border-radius:50%;background:#1B5C3A;color:#fff;font-size:13px;font-weight:700;line-height:28px;margin:0 auto 4px;">&#10003;</div>
          <div style="font-size:9px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Connected</div>
        </td>
        <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#B4E035;"></div></td>
        <td align="center" width="20%">
          <div style="width:28px;height:28px;border-radius:50%;background:#B4E035;color:#1B5C3A;font-size:12px;font-weight:900;line-height:28px;margin:0 auto 4px;border:2px solid #1B5C3A;">4</div>
          <div style="font-size:9px;color:#1B5C3A;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Carpooling!</div>
        </td>
      </tr>
    </table>
  </div>

  <div style="background:white;border-radius:12px;padding:16px 20px;margin-top:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">Know someone who commutes the same way?</p>
    <p style="color:#6b7280;font-size:13px;margin:0 0 12px;">The more people in your area sign up, the better the matches get.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/whatsapp.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/whatsapp.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/facebook.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/facebook.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/x.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/twitter.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Twitter / X" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/linkedin.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/linkedin.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
      <td style="padding:0 5px;"><a href="${SITE_URL}/share/sms.html" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/sms.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
    </tr></table>
  </div>

  <!-- Footer -->
  <div style="text-align:center;margin-top:22px;color:#9ca3af;font-size:13px;">
    <p style="margin:0 0 5px;">
      <a href="${SITE_URL}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/unsubscribe.html?token=${myToken}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a>
    </p>
  </div>

</div>
</body></html>`
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const testTo = url.searchParams.get('test_to')

    // ── Test / preview mode ──────────────────────────────────────────────────
    if (testTo) {
      const html = buildCheckupEmail(
        'Alex', 'Jordan',
        'Dubai Marina', 'Dubai International Financial Centre (DIFC)',
        'preview-token-000', 0, 0
      )
      const resendKey = Deno.env.get('RESEND_API_KEY')
      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `Community Carpool <${fromEmail}>`, to: [testTo], subject: 'Are you carpooling yet? 🚗', html })
      })
      const body = await res.json()
      return new Response(JSON.stringify({ preview: true, to: testTo, resend: body }), {
        headers: { 'Content-Type': 'application/json' }, status: res.ok ? 200 : 500
      })
    }

    // ── Production mode ──────────────────────────────────────────────────────
    if (await getConfig('carpooling_checkup_enabled') !== 'true') {
      return new Response(JSON.stringify({ success: true, message: 'Carpooling checkup disabled' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const testingMode = (await getConfig('testing_mode')) !== 'false'
    const checkupDays = parseInt(await getConfig('carpooling_checkup_days')) || 4

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - checkupDays)

    const { data: matches, error } = await supabase.from('matches')
      .select(`
        match_id,
        sub_a:submissions!sub_a_id (submission_id, from_location, to_location, users(user_id, name, email, match_page_token, email_whitelist, email_bounced, unsubscribed_matches, deletion_requested_at)),
        sub_b:submissions!sub_b_id (submission_id, from_location, to_location, users(user_id, name, email, match_page_token, email_whitelist, email_bounced, unsubscribed_matches, deletion_requested_at))
      `)
      .eq('status', 'contact_revealed')
      .is('checkup_sent_at', null)
      .lt('contact_revealed_at', cutoff.toISOString())
      .not('contact_revealed_at', 'is', null)

    if (error) throw error

    let sent = 0, skipped = 0

    for (const match of matches || []) {
      const pairs = [
        { me: match.sub_a, other: match.sub_b },
        { me: match.sub_b, other: match.sub_a }
      ]

      let matchSent = false
      for (const { me, other } of pairs) {
        const u = me.users
        if (u.email_bounced || u.unsubscribed_matches || u.deletion_requested_at) { skipped++; continue }
        if (testingMode && !u.email_whitelist) { skipped++; continue }

        try {
          const html = buildCheckupEmail(
            u.name, other.users.name,
            me.from_location, me.to_location,
            u.match_page_token, match.match_id, me.submission_id
          )
          await sendEmail(u.email, 'Are you carpooling yet? 🚗', html)
          await supabase.from('events').insert({
            event_type: 'carpooling_checkup_sent',
            user_id: u.user_id, match_id: match.match_id,
            metadata: { recipient: u.email }
          })
          sent++
          matchSent = true
        } catch (e: any) {
          console.error(`Checkup failed for ${u.email}:`, e.message)
        }
      }

      if (matchSent) {
        await supabase.from('matches').update({ checkup_sent_at: new Date().toISOString() }).eq('match_id', match.match_id)
      }
    }

    return new Response(JSON.stringify({ success: true, sent, skipped }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('[send-carpooling-checkup] Error:', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { 'Content-Type': 'application/json' }, status: 500
    })
  }
})
