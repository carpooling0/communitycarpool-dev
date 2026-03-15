import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const VALID_EVENTS = ['page_visited','form_started','form_submitted','form_resubmitted','matches_page_viewed','match_interest_expressed','match_declined','journey_deactivated','unsubscribed','carpooling_reported','carpooling_undo','match_email_opened']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { eventType, token, submissionId, matchId, metadata } = await req.json()
    if (!VALID_EVENTS.includes(eventType)) return new Response(JSON.stringify({ success: false, error: 'Invalid event type' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    let userId = null
    if (token) {
      // Validate token with expiry check (same policy as get-matches-page)
      const { data: expConfig } = await supabase.from('config').select('value').eq('key', 'match_token_expiry_days').single()
      const expiryDays = parseInt(expConfig?.value || '120', 10)
      const tokenExpiry = new Date()
      tokenExpiry.setDate(tokenExpiry.getDate() - expiryDays)
      const { data: user } = await supabase.from('users').select('user_id')
        .eq('match_page_token', token)
        .gt('token_created_at', tokenExpiry.toISOString())
        .single()
      userId = user?.user_id || null
    }

    const userAgent = req.headers.get('user-agent') || ''
    let deviceType = 'desktop'
    if (/mobile/i.test(userAgent)) deviceType = 'mobile'
    else if (/tablet|ipad/i.test(userAgent)) deviceType = 'tablet'

    // Run events insert and matches update in parallel — cuts latency from ~200ms to ~100ms
    const dbOps: Promise<any>[] = []

    // Events insert — best-effort
    dbOps.push(
      supabase.from('events').insert({
        event_type: eventType, user_id: userId,
        submission_id: submissionId || null, match_id: matchId || null,
        metadata: metadata || {}, device_type: deviceType
      })
    )

    // Matches update — critical path for carpool events
    if (eventType === 'carpooling_reported' && matchId) {
      dbOps.push(
        supabase.from('matches')
          .update({ success_reported: true, success_reported_at: new Date().toISOString() })
          .eq('match_id', matchId)
      )
    } else if (eventType === 'carpooling_undo' && matchId) {
      dbOps.push(
        supabase.from('matches')
          .update({ success_reported: false, success_reported_at: null })
          .eq('match_id', matchId)
      )
    }

    await Promise.allSettled(dbOps)

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('track-event error:', err)
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
