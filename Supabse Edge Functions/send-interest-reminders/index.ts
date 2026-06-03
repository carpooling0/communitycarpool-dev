import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail } from '../_shared/send-email.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
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
  return `
    <div style="background:#FFFFFF;border-radius:10px;padding:14px 16px;text-align:center;border:1px solid #E5E7EB;">
      <p style="color:#1F2937;font-size:14px;font-weight:700;margin:0 0 4px;font-family:Montserrat,Inter,sans-serif;">Know Someone Who Commutes the Same Way?</p>
      <p style="color:#6B7280;font-size:13px;margin:0 0 12px;">The more people in your area sign up, the better the matches get.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
        <td style="padding:0 5px;"><a href="https://communitycarpool.org/share/whatsapp.html" style="text-decoration:none;"><img src="https://communitycarpool.org/email-icons/whatsapp.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
        <td style="padding:0 5px;"><a href="https://communitycarpool.org/share/facebook.html" style="text-decoration:none;"><img src="https://communitycarpool.org/email-icons/facebook.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
        <td style="padding:0 5px;"><a href="https://communitycarpool.org/share/x.html" style="text-decoration:none;"><img src="https://communitycarpool.org/email-icons/twitter.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="X / Twitter" /></a></td>
        <td style="padding:0 5px;"><a href="https://communitycarpool.org/share/linkedin.html" style="text-decoration:none;"><img src="https://communitycarpool.org/email-icons/linkedin.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
        <td style="padding:0 5px;"><a href="https://communitycarpool.org/share/sms.html" style="text-decoration:none;"><img src="https://communitycarpool.org/email-icons/sms.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
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
  const trees      = calcTrees(distanceKm)
  const variant =
    reminderNum <= 0 ? 'immediate' :
    reminderNum === 1 ? 'first' :
    reminderNum === 2 ? 'second' :
    reminderNum === 3 ? 'third' : 'final'

  const preheader =
    variant === 'immediate'
      ? `Someone just said YES to your carpool match and is waiting for you.`
      : variant === 'first'
      ? `Someone said YES a few days ago and is still waiting for your response.`
      : variant === 'second'
      ? `Your match is still waiting — reply now if this route works for you.`
      : variant === 'third'
      ? `Your match is still waiting. Reply now if this route works for you.`
      : `Last reminder — someone is still waiting for your response.`

  const heroHeading =
    variant === 'immediate'
      ? `Someone Just Said YES to Your Match!`
      : variant === 'first'
      ? `Someone Said YES — Still Waiting`
      : variant === 'second'
      ? `Your Match Is Still Waiting`
      : variant === 'third'
      ? `Your Match Is Still Waiting`
      : `Last Reminder: Your Match Is Waiting`

  const heroSubtext =
    variant === 'immediate'
      ? `Great news. Someone just said YES to carpooling with you. They are ready to connect — tap below to respond.`
      : variant === 'first'
      ? `Someone said YES to carpooling with you a few days ago and is still waiting for your response. If this route works for you, tap below and reply now.`
      : variant === 'second'
      ? `Your match is still waiting for your response. If this route works for you, tap below and reply before this match goes cold.`
      : variant === 'third'
      ? `Your match is still waiting for your response. If this route works for you, tap below and reply now.`
      : `This is your last reminder. Someone has been waiting for your response. If you want to connect, reply now before this match becomes stale.`

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
          <div style="font-size:12px;color:#9ca3af;margin:2px 0 2px 6px;">&#8595;</div>
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
          Respond to My Match &nbsp;&#x2192;
        </a>
      </div>


    </div>
  </div>

  <!-- Journey Tracker — Step 2 active -->
  <div style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.07);margin-bottom:12px;padding:16px 20px;">
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

  ${buildShareBlock(SITE_URL)}

  <!-- Footer -->
  <div style="text-align:center;color:#9CA3AF;font-size:13px;padding:0 16px;">
    <p style="margin:0 0 5px;">
      <a href="${SITE_URL}/docs/" style="color:#6B7280;text-decoration:none;">Help &amp; FAQ</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/terms.html" style="color:#6B7280;text-decoration:none;">Terms</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/privacy.html" style="color:#6B7280;text-decoration:none;">Privacy Policy</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/unsubscribe.html?token=${token}" style="color:#6B7280;text-decoration:none;">Unsubscribe</a>&nbsp;&nbsp;&#183;&nbsp;&nbsp;
      <a href="${SITE_URL}/support.html" style="color:#6B7280;text-decoration:none;">Feedback</a>
    </p>
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
    const testToken = url.searchParams.get('test_token')
    const testJourney = parseInt(url.searchParams.get('test_journey') || '0')

    // Preview/test mode: ?test_to=email&test_num=0..4
    if (testTo) {
      const resendKey = Deno.env.get('RESEND_API_KEY')
      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''
      let previewToken = testToken || 'preview-token-000'
      let previewJourney = Number.isFinite(testJourney) ? testJourney : 0

      if (!testToken || !testJourney) {
        const expiryDays = parseInt(await getConfig('match_token_expiry_days')) || 120
        const tokenCutoff = new Date()
        tokenCutoff.setDate(tokenCutoff.getDate() - expiryDays)

        const { data: requestedUser } = await supabase.from('users')
          .select('user_id, match_page_token, token_created_at')
          .eq('email', testTo.toLowerCase())
          .maybeSingle()

        if (
          requestedUser?.user_id &&
          requestedUser.match_page_token &&
          requestedUser.token_created_at &&
          new Date(requestedUser.token_created_at) > tokenCutoff
        ) {
          const { data: requestedSub } = await supabase.from('submissions')
            .select('submission_id')
            .eq('user_id', requestedUser.user_id)
            .eq('journey_status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (requestedSub?.submission_id) {
            previewToken = requestedUser.match_page_token
            previewJourney = requestedSub.submission_id
          }
        }

        if (previewToken === 'preview-token-000' || previewJourney === 0) {
          const { data: recentSubs } = await supabase.from('submissions')
            .select('submission_id, user_id')
            .eq('journey_status', 'active')
            .order('created_at', { ascending: false })
            .limit(20)

          const userIds = [...new Set((recentSubs || []).map((s: any) => s.user_id))]
          if (userIds.length > 0) {
            const { data: recentUsers } = await supabase.from('users')
              .select('user_id, match_page_token, token_created_at')
              .in('user_id', userIds)
            const validUser = (recentUsers || []).find((u: any) =>
              u.match_page_token &&
              u.token_created_at &&
              new Date(u.token_created_at) > tokenCutoff
            )
            if (validUser) {
              const sub = (recentSubs || []).find((s: any) => s.user_id === validUser.user_id)
              if (sub?.submission_id) {
                previewToken = validUser.match_page_token
                previewJourney = sub.submission_id
              }
            }
          }
        }
      }

      const html = buildReminderEmail(
        'Alex',
        'Dubai Marina',
        'Dubai International Financial Centre (DIFC)',
        22,
        previewToken,
        previewJourney,
        testNum
      )
      const subject =
        testNum <= 0
          ? `Someone Just Said YES to Your Match!`
          : testNum === 1
          ? `Someone Said YES — Still Waiting`
          : testNum === 2
          ? `Your Match Is Still Waiting`
          : testNum === 3
          ? `Your Match Is Still Waiting`
          : `Last Reminder: Your Match Is Waiting`
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `Community Carpool <${fromEmail}>`, to: [testTo], subject, html })
      })
      const body = await res.json()
      return new Response(JSON.stringify({
        preview: true,
        reminder_num: testNum,
        to: testTo,
        preview_token: previewToken,
        preview_journey: previewJourney,
        resend: body
      }), {
        headers: { 'Content-Type': 'application/json' }, status: res.ok ? 200 : 500
      })
    }

    if (await getConfig('interest_reminder_enabled') !== 'true') {
      return new Response(JSON.stringify({ success: true, message: 'Interest reminders disabled' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const testingMode = (await getConfig('testing_mode')) !== 'false'
    // Dev rollout target: immediate, then day 3 / 7 / 11 / 15
    const firstReminderDays = 3
    const intervalDays = 4
    const maxReminders = 4
    const dailyLimit = parseInt(await getConfig('resend_daily_limit')) || 90

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
      const subject =
          reminderNum === 1
            ? `Someone Said YES — Still Waiting`
            : reminderNum === 2
            ? `Your Match Is Still Waiting`
            : reminderNum === 3
            ? `Your Match Is Still Waiting`
            : `Last Reminder: Your Match Is Waiting`

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
