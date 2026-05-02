import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

// sendEmail returns the provider message ID if sent via Resend, else null
async function sendEmail(to: string, subject: string, html: string, batchId?: string): Promise<string | null> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const sesKey = Deno.env.get('AWS_ACCESS_KEY_ID')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || Deno.env.get('SES_FROM_EMAIL') || ''

  if (resendKey) {
    const payload: any = {
      from: `Community Carpool <${fromEmail}>`,
      to: [to],
      subject,
      html,
    }
    // Add tags so Resend webhook events can be correlated back to our batches
    if (batchId) {
      payload.tags = [
        { name: 'batch_id', value: batchId },
        { name: 'type',     value: 'match_notification' }
      ]
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`)
    const resData = await res.json()
    return resData.id || null  // Returns "re_xxxx" — used for webhook event correlation
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
    return null  // SES doesn't return an ID we can track with Resend webhooks
  }

  throw new Error('No email provider configured. Set RESEND_API_KEY or AWS SES secrets.')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (await getConfig('match_notification_enabled') !== 'true') {
      return new Response(JSON.stringify({ success: true, message: 'Notifications disabled' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Check testing mode (default: true until explicitly set to 'false')
    const testingMode = (await getConfig('testing_mode')) !== 'false'

    const { data: unsentMatches, error } = await supabase.from('matches')
      .select(`
        match_id, sub_a_id, sub_b_id, match_strength,
        sub_a:submissions!sub_a_id (submission_id, from_location, to_location, journey_num, user_id, users(name, email, match_page_token, email_whitelist, unsubscribed_matches, deletion_requested_at, email_bounced)),
        sub_b:submissions!sub_b_id (submission_id, from_location, to_location, journey_num, user_id, users(name, email, match_page_token, email_whitelist, unsubscribed_matches, deletion_requested_at, email_bounced))
      `).eq('notification_sent', false).eq('status', 'new')
    if (error) throw error
    if (!unsentMatches || unsentMatches.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No unsent matches' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const batchId = crypto.randomUUID()
    const batchDate = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dubai' })

    // Group new matches by user email
    const userMatches: { [email: string]: any } = {}
    for (const match of unsentMatches) {
      for (const sub of [match.sub_a, match.sub_b]) {
        const userEmail = sub.users.email
        if (!userMatches[userEmail]) userMatches[userEmail] = { name: sub.users.name, token: sub.users.match_page_token, userId: sub.user_id, emailWhitelist: sub.users.email_whitelist === true, unsubscribedMatches: sub.users.unsubscribed_matches === true, deletionRequested: !!sub.users.deletion_requested_at, emailBounced: sub.users.email_bounced === true, newJourneys: {} }
        if (!userMatches[userEmail].newJourneys[sub.submission_id]) {
          userMatches[userEmail].newJourneys[sub.submission_id] = { journeyNum: sub.journey_num, fromLocation: sub.from_location, toLocation: sub.to_location, newMatchCount: 0 }
        }
        userMatches[userEmail].newJourneys[sub.submission_id].newMatchCount++
      }
    }

    let emailsSent = 0, emailsFailed = 0, emailsSkipped = 0
    const successfullyEmailedMatchIds = new Set<number>()

    for (const [email, userData] of Object.entries(userMatches) as any) {
      // ── HARD SKIP: bounced, unsubscribed, or deletion requested ──
      if (userData.emailBounced || userData.unsubscribedMatches || userData.deletionRequested) {
        emailsSkipped++
        console.log(`[SKIP] ${email} — bounced: ${userData.emailBounced}, unsubscribed: ${userData.unsubscribedMatches}, deletion pending: ${userData.deletionRequested}`)
        continue
      }

      // ── TESTING WHITELIST: skip non-whitelisted emails in testing mode ──
      // Whitelist is controlled per-user via users.email_whitelist = true
      if (testingMode && !userData.emailWhitelist) {
        emailsSkipped++
        console.log(`[TESTING MODE] Skipping email to ${email} — match stays 'new' for real send later`)
        continue
      }

      try {
        // Fetch ALL active journeys for this user (not just ones with new matches)
        const { data: allSubs } = await supabase.from('submissions')
          .select('submission_id, journey_num, from_location, to_location, journey_status')
          .eq('user_id', userData.userId)
          .in('journey_status', ['active'])
          .order('journey_num', { ascending: true })

        // Build a map of subId → new match count for quick lookup
        const newSubMatchCount: { [subId: string]: number } = {}
        for (const [subId, journey] of Object.entries(userData.newJourneys) as any) {
          newSubMatchCount[subId] = journey.newMatchCount
        }

        // ALL active journeys get a green "View Matches →" button (consistent layout)
        // Journeys with new matches show a badge count; others just show route
        const allJourneyRows = (allSubs || [])
          .map((s: any) => {
            const newCount = newSubMatchCount[s.submission_id]
            const newBadge = newCount
              ? `<div style="font-size:13px;color:#15803d;font-weight:600;margin-bottom:10px;">🎉 ${newCount} new match${newCount > 1 ? 'es' : ''}!</div>`
              : ''
            return `
              <tr><td style="padding:20px 0;border-bottom:1px solid #e5e7eb;">
                <div style="font-weight:700;color:#111827;margin-bottom:10px;font-size:15px;">Journey #${s.journey_num}</div>
                <div style="font-size:14px;color:#374151;margin-bottom:4px;"><span style="color:#16a34a;font-size:12px;">&#9679;</span>&nbsp;${s.from_location}</div>
                <div style="font-size:13px;color:#9ca3af;margin:0 0 4px 6px;">&#8595;</div>
                <div style="font-size:14px;color:#374151;margin-bottom:12px;"><span style="color:#dc2626;font-size:12px;">&#9679;</span>&nbsp;${s.to_location}</div>
                ${newBadge}
                <a href="${SITE_URL}/matches.html?token=${userData.token}&journey=${s.submission_id}" style="display:inline-block;background:#16a34a;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View Matches &#x2192;</a>
              </td></tr>`
          }).join('')

        if (!allJourneyRows) continue

        const shareUrl = SITE_URL
        const shareWA  = encodeURIComponent(`Hey! I just signed up on CommunityCarpool.org to find carpooling partners for my commute.\n\nIt matches neighbors going the same route \u2014 completely FREE, No Cookies, No App, and you only connect when both sides are interested. Everything over email.\n\nThe more people sign up in our area, the better the matches get. Takes 30 seconds!\n${shareUrl}`)
        const shareTW  = encodeURIComponent(`Just joined communitycarpool.org to find carpooling neighbors on my route. Free, no app, email-only. The more locals sign up, the better the matches! Check it out \uD83D\uDC47\n${shareUrl}`)
        const shareFB  = encodeURIComponent(shareUrl)
        const shareLI  = encodeURIComponent(shareUrl)
        const shareSMS = shareWA  // Same message as WhatsApp

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
          <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
          <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
            <div style="text-align:center;margin-bottom:32px;">
              <a href="${SITE_URL}" style="text-decoration:none;">
                <img src="${SITE_URL}/logo-email.png" alt="Community Carpool" style="height:64px;width:auto;display:block;margin:0 auto;" />
              </a>
            </div>
            <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
              <h2 style="color:#111827;font-size:20px;margin:0 0 4px;">Hi ${userData.name}!</h2>
              <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">Your Carpool Update &mdash; ${batchDate}</p>
              <table width="100%" cellpadding="0" cellspacing="0">${allJourneyRows}</table>
            </div>
            <div style="background:white;border-radius:12px;padding:20px 24px;margin-top:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
              <p style="color:#374151;font-size:14px;font-weight:600;margin:0 0 4px;">Know someone who commutes the same way?</p>
              <p style="color:#6b7280;font-size:13px;margin:0 0 16px;">The more people in your area sign up, the better the matches get.</p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
                <td style="padding:0 5px;"><a href="https://wa.me/?text=${shareWA}" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/whatsapp.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="WhatsApp" /></a></td>
                <td style="padding:0 5px;"><a href="https://www.facebook.com/sharer/sharer.php?u=${shareFB}" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/facebook.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Facebook" /></a></td>
                <td style="padding:0 5px;"><a href="https://x.com/intent/tweet?text=${shareTW}" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/twitter.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="Twitter / X" /></a></td>
                <td style="padding:0 5px;"><a href="https://www.linkedin.com/shareArticle?mini=true&url=${shareLI}&title=${encodeURIComponent('Free carpooling for your commute')}&summary=${encodeURIComponent('Just joined communitycarpool.org to find carpooling neighbors on my route. Free, no app, everything over email.')}" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/linkedin.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="LinkedIn" /></a></td>
                <td style="padding:0 5px;"><a href="sms:?body=${shareSMS}" style="text-decoration:none;"><img src="${SITE_URL}/email-icons/sms.png" width="36" height="36" style="display:block;border:0;border-radius:9px;" alt="SMS" /></a></td>
              </tr></table>
            </div>
            <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:13px;">
              <p style="margin:0 0 6px;">
                <a href="${SITE_URL}/docs/" style="color:#6b7280;text-decoration:none;">Help &amp; FAQ</a> &nbsp;&middot;&nbsp;
                <a href="${SITE_URL}/terms.html" style="color:#6b7280;text-decoration:none;">Terms</a> &nbsp;&middot;&nbsp;
                <a href="${SITE_URL}/privacy.html" style="color:#6b7280;text-decoration:none;">Privacy Policy</a> &nbsp;&middot;&nbsp;
                <a href="${SITE_URL}/unsubscribe.html?token=${userData.token}" style="color:#6b7280;text-decoration:none;">Unsubscribe</a> &nbsp;&middot;&nbsp;
                <a href="${SITE_URL}/support.html" style="color:#6b7280;text-decoration:none;">Feedback</a>
              </p>
              <p style="margin:0;">Community Carpool &middot; communitycarpool.org</p>
            </div>
          </div></body></html>`

        const emailMsgId = await sendEmail(email, `Your Carpool Update \u2014 ${batchDate}`, html, batchId)
        emailsSent++
        // Log to general events table (lightweight record)
        supabase.from('events').insert({ event_type: 'match_email_sent', metadata: { email, batch_id: batchId, message_id: emailMsgId, provider: emailMsgId ? 'resend' : 'ses' } })

        for (const match of unsentMatches) {
          if (match.sub_a.users.email === email || match.sub_b.users.email === email) {
            successfullyEmailedMatchIds.add(match.match_id)
          }
        }
      } catch (emailErr: any) {
        emailsFailed++
        console.error(`Email failed for ${email}:`, emailErr.message)
        supabase.from('events').insert({ event_type: 'match_email_failed', metadata: { email, error: emailErr.message, batch_id: batchId } })
      }
    }

    if (successfullyEmailedMatchIds.size > 0) {
      const idsToMark = [...successfullyEmailedMatchIds]
      await supabase.from('matches').update({
        notification_sent: true,
        notification_sent_at: new Date().toISOString(),
        email_batch_id: batchId,
        status: 'notified'
      }).in('match_id', idsToMark)

      const subIds = [...new Set(unsentMatches
        .filter((m: any) => idsToMark.includes(m.match_id))
        .flatMap((m: any) => [m.sub_a_id, m.sub_b_id]))]
      await supabase.from('submissions').update({ last_notified_at: new Date().toISOString() }).in('submission_id', subIds)
    }

    return new Response(JSON.stringify({ success: true, emailsSent, emailsFailed, emailsSkipped, batchId, provider: 'resend', testingMode }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('batch-send-emails error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
