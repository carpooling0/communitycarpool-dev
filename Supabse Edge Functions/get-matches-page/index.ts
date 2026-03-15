import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function maskName(name: string): string {
  return name.trim().split(' ').map(part => part.length > 0 ? part[0] + '*'.repeat(Math.max(part.length - 1, 2)) : '').join(' ')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    const isPoll = url.searchParams.get('poll') === 'true'
    if (!token) return new Response(JSON.stringify({ success: false, error: 'Token required' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    // Fetch config values in one query (no extra round-trip)
    const { data: configs } = await supabase.from('config').select('key, value')
      .in('key', ['match_token_expiry_days', 'match_poll_interval_seconds', 'required_terms_version'])
    const configMap = Object.fromEntries((configs || []).map((c: any) => [c.key, c.value]))
    const tokenExpiryDays = parseInt(configMap['match_token_expiry_days'] || '60')
    const pollIntervalSeconds = parseInt(configMap['match_poll_interval_seconds'] || '10')
    const requiredTermsVersion: string | null = configMap['required_terms_version'] || null
    const tokenExpiry = new Date()
    tokenExpiry.setDate(tokenExpiry.getDate() - tokenExpiryDays)

    const { data: user, error: userError } = await supabase.from('users')
      .select('user_id, name, email, token_created_at, terms_accepted_version')
      .eq('match_page_token', token)
      .gt('token_created_at', tokenExpiry.toISOString())
      .single()
    if (userError || !user) return new Response(JSON.stringify({ success: false, error: 'Invalid or expired token. Please request a new match email.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 })

    // Fetch unread notifications for this user, then mark them read
    const { data: rawNotifs } = await supabase.from('user_notifications')
      .select('notification_id, message, type, created_at')
      .eq('user_id', user.user_id)
      .is('read_at', null)
      .order('created_at', { ascending: true })
    const notifications = (rawNotifs || []).map((n: any) => ({
      id: n.notification_id, message: n.message, type: n.type, createdAt: n.created_at
    }))
    if (notifications.length > 0) {
      const ids = (rawNotifs || []).map((n: any) => n.notification_id)
      await supabase.from('user_notifications').update({ read_at: new Date().toISOString() }).in('notification_id', ids)
    }

    // Get all submissions for this user
    const { data: submissions } = await supabase.from('submissions')
      .select('submission_id, journey_num, from_location, to_location, journey_status, distance_km, interest_while_inactive')
      .eq('user_id', user.user_id).order('created_at', { ascending: false })

    // Batch fetch ALL matches for ALL submissions in ONE query — was O(n) round-trips
    const subIds = (submissions || []).map((s: any) => s.submission_id)
    let allMatchesRaw: any[] = []
    if (subIds.length > 0) {
      const orFilter = subIds.map((id: number) => `sub_a_id.eq.${id},sub_b_id.eq.${id}`).join(',')
      const { data: matchData } = await supabase.from('matches')
        .select(`
          match_id, match_strength, created_at, status, sub_a_id, sub_b_id,
          interest_a, interest_b, interest_a_at, interest_b_at, success_reported,
          sub_a:submissions!sub_a_id (submission_id, from_location, to_location, from_lat, from_lng, to_lat, to_lng, users(name, email)),
          sub_b:submissions!sub_b_id (submission_id, from_location, to_location, from_lat, from_lng, to_lat, to_lng, users(name, email))
        `)
        .or(orFilter)
        .order('created_at', { ascending: false })
      allMatchesRaw = matchData || []
    }

    // Group matches by the user's submission ID
    const matchesBySubmission = new Map<number, any[]>()
    for (const id of subIds) matchesBySubmission.set(id, [])
    for (const match of allMatchesRaw) {
      if (matchesBySubmission.has(match.sub_a_id)) matchesBySubmission.get(match.sub_a_id)!.push(match)
      if (matchesBySubmission.has(match.sub_b_id)) matchesBySubmission.get(match.sub_b_id)!.push(match)
    }

    const journeys = []
    for (const sub of submissions || []) {
      const matches = matchesBySubmission.get(sub.submission_id) || []

      const formattedMatches = matches.map(match => {
        const isSubA = match.sub_a_id === sub.submission_id
        const otherSub = isSubA ? match.sub_b : match.sub_a
        const otherUser = otherSub?.users
        // Guard: skip orphaned matches where the partner's submission or user was deleted
        if (!otherSub || !otherUser) return null

        const myInterest = isSubA ? match.interest_a : match.interest_b
        const theirInterest = isSubA ? match.interest_b : match.interest_a
        const theirInterestAt = isSubA ? match.interest_b_at : match.interest_a_at
        const isMutual = match.status === 'mutual_confirmed' || match.status === 'contact_revealed'

        return {
          matchId: match.match_id,
          matchStrength: match.match_strength,
          createdAt: match.created_at,
          status: match.status,
          myInterest,
          theirInterest,
          theirInterestAt: theirInterestAt || null,
          isMutual,
          successReported: match.success_reported || false,
          otherUser: {
            name: isMutual ? otherUser.name : maskName(otherUser.name),
            email: isMutual ? otherUser.email : null,
            fromLocation: otherSub.from_location,
            toLocation: otherSub.to_location,
            fromLat: otherSub.from_lat ?? null,
            fromLng: otherSub.from_lng ?? null,
            toLat: otherSub.to_lat ?? null,
            toLng: otherSub.to_lng ?? null
          }
        }
      }).filter(Boolean)

      const pendingCount = formattedMatches.filter((m: any) => !m.myInterest && (m.status === 'notified' || m.status === 'viewed' || m.status === 'interest_expressed')).length

      journeys.push({
        submissionId: sub.submission_id,
        journeyNum: sub.journey_num,
        fromLocation: sub.from_location,
        toLocation: sub.to_location,
        journeyStatus: sub.journey_status,
        distanceKm: sub.distance_km,
        pendingCount,
        hasInactiveInterest: sub.interest_while_inactive,
        matches: formattedMatches
      })
    }

    // Track event — only on initial load, not polls
    if (!isPoll) {
      await supabase.from('events').insert({ event_type: 'matches_page_viewed', user_id: user.user_id, metadata: { token_used: true } })
    }

    // Check if user needs to re-accept updated T&Cs
    const termsAcceptanceRequired = requiredTermsVersion !== null &&
      (user as any).terms_accepted_version !== requiredTermsVersion

    return new Response(JSON.stringify({
      success: true,
      user: { name: user.name, email: user.email },
      journeys, pollIntervalSeconds, notifications,
      termsAcceptanceRequired: termsAcceptanceRequired || false,
      requiredTermsVersion: termsAcceptanceRequired ? requiredTermsVersion : null
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
