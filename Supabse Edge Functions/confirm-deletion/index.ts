import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

async function getConfig(key: string): Promise<string> {
  const { data } = await supabase.from('config').select('value').eq('key', key).single()
  return data?.value || ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Support both GET (?token=...) and POST (JSON body)
    let token: string | null = null
    if (req.method === 'GET') {
      token = new URL(req.url).searchParams.get('token')
    } else {
      const body = await req.json()
      token = body.token
    }

    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'token required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Look up user by deletion token
    const { data: user } = await supabase
      .from('users')
      .select('user_id, name, email, deletion_token_expires_at, deletion_requested_at')
      .eq('deletion_token', token)
      .single()

    if (!user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid or expired link. Please submit a new deletion request.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check if already confirmed
    if (user.deletion_requested_at) {
      return new Response(JSON.stringify({ success: true, alreadyConfirmed: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check token expiry
    if (new Date(user.deletion_token_expires_at) < new Date()) {
      return new Response(JSON.stringify({ success: false, error: 'This link has expired. Please submit a new deletion request.' }), {
        status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const now = new Date().toISOString()

    // Confirm deletion: set timestamp, clear token, unsubscribe from everything
    await supabase.from('users').update({
      deletion_requested_at:     now,
      deletion_token:            null,
      deletion_token_expires_at: null,
      unsubscribed_matches:      true,
      unsubscribed_reminders:    true,
      unsubscribed_marketing:    true,
      unsubscribed_at:           now
    }).eq('user_id', user.user_id)

    // Notify admin
    const notifyEmail = await getConfig('support_notify_email')
    const resendKey   = Deno.env.get('RESEND_API_KEY')
    const fromEmail   = Deno.env.get('RESEND_FROM_EMAIL') || ''

    if (notifyEmail && resendKey && fromEmail) {
      const html = `<div style="font-family:Inter,sans-serif;padding:24px;max-width:600px;">
        <h2 style="color:#dc2626;margin-bottom:16px;">⚠️ Data Deletion Confirmed</h2>
        <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <tr style="background:#f9fafb;"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#9ca3af;">FIELD</th><th style="padding:8px 12px;text-align:left;font-size:12px;color:#9ca3af;">VALUE</th></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Name</td><td style="padding:8px 12px;font-size:13px;">${user.name}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Email</td><td style="padding:8px 12px;font-size:13px;">${user.email}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">User ID</td><td style="padding:8px 12px;font-size:13px;">${user.user_id}</td></tr>
          <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Confirmed At</td><td style="padding:8px 12px;font-size:13px;">${now}</td></tr>
        </table>
        <p style="color:#374151;font-size:14px;margin-top:16px;">Please process this data deletion within 30 days per your privacy policy. Delete all submissions, matches, events, and the user record for user_id = ${user.user_id}.</p>
      </div>`

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Community Carpool <${fromEmail}>`,
          to: [notifyEmail],
          subject: `[Data Deletion] ${user.name} (${user.email}) — confirmed`,
          html
        })
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('confirm-deletion error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
