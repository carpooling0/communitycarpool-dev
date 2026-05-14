import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('DB_URL')!,
  Deno.env.get('DB_SERVICE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// ── Distance modes ────────────────────────────────────────────────────────────
// 'haversine' → straight-line for everything
// 'mapbox'    → Mapbox Directions API (actual road distance)
// 'hybrid'    → same as 'mapbox' for journey distance; haversine used in find-matches disambiguation only
// ─────────────────────────────────────────────────────────────────────────────
async function roadDistance(
  lat1: number, lng1: number, lat2: number, lng2: number,
  method: string, mapboxToken: string
): Promise<number> {
  if (method === 'haversine') {
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
  // mapbox or hybrid — both use Mapbox for journey distance
  if (!mapboxToken) {
    console.error(`MAPBOX_TOKEN not set but distance_method='${method}' — falling back to haversine. Set MAPBOX_TOKEN in Supabase Edge Function secrets.`)
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
  try {
    // Mapbox Directions: coordinates are lng,lat (note order)
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lng1},${lat1};${lng2},${lat2}` +
      `?access_token=${mapboxToken}&overview=false&steps=false`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`)
    const json = await res.json()
    if (!json.routes?.length) throw new Error('No route found')
    return json.routes[0].distance / 1000
  } catch (err: any) {
    console.error(`Mapbox failed, falling back to haversine: ${err.message}`)
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
}

// ── Send PIN verification email ──────────────────────────────────────────────
async function sendPinEmail(toEmail: string, firstName: string, pin: string, verifyToken: string, siteUrl: string): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''
  if (!resendKey) throw new Error('RESEND_API_KEY not set')

  const verifyLink = `${siteUrl}/?verify_email=${verifyToken}`
  const digits = pin.split('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Activate your Community Carpool journey</title>
</head>
<body style="margin:0;padding:0;background:#F0F0ED;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">One last step — enter this PIN to activate your carpool journey.&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0F0ED;">
<tr><td align="center" style="padding:32px 16px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">

    <!-- Logo -->
    <tr>
      <td align="center" style="padding-bottom:20px;">
        <a href="https://communitycarpool.org" style="text-decoration:none;">
          <img src="https://communitycarpool.org/logo-slogan.png" alt="Community Carpool" style="height:48px;width:auto;display:block;margin:0 auto;" />
        </a>
      </td>
    </tr>

    <!-- Card -->
    <tr>
      <td style="background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,0.08);">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">

          <!-- Green header -->
          <tr>
            <td style="background:#1B5C3A;padding:20px 28px 18px;border-radius:14px 14px 0 0;text-align:center;">
              <h1 style="margin:0;font-size:20px;font-weight:900;color:#FFFFFF;font-family:Montserrat,Inter,sans-serif;">Almost There!</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#B4E035;">Hi ${firstName} — one PIN stands between you and your carpool match.</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 28px 24px;text-align:center;">

              <!-- PIN boxes -->
              <p style="margin:0 0 16px;font-size:13px;color:#6B7280;">Go back to the window and enter this PIN to activate your journey:</p>
              <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px;">
                <tr>
                  ${digits.map(d => `
                  <td style="padding:0 6px;">
                    <div style="width:56px;height:64px;border:2.5px solid #1B5C3A;border-radius:10px;background:#f0fdf4;display:inline-block;line-height:64px;text-align:center;font-size:32px;font-weight:900;color:#1B5C3A;font-family:Montserrat,Inter,sans-serif;">${d}</div>
                  </td>`).join('')}
                </tr>
              </table>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #E5E7EB;padding-bottom:16px;"></td></tr></table>

              <!-- Fallback link -->
              <p style="margin:0 0 12px;font-size:13px;color:#6B7280;">Closed the window? Click below to verify instantly:</p>
              <a href="${verifyLink}" style="display:inline-block;padding:11px 28px;background:#1B5C3A;color:#FFFFFF;border-radius:50px;text-decoration:none;font-size:14px;font-weight:700;font-family:Montserrat,Inter,sans-serif;">Activate My Journey &rarr;</a>

            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding-top:20px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#9CA3AF;">Community Carpool &middot; communitycarpool.org</p>
        <p style="margin:4px 0 0;font-size:12px;color:#D1D5DB;">If you did not request this, you can safely ignore this email.</p>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body></html>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Community Carpool <${fromEmail}>`,
      to: [toEmail],
      subject: `Activate your Community Carpool journey`,
      html
    })
  })
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { firstName, email, fromLocation, fromLatLng, toLocation, toLatLng, distance, distanceValue, country: countryHint, orgCode,
            refCode, utmSource, utmMedium, utmCampaign, termsVersion, termsAgreed } = body

    const ip = req.headers.get('cf-connecting-ip')
            || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || 'unknown'

    let country = countryHint || 'AE'
    try {
      const geoRes = await fetch(`https://ipwho.is/${ip}`, { signal: AbortSignal.timeout(2000) })
      if (geoRes.ok) {
        const geoData = await geoRes.json()
        if (geoData.success && geoData.country_code) country = geoData.country_code
      }
    } catch { /* silent fail */ }

    if (!firstName || !email || !fromLocation || !fromLatLng || !toLocation || !toLatLng) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required fields.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
    }

    const requiredTermsVersion = await getConfig('required_terms_version')
    const acceptedVersion = termsAgreed ? requiredTermsVersion : termsVersion
    if (!acceptedVersion || parseFloat(acceptedVersion) < parseFloat(requiredTermsVersion)) {
      return new Response(JSON.stringify({ success: false, error: 'You must accept the current Terms & Conditions to continue.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
    }
    const resolvedTermsVersion = requiredTermsVersion

    const { data: blacklisted } = await supabase
      .from('blacklist').select('blacklist_id').eq('email', email.toLowerCase()).single()
    if (blacklisted) {
      return new Response(JSON.stringify({ success: false, error: 'This email is not permitted to register.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 })
    }

    const [fromLat, fromLng] = fromLatLng.split(',').map(Number)
    const [toLat, toLng] = toLatLng.split(',').map(Number)

    let userId: number
    let userJourneyLimit: number | null = null
    const { data: existingUser } = await supabase
      .from('users').select('user_id, journey_limit, ref_code, deletion_requested_at').eq('email', email.toLowerCase()).single()

    if (existingUser) {
      if (existingUser.deletion_requested_at) {
        return new Response(JSON.stringify({ success: false, error: 'Your account is scheduled for deletion. You cannot create new journeys. Contact support if you changed your mind.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 })
      }
      userId = existingUser.user_id
      userJourneyLimit = existingUser.journey_limit
      const updates: Record<string, any> = { last_seen_at: new Date().toISOString(), name: firstName, terms_accepted_version: resolvedTermsVersion, terms_accepted_at: new Date().toISOString() }
      if (!existingUser.ref_code && refCode) updates.ref_code = refCode
      await supabase.from('users').update(updates).eq('user_id', userId)
      if (!existingUser.ref_code && (utmSource || utmMedium || utmCampaign)) {
        await supabase.from('user_attribution').insert({ user_id: userId, utm_source: utmSource || null, utm_medium: utmMedium || null, utm_campaign: utmCampaign || null })
      }
    } else {
      const { data: newUser, error: insertError } = await supabase.from('users')
        .insert({ email: email.toLowerCase(), name: firstName, last_seen_at: new Date().toISOString(), ref_code: refCode || null, terms_accepted_version: resolvedTermsVersion, terms_accepted_at: new Date().toISOString() })
        .select('user_id').single()
      if (insertError) {
        if (insertError.code === '23505') {
          const { data: raceUser } = await supabase.from('users').select('user_id').eq('email', email.toLowerCase()).single()
          if (!raceUser) throw new Error(`User insert failed and recovery select returned nothing: ${insertError.message}`)
          userId = raceUser.user_id
        } else {
          throw new Error(`Failed to create user: ${insertError.message}`)
        }
      } else {
        userId = newUser!.user_id
      }
      if (utmSource || utmMedium || utmCampaign) {
        await supabase.from('user_attribution').insert({ user_id: userId, utm_source: utmSource || null, utm_medium: utmMedium || null, utm_campaign: utmCampaign || null })
      }
    }

    const globalLimit = parseInt(await getConfig('max_journeys_per_user')) || 10
    const journeyLimit = userJourneyLimit ?? globalLimit
    const { count: activeJourneys } = await supabase.from('submissions')
      .select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('journey_status', 'active')
    if ((activeJourneys || 0) >= journeyLimit) {
      return new Response(JSON.stringify({ success: false, error: `Maximum of ${journeyLimit} active journeys reached. Please archive an existing journey first.` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
    }

    let submissionOrgId = null
    if (orgCode) {
      const { data: org } = await supabase.from('organisations').select('org_id').eq('org_code', orgCode.toLowerCase()).eq('is_active', true).single()
      submissionOrgId = org?.org_id || null
    }

    const distancePrefMap: { [key: string]: number } = { '1': 3, '2': 5, '3': 8, '4': 10 }
    const distancePrefKm = distancePrefMap[distanceValue] || 3
    const distanceMethod = await getConfig('distance_method') || 'haversine'
    const mapboxToken = Deno.env.get('MAPBOX_TOKEN') || ''
    const distanceKm = await roadDistance(fromLat, fromLng, toLat, toLng, distanceMethod, mapboxToken)
    const expiryDays = parseInt(await getConfig('journey_expiry_days')) || 90
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiryDays)

    const { count: journeyCount } = await supabase.from('submissions')
      .select('*', { count: 'exact', head: true }).eq('user_id', userId)
    const journeyNum = (journeyCount || 0) + 1

    // Check email verification config
    const verificationEnabled = (await getConfig('email_verification_enabled')) === 'true'

    // Generate PIN and token if verification is enabled
    let emailVerificationStatus = 'verification_skipped'
    let pin: string | null = null
    let verifyToken: string | null = null
    let pinExpiresAt: string | null = null

    if (verificationEnabled) {
      pin = String(Math.floor(1000 + Math.random() * 9000))  // 4-digit PIN: 1000–9999
      verifyToken = crypto.randomUUID()
      const expiry = new Date()
      expiry.setHours(expiry.getHours() + 24)  // 24-hour window — valid if user opens email later that day
      pinExpiresAt = expiry.toISOString()
      emailVerificationStatus = 'email_unverified'
    }

    const { data: submission, error: subError } = await supabase.from('submissions')
      .insert({
        from_location: fromLocation, from_point: `POINT(${fromLng} ${fromLat})`,
        from_lat: fromLat, from_lng: fromLng,
        to_location: toLocation, to_point: `POINT(${toLng} ${toLat})`,
        to_lat: toLat, to_lng: toLng,
        distance_pref: distancePrefKm, ip, country,
        user_id: userId, org_id: submissionOrgId,
        journey_status: 'active', journey_num: journeyNum,
        distance_km: Math.round(distanceKm * 10) / 10,
        expires_at: expiresAt.toISOString(),
        terms_version: resolvedTermsVersion,
        email_verification_status: emailVerificationStatus,
        email_verification_pin: pin,
        email_verification_token: verifyToken,
        email_verification_pin_expires_at: pinExpiresAt
      }).select('submission_id').single()
    if (subError) throw subError

    await supabase.from('events').insert({
      event_type: 'form_submitted', user_id: userId,
      submission_id: submission!.submission_id,
      metadata: { org_code: orgCode, distance_pref: distancePrefKm }
    })

    // Send PIN email fire-and-forget
    if (verificationEnabled && pin && verifyToken) {
      const siteUrl = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
      ;(async () => {
        try {
          await sendPinEmail(email, firstName, pin!, verifyToken!, siteUrl)
          console.log(`[submit-journey] PIN email sent to ${email} for submission ${submission!.submission_id}`)
        } catch (emailErr: any) {
          console.error(`[submit-journey] PIN email failed for ${email}:`, emailErr.message)
        }
      })()
    }

    // Trigger matching
    const matchingMode = await getConfig('matching_mode')
    if (matchingMode === 'hybrid' || matchingMode === 'instant') {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000)
      fetch(`${Deno.env.get('DB_URL')}/functions/v1/find-matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('DB_SERVICE_KEY')}` },
        body: JSON.stringify({ submissionId: submission!.submission_id }),
        signal: controller.signal
      }).then(() => clearTimeout(timeout)).catch((e: any) => {
        clearTimeout(timeout)
        console.error('find-matches trigger failed:', e.message)
      })
    }

    return new Response(JSON.stringify({
      success: true,
      submissionId: submission!.submission_id,
      journeyNum,
      actualDist: Math.round(distanceKm * 10) / 10,
      verificationRequired: verificationEnabled
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('submit-journey error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
