import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const IP_LIMIT_PER_DAY = 3

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const {
      rating,
      comment,
      source,
      pageContext,
      token,
      matchId,
      formOpenedAt,
      honeypot,
      ip
    } = body

    // 1. Honeypot — silent discard if filled
    if (honeypot) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 2. Minimum time check — reject if submitted in under 2 seconds
    if (formOpenedAt && Date.now() - formOpenedAt < 2000) {
      return new Response(JSON.stringify({ success: false, error: 'Too fast' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 3. Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid rating' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!source || !['carpool_confirm', 'footer_link'].includes(source)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid source' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. IP rate limit — max 3 per IP per 24h
    if (ip) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { count } = await supabase
        .from('feedback')
        .select('*', { count: 'exact', head: true })
        .eq('ip_address', ip)
        .gte('created_at', since)

      if ((count ?? 0) >= IP_LIMIT_PER_DAY) {
        return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 5. Resolve user from token if provided
    let userId: number | null = null
    let resolvedMatchId: number | null = matchId || null

    if (token) {
      const { data: sub } = await supabase
        .from('submissions')
        .select('user_id')
        .eq('access_token', token)
        .single()
      if (sub) userId = sub.user_id
    }

    // 6. Insert feedback
    const { data: feedback, error } = await supabase
      .from('feedback')
      .insert({
        match_id:              resolvedMatchId,
        submitted_by_user_id:  userId,
        rating,
        comment:               comment || null,
        source,
        page_context:          pageContext || null,
        ip_address:            ip || null
      })
      .select()
      .single()

    if (error) {
      // Unique constraint — already submitted for this match
      if (error.code === '23505') {
        return new Response(JSON.stringify({ success: false, error: 'Already submitted' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      throw error
    }

    return new Response(JSON.stringify({ success: true, feedbackId: feedback.feedback_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('submit-feedback error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
