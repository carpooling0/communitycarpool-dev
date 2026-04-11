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
                <img src="${SITE_URL}/logo_with_slogan.png" alt="Community Carpool" style="height:64px;width:auto;display:block;margin:0 auto;" />
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
