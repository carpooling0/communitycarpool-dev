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
    return json.routes[0].distance / 1000  // metres → km
  } catch (err: any) {
    console.error(`Mapbox failed, falling back to haversine: ${err.message}`)
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { firstName, email, fromLocation, fromLatLng, toLocation, toLatLng, distance, distanceValue, ip, country, orgCode,
            refCode, utmSource, utmMedium, utmCampaign, termsVersion } = body

    // 1. Check blacklist
    const { data: blacklisted } = await supabase
      .from('blacklist').select('blacklist_id').eq('email', email.toLowerCase()).single()
    if (blacklisted) {
      return new Response(JSON.stringify({ success: false, error: 'This email is not permitted to register.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 })
    }

    // 2. Parse coordinates
    const [fromLat, fromLng] = fromLatLng.split(',').map(Number)
    const [toLat, toLng] = toLatLng.split(',').map(Number)

    // 3. Get or create user
    let userId: number
    let userJourneyLimit: number | null = null
    const { data: existingUser } = await supabase
      .from('users').select('user_id, journey_limit, ref_code, deletion_requested_at').eq('email', email.toLowerCase()).single()

    if (existingUser) {
      // Block journey creation if a confirmed deletion request is pending
      if (existingUser.deletion_requested_at) {
        return new Response(JSON.stringify({ success: false, error: 'Your account is scheduled for deletion. You cannot create new journeys. Contact support if you changed your mind.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 })
      }
      userId = existingUser.user_id
      userJourneyLimit = existingUser.journey_limit
      const updates: Record<string, any> = { last_seen_at: new Date().toISOString(), name: firstName, ...(termsVersion ? { terms_accepted_version: termsVersion } : {}) }
      // Only set ref_code on first touch — never overwrite existing attribution
      if (!existingUser.ref_code && refCode) {
        updates.ref_code = refCode
      }
      await supabase.from('users').update(updates).eq('user_id', userId)
      // Insert UTM attribution row if any UTM params present (first touch only)
      if (!existingUser.ref_code && (utmSource || utmMedium || utmCampaign)) {
        await supabase.from('user_attribution').insert({
          user_id: userId,
          utm_source:   utmSource   || null,
          utm_medium:   utmMedium   || null,
          utm_campaign: utmCampaign || null,
        })
      }
    } else {
      const { data: newUser, error: insertError } = await supabase.from('users')
        .insert({
          email: email.toLowerCase(), name: firstName, last_seen_at: new Date().toISOString(),
          ref_code: refCode || null,
          terms_accepted_version: termsVersion || null,
        })
        .select('user_id').single()
      if (insertError) {
        // Race condition: another concurrent request already inserted this email
        // (unique constraint code 23505) — recover by fetching the existing row
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
      // Insert UTM attribution row for new user if any UTM params present
      if (utmSource || utmMedium || utmCampaign) {
        await supabase.from('user_attribution').insert({
          user_id: userId,
          utm_source:   utmSource   || null,
          utm_medium:   utmMedium   || null,
          utm_campaign: utmCampaign || null,
        })
      }
    }

    // 4. Check journey limit — per-user override takes priority over global config
    const globalLimit = parseInt(await getConfig('max_journeys_per_user')) || 10
    const journeyLimit = userJourneyLimit ?? globalLimit  // use per-user if set
    const { count: activeJourneys } = await supabase.from('submissions')
      .select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('journey_status', 'active')
    if ((activeJourneys || 0) >= journeyLimit) {
      return new Response(JSON.stringify({ success: false, error: `Maximum of ${journeyLimit} active journeys reached. Please archive an existing journey first.` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
    }

    // 5. Get org_id for this submission (org belongs to submission, not user)
    let submissionOrgId = null
    if (orgCode) {
      const { data: org } = await supabase.from('organisations').select('org_id').eq('org_code', orgCode.toLowerCase()).eq('is_active', true).single()
      submissionOrgId = org?.org_id || null
    }

    // 6. Calculate distance and expiry
    const distancePrefMap: { [key: string]: number } = { '1': 3, '2': 5, '3': 8, '4': 10 }
    const distancePrefKm = distancePrefMap[distanceValue] || 3
    const distanceMethod = await getConfig('distance_method') || 'haversine'
    const mapboxToken = Deno.env.get('MAPBOX_TOKEN') || ''
    const distanceKm = await roadDistance(fromLat, fromLng, toLat, toLng, distanceMethod, mapboxToken)
    const expiryDays = parseInt(await getConfig('journey_expiry_days')) || 90
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiryDays)

    // 7. Get journey number
    const { count: journeyCount } = await supabase.from('submissions')
      .select('*', { count: 'exact', head: true }).eq('user_id', userId)
    const journeyNum = (journeyCount || 0) + 1

    // 8. Insert submission (name/email live in users table, ip/country/org_id belong to submission)
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
        terms_version: termsVersion || null
      }).select('submission_id').single()
    if (subError) throw subError

    // 9. Track event
    await supabase.from('events').insert({
      event_type: 'form_submitted', user_id: userId,
      submission_id: submission!.submission_id,
      metadata: { org_code: orgCode, distance_pref: distancePrefKm }
    })

    // 10. Trigger matching
    const matchingMode = await getConfig('matching_mode')
    if (matchingMode === 'hybrid' || matchingMode === 'instant') {
      // Fire-and-forget with 30s timeout — don't block the response waiting for matching to complete
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
      success: true, submissionId: submission!.submission_id,
      journeyNum, actualDist: Math.round(distanceKm * 10) / 10
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('submit-journey error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), 
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
