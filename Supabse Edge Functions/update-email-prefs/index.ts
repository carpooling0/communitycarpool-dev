import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

async function getTokenExpiry(): Promise<Date> {
  const { data } = await supabase.from('config').select('value').eq('key', 'match_token_expiry_days').single()
  const days = parseInt(data?.value || '120', 10)
  const expiry = new Date()
  expiry.setDate(expiry.getDate() - days)
  return expiry
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // GET — fetch current preferences for a token
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const token = url.searchParams.get('token')
      if (!token) {
        return new Response(JSON.stringify({ success: false, error: 'token required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const tokenExpiry = await getTokenExpiry()
      const { data: user } = await supabase
        .from('users')
        .select('unsubscribed_matches, unsubscribed_reminders, unsubscribed_marketing, unsubscribed_whatsapp')
        .eq('match_page_token', token)
        .gt('token_created_at', tokenExpiry.toISOString())
        .single()

      if (!user) {
        return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      return new Response(JSON.stringify({ success: true, prefs: user }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // POST — update preferences
    if (req.method === 'POST') {
      const { token, unsubscribedMatches, unsubscribedReminders, unsubscribedMarketing, unsubscribedWhatsapp } = await req.json()

      if (!token) {
        return new Response(JSON.stringify({ success: false, error: 'token required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Validate token and fetch current prefs in one query
      const tokenExpiry = await getTokenExpiry()
      const { data: user } = await supabase
        .from('users')
        .select('user_id, unsubscribed_matches, unsubscribed_reminders, unsubscribed_whatsapp')
        .eq('match_page_token', token)
        .gt('token_created_at', tokenExpiry.toISOString())
        .single()

      if (!user) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid or expired token' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Compute effective values (incoming overrides current)
      const effectiveMatches  = unsubscribedMatches  !== undefined ? unsubscribedMatches  : user.unsubscribed_matches
      const effectiveReminders= unsubscribedReminders!== undefined ? unsubscribedReminders: user.unsubscribed_reminders
      const effectiveWhatsapp = unsubscribedWhatsapp !== undefined ? unsubscribedWhatsapp : user.unsubscribed_whatsapp

      // Block: at least one of matches / reminders / WhatsApp must remain active
      if (effectiveMatches && effectiveReminders && effectiveWhatsapp) {
        return new Response(JSON.stringify({
          success: false,
          error: 'You must keep at least one notification channel active to receive your match updates.'
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const updateData: Record<string, any> = {}
      if (unsubscribedMatches   !== undefined) updateData.unsubscribed_matches   = unsubscribedMatches
      if (unsubscribedReminders !== undefined) updateData.unsubscribed_reminders = unsubscribedReminders
      if (unsubscribedMarketing !== undefined) updateData.unsubscribed_marketing = unsubscribedMarketing
      if (unsubscribedWhatsapp  !== undefined) updateData.unsubscribed_whatsapp  = unsubscribedWhatsapp

      // Set unsubscribed_at timestamp if any flag is being set to true
      if (Object.values(updateData).some(v => v === true)) updateData.unsubscribed_at = new Date().toISOString()

      // Clear timestamp if all are being set back to false
      if (unsubscribedMatches === false && unsubscribedReminders === false && unsubscribedMarketing === false && unsubscribedWhatsapp === false) {
        updateData.unsubscribed_at = null
      }

      const { error } = await supabase.from('users').update(updateData).eq('user_id', user.user_id)
      if (error) throw error

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('update-email-prefs error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
