import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email } = await req.json()

    if (!email || !String(email).includes('@')) {
      return new Response(JSON.stringify({ success: false, error: 'Valid email required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const cleanEmail = String(email).toLowerCase().trim()

    // Look up user by email
    const { data: user } = await supabase
      .from('users')
      .select('user_id, name')
      .eq('email', cleanEmail)
      .single()

    // Always return success — prevents email enumeration attacks
    if (!user) {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check if deletion already confirmed (not just requested)
    // Allow re-sending token even if one already exists (in case email was missed)

    // Generate secure deletion token — valid for 24 hours
    const deletionToken = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    await supabase.from('users').update({
      deletion_token: deletionToken,
      deletion_token_expires_at: expiresAt
    }).eq('user_id', user.user_id)

    // Send confirmation email via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''

    if (resendKey && fromEmail) {
      const confirmUrl = `${SITE_URL}/confirm-deletion.html?token=${deletionToken}`
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
      <body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
        <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
          <div style="text-align:center;margin-bottom:32px;">
            <a href="${SITE_URL}">
              <img src="${SITE_URL}/logo_with_slogan.png" alt="Community Carpool" style="height:60px;width:auto;">
            </a>
          </div>
          <div style="background:white;border-radius:16px;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <h2 style="color:#111827;font-size:20px;margin:0 0 20px;">Confirm Data Deletion</h2>
            <p style="color:#374151;font-size:15px;margin:0 0 12px;">Hi ${user.name},</p>
            <p style="color:#374151;font-size:15px;margin:0 0 12px;">We received a request to permanently delete your Community Carpool account and all associated data, including your journey registrations and match history.</p>
            <p style="color:#374151;font-size:15px;margin:0 0 24px;">To confirm this request, click the button below. <strong>This link expires in 24 hours.</strong></p>
            <div style="text-align:center;margin-bottom:28px;">
              <a href="${confirmUrl}" style="display:inline-block;background:#dc2626;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;">Confirm Deletion →</a>
            </div>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px;">
            <p style="color:#6b7280;font-size:13px;margin:0;line-height:1.6;">If you did not request this, you can safely ignore this email — your data will not be deleted. If you are concerned, please <a href="${SITE_URL}/support.html" style="color:#16a34a;">contact support</a>.</p>
          </div>
          <div style="text-align:center;margin-top:24px;color:#9ca3af;font-size:13px;">
            Community Carpool &middot; communitycarpool.org
          </div>
        </div>
      </body></html>`

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Community Carpool <${fromEmail}>`,
          to: [cleanEmail],
          subject: 'Confirm your data deletion request — Community Carpool',
          html
        })
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('request-deletion error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
