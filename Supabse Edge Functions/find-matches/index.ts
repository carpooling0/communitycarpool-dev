import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// ── Distance modes ────────────────────────────────────────────────────────────
// 'haversine' → straight-line for everything
// 'mapbox'    → Mapbox Directions API for everything (proximity + disambiguation)
// 'hybrid'    → Mapbox for proximity scoring, haversine for direction disambiguation
// ─────────────────────────────────────────────────────────────────────────────

async function mapboxDistance(
  lat1: number, lng1: number, lat2: number, lng2: number,
  mapboxToken: string
): Promise<number> {
  // Mapbox Directions: coordinates are lng,lat (note order)
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lng1},${lat1};${lng2},${lat2}` +
    `?access_token=${mapboxToken}&overview=false&steps=false`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`)
  const json = await res.json()
  if (!json.routes?.length) throw new Error('No route found')
  return json.routes[0].distance / 1000  // metres → km
}

// calcDistance: respects distance_method config for proximity scoring
// 'mapbox' | 'hybrid' → Mapbox; 'haversine' → straight-line
async function calcDistance(
  lat1: number, lng1: number, lat2: number, lng2: number,
  method: string, mapboxToken: string
): Promise<number> {
  if (method === 'haversine') {
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
  // mapbox or hybrid — both use Mapbox for proximity scoring
  if (!mapboxToken) {
    console.error(`MAPBOX_TOKEN not set but distance_method='${method}' — falling back to haversine. Set MAPBOX_TOKEN in Edge Function secrets.`)
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
  try {
    return await mapboxDistance(lat1, lng1, lat2, lng2, mapboxToken)
  } catch (err: any) {
    console.error(`Mapbox failed, falling back to haversine: ${err.message}`)
    return haversineDistance(lat1, lng1, lat2, lng2)
  }
}

// disambiguateDirection: picks same vs reverse for candidates appearing in both spatial lists.
// 'mapbox'              → 4 Mapbox calls (fully accurate road distances)
// 'haversine' | 'hybrid' → haversine (O(1), sufficient — relative comparison only)
async function disambiguateDirection(
  fromLat: number, fromLng: number, toLat: number, toLng: number,
  candFromLat: number, candFromLng: number, candToLat: number, candToLng: number,
  method: string, mapboxToken: string
): Promise<boolean> {  // returns true if reversed
  if (method === 'mapbox' && mapboxToken) {
    // All 4 legs via Mapbox — parallel calls
    const [sdStart, sdEnd, rvStart, rvEnd] = await Promise.all([
      calcDistance(fromLat, fromLng, candFromLat, candFromLng, method, mapboxToken),
      calcDistance(toLat,   toLng,   candToLat,   candToLng,   method, mapboxToken),
      calcDistance(fromLat, fromLng, candToLat,   candToLng,   method, mapboxToken),
      calcDistance(toLat,   toLng,   candFromLat, candFromLng, method, mapboxToken),
    ])
    return (rvStart + rvEnd) < (sdStart + sdEnd)
  }
  // haversine or hybrid: straight-line is sufficient for relative direction comparison
  const sameDirTotal  = haversineDistance(fromLat, fromLng, candFromLat, candFromLng)
                      + haversineDistance(toLat,   toLng,   candToLat,   candToLng)
  const reversedTotal = haversineDistance(fromLat, fromLng, candToLat,   candToLng)
                      + haversineDistance(toLat,   toLng,   candFromLat, candFromLng)
  return reversedTotal < sameDirTotal
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { submissionId } = await req.json()

    // Read distance method config and Mapbox token once per request
    const { data: methodConfig } = await supabase.from('config').select('value').eq('key', 'distance_method').single()
    const distanceMethod = methodConfig?.value || 'haversine'  // 'haversine' | 'mapbox' | 'hybrid'
    const mapboxToken = Deno.env.get('MAPBOX_TOKEN') || ''

    // Warn early if Mapbox expected but token missing
    if ((distanceMethod === 'mapbox' || distanceMethod === 'hybrid') && !mapboxToken) {
      console.error(`distance_method='${distanceMethod}' but MAPBOX_TOKEN is not set — all distances will use haversine fallback. Set MAPBOX_TOKEN in Supabase Edge Function secrets.`)
    }

    // Fetch submission coords as floats (stored directly — no WKB parsing needed)
    const { data: sub, error: subError } = await supabase.rpc('get_submission_coords', { p_id: submissionId }).single()
    if (subError || !sub) throw new Error('Submission not found')

    const fromLat = sub.from_lat as number
    const fromLng = sub.from_lng as number
    const toLat   = sub.to_lat   as number
    const toLng   = sub.to_lng   as number
    const radiusMeters = (sub.distance_pref || 3) * 1000

    const rpcParams = {
      radius_meters:  radiusMeters,
      exclude_email:  sub.email,
      exclude_id:     submissionId,
      exclude_org_id: sub.org_id
    }

    // ── Call 1: same-direction candidates ──────────────────────────────────
    const { data: sameDirCandidates } = await supabase.rpc('find_nearby_users', {
      user_from_lat: fromLat, user_from_lng: fromLng,
      user_to_lat:   toLat,   user_to_lng:   toLng,
      ...rpcParams
    })

    // ── Call 2: reverse-direction candidates ───────────────────────────────
    const { data: reverseCandidates } = await supabase.rpc('find_nearby_users', {
      user_from_lat: toLat,   user_from_lng: toLng,
      user_to_lat:   fromLat, user_to_lng:   fromLng,
      ...rpcParams
    })

    // ── Merge, deduplicate, tag reversed candidates ────────────────────────
    const sameDirIds = new Set((sameDirCandidates  || []).map((c: any) => c.submission_id))
    const reverseIds = new Set((reverseCandidates  || []).map((c: any) => c.submission_id))

    const allCandidates: any[] = []
    const seen = new Set<number>()

    // Candidates only in same-dir list → unambiguously same-direction
    for (const c of (sameDirCandidates || [])) {
      if (!reverseIds.has(c.submission_id)) {
        allCandidates.push({ ...c, _reversed: false })
        seen.add(c.submission_id)
      }
    }
    // Candidates only in reverse list → unambiguously reversed
    for (const c of (reverseCandidates || [])) {
      if (!sameDirIds.has(c.submission_id)) {
        allCandidates.push({ ...c, _reversed: true })
        seen.add(c.submission_id)
      }
    }
    // Candidates in BOTH lists → disambiguate direction using configured method
    // 'mapbox': 4 Mapbox calls per ambiguous candidate (fully accurate)
    // 'haversine'|'hybrid': haversine (O(1), sufficient for relative comparison)
    for (const c of (sameDirCandidates || [])) {
      if (seen.has(c.submission_id)) continue
      const isReversed = await disambiguateDirection(
        fromLat, fromLng, toLat, toLng,
        c.from_lat, c.from_lng, c.to_lat, c.to_lng,
        distanceMethod, mapboxToken
      )
      allCandidates.push({ ...c, _reversed: isReversed })
      seen.add(c.submission_id)
    }

    if (allCandidates.length === 0) {
      return new Response(JSON.stringify({ success: true, matchesFound: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let matchesFound = 0

    for (const candidate of allCandidates) {
      const minId = Math.min(submissionId, candidate.submission_id)
      const maxId = Math.max(submissionId, candidate.submission_id)
      const { data: existing } = await supabase.from('matches')
        .select('match_id').eq('sub_a_id', minId).eq('sub_b_id', maxId).single()
      if (existing) continue

      const candFromLat = candidate.from_lat as number
      const candFromLng = candidate.from_lng as number
      const candToLat   = candidate.to_lat   as number
      const candToLng   = candidate.to_lng   as number
      const isReversed  = candidate._reversed === true

      // ── Compute pickup/dropoff proximity ────────────────────────────────
      // Same-direction:  my FROM ↔ their FROM,  my TO ↔ their TO
      // Reverse-route:   my FROM ↔ their TO,    my TO ↔ their FROM
      const [startDist, endDist] = await Promise.all([
        isReversed
          ? calcDistance(fromLat, fromLng, candToLat,   candToLng,   distanceMethod, mapboxToken)
          : calcDistance(fromLat, fromLng, candFromLat, candFromLng, distanceMethod, mapboxToken),
        isReversed
          ? calcDistance(toLat, toLng, candFromLat, candFromLng, distanceMethod, mapboxToken)
          : calcDistance(toLat, toLng, candToLat,   candToLng,   distanceMethod, mapboxToken)
      ])

      const maxRadius = Math.max(sub.distance_pref || 3, candidate.distance_pref || 3)

      if (startDist <= maxRadius && endDist <= maxRadius) {
        const matchStrength = Math.round(Math.max(0, Math.min(100,
          100 * (1 - (startDist + endDist) / (2 * maxRadius * 2))
        )))

        const { error: matchError } = await supabase.from('matches').insert({
          sub_a_id: minId, sub_b_id: maxId,
          match_strength: matchStrength,
          status: 'new',
          notification_sent: false
        })

        if (!matchError) {
          matchesFound++
          await supabase.from('events').insert({
            event_type:    'match_detected',
            submission_id: submissionId,
            metadata: {
              matched_with:    candidate.submission_id,
              start_dist:      Math.round(startDist * 10) / 10,
              end_dist:        Math.round(endDist   * 10) / 10,
              match_strength:  matchStrength,
              direction:       isReversed ? 'reverse' : 'same',
              distance_method: distanceMethod
            }
          })
        }
      }
    }

    // ── Instant email notification ─────────────────────────────────────────
    if (matchesFound > 0) {
      const { data: modeConfig } = await supabase.from('config').select('value').eq('key', 'matching_mode').single()
      if (modeConfig?.value === 'instant') {
        fetch(`${Deno.env.get('DB_URL')}/functions/v1/batch-send-emails`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('DB_SERVICE_KEY')}`
          }
        }).catch((e: any) => console.error('batch-send-emails trigger failed:', e.message))
      }
    }

    return new Response(JSON.stringify({ success: true, matchesFound }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('find-matches error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    })
  }
})
