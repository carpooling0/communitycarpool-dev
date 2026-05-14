import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')

    // ── GET: verify by link token (clicked from email) ──────────────────────────
    if (req.method === 'GET' && token) {
      const { data: sub } = await supabase
        .from('submissions')
        .select('submission_id, user_id, email_verification_status, email_verification_pin_expires_at, journey_num, distance_km')
        .eq('email_verification_token', token)
        .single()

      if (!sub)
        return new Response(JSON.stringify({ success: false, error: 'Invalid verification link.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

      if (sub.email_verification_status === 'email_verified')
        return new Response(JSON.stringify({
          success: true, alreadyVerified: true,
          submissionId: sub.submission_id,
          journeyNum: sub.journey_num,
          actualDist: sub.distance_km
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

      if (new Date(sub.email_verification_pin_expires_at) < new Date())
        return new Response(JSON.stringify({ success: false, error: 'This verification link has expired. Please request a new PIN.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

      await supabase.from('submissions').update({
        email_verification_status: 'email_verified',
        email_verification_pin: null,
        email_verification_token: null
      }).eq('submission_id', sub.submission_id)

      await supabase.from('events').insert({
        event_type: 'email_verified',
        submission_id: sub.submission_id,
        metadata: { method: 'link' }
      })

      return new Response(JSON.stringify({
        success: true,
        submissionId: sub.submission_id,
        journeyNum: sub.journey_num,
        actualDist: sub.distance_km
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── POST: verify by PIN (entered in modal) ───────────────────────────────────
    const { submissionId, pin } = await req.json()

    if (!submissionId || !pin)
      return new Response(JSON.stringify({ success: false, error: 'submissionId and pin required.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    const { data: sub } = await supabase
      .from('submissions')
      .select('submission_id, user_id, email_verification_status, email_verification_pin, email_verification_pin_expires_at, journey_num, distance_km')
      .eq('submission_id', submissionId)
      .single()

    if (!sub)
      return new Response(JSON.stringify({ success: false, error: 'Submission not found.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 })

    if (sub.email_verification_status === 'email_verified')
      return new Response(JSON.stringify({ success: true, alreadyVerified: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    if (!sub.email_verification_pin)
      return new Response(JSON.stringify({ success: false, error: 'No PIN found. Please request a new one.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    if (new Date(sub.email_verification_pin_expires_at) < new Date())
      return new Response(JSON.stringify({ success: false, error: 'PIN has expired. Please request a new one.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    if (sub.email_verification_pin !== String(pin))
      return new Response(JSON.stringify({ success: false, error: 'Incorrect PIN. Please try again.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    await supabase.from('submissions').update({
      email_verification_status: 'email_verified',
      email_verification_pin: null,
      email_verification_token: null
    }).eq('submission_id', submissionId)

    await supabase.from('events').insert({
      event_type: 'email_verified',
      submission_id: submissionId,
      metadata: { method: 'pin' }
    })

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('verify-pin error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
