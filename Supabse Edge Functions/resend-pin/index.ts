import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

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
  <title>Your new Community Carpool journey PIN</title>
</head>
<body style="margin:0;padding:0;background:#F0F0ED;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">Your new PIN — enter it to activate your journey.&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0F0ED;">
<tr><td align="center" style="padding:32px 16px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">

    <tr>
      <td align="center" style="padding-bottom:20px;">
        <a href="https://communitycarpool.org" style="text-decoration:none;">
          <img src="https://communitycarpool.org/logo-slogan.png" alt="Community Carpool" style="height:48px;width:auto;display:block;margin:0 auto;" />
        </a>
      </td>
    </tr>

    <tr>
      <td style="background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,0.08);">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">

          <tr>
            <td style="background:#1B5C3A;padding:20px 28px 18px;border-radius:14px 14px 0 0;text-align:center;">
              <h1 style="margin:0;font-size:20px;font-weight:900;color:#FFFFFF;font-family:Montserrat,Inter,sans-serif;">Your New PIN</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#B4E035;">Hi ${firstName} — here is your new journey PIN.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 28px 24px;text-align:center;">
              <p style="margin:0 0 16px;font-size:13px;color:#6B7280;">Go back to the window and enter this PIN to activate your journey:</p>
              <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px;">
                <tr>
                  ${digits.map(d => `
                  <td style="padding:0 6px;">
                    <div style="width:56px;height:64px;border:2.5px solid #1B5C3A;border-radius:10px;background:#f0fdf4;display:inline-block;line-height:64px;text-align:center;font-size:32px;font-weight:900;color:#1B5C3A;font-family:Montserrat,Inter,sans-serif;">${d}</div>
                  </td>`).join('')}
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #E5E7EB;padding-bottom:16px;"></td></tr></table>

              <p style="margin:0 0 12px;font-size:13px;color:#6B7280;">Closed the window? Click below to confirm instantly:</p>
              <a href="${verifyLink}" style="display:inline-block;padding:11px 28px;background:#1B5C3A;color:#FFFFFF;border-radius:50px;text-decoration:none;font-size:14px;font-weight:700;font-family:Montserrat,Inter,sans-serif;">Confirm My Journey &rarr;</a>

              <!-- Journey Tracker — Step 1 active -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td style="border-top:1px solid #E5E7EB;padding-bottom:16px;"></td></tr></table>
              <div style="font-size:11px;font-weight:700;color:#1B5C3A;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;">Your Carpool Status</div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                <tr>
                  <td align="center" width="20%">
                    <div style="width:28px;height:28px;border-radius:50%;background:#B4E035;color:#1B5C3A;font-size:12px;font-weight:900;line-height:28px;margin:0 auto 4px;border:2px solid #1B5C3A;">1</div>
                    <div style="font-size:9px;color:#1B5C3A;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;line-height:1.3;word-break:break-word;">Joined the Pool</div>
                  </td>
                  <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
                  <td align="center" width="20%">
                    <div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">2</div>
                    <div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Matched</div>
                  </td>
                  <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
                  <td align="center" width="20%">
                    <div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">3</div>
                    <div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Connected</div>
                  </td>
                  <td style="padding-bottom:16px;width:8%;"><div style="height:2px;background:#E5E7EB;"></div></td>
                  <td align="center" width="20%">
                    <div style="width:28px;height:28px;border-radius:50%;background:#F3F4F6;color:#9CA3AF;font-size:12px;font-weight:600;line-height:28px;margin:0 auto 4px;">4</div>
                    <div style="font-size:9px;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;word-break:break-word;">Carpooling!</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding-top:20px;text-align:center;">
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
      subject: `Your new Community Carpool journey PIN`,
      html
    })
  })
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // ── Preview / test mode ──────────────────────────────────────────────────────
  const url = new URL(req.url)
  const testTo = url.searchParams.get('test_to')
  if (testTo) {
    const siteUrl = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
    await sendPinEmail(testTo, 'Alex', '1234', 'preview-token-000', siteUrl)
    return new Response(JSON.stringify({ preview: true, to: testTo }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  try {
    const { submissionId } = await req.json()
    if (!submissionId)
      return new Response(JSON.stringify({ success: false, error: 'submissionId required.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    // Fetch submission + user in one go via join
    const { data: sub } = await supabase
      .from('submissions')
      .select('submission_id, user_id, email_verification_status, users(email, name)')
      .eq('submission_id', submissionId)
      .single()

    if (!sub)
      return new Response(JSON.stringify({ success: false, error: 'Submission not found.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 })

    if (sub.email_verification_status === 'email_verified')
      return new Response(JSON.stringify({ success: true, alreadyVerified: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const user = sub.users as any
    if (!user?.email)
      return new Response(JSON.stringify({ success: false, error: 'User not found.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 })

    // Generate fresh PIN and token
    const pin = String(Math.floor(1000 + Math.random() * 9000))
    const verifyToken = crypto.randomUUID()
    const expiry = new Date()
    expiry.setHours(expiry.getHours() + 24)

    await supabase.from('submissions').update({
      email_verification_pin: pin,
      email_verification_token: verifyToken,
      email_verification_pin_expires_at: expiry.toISOString()
    }).eq('submission_id', submissionId)

    const siteUrl = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
    await sendPinEmail(user.email, user.name || 'there', pin, verifyToken, siteUrl)

    await supabase.from('events').insert({
      event_type: 'pin_resent',
      submission_id: submissionId,
      metadata: {}
    })

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('resend-pin error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
