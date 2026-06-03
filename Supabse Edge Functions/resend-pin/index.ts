import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendResendPinEmail, sendWhatsAppPin } from '../_shared/pin-email.ts'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // ── Preview / test mode ──────────────────────────────────────────────────────
  const url = new URL(req.url)
  const testTo = url.searchParams.get('test_to')
  if (testTo) {
    const siteUrl = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
    await sendResendPinEmail(testTo, 'Alex', '1234', 'preview-token-000', siteUrl)
    return new Response(JSON.stringify({ preview: true, to: testTo }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  try {
    const { submissionId, channel = 'email' } = await req.json()
    if (!submissionId)
      return new Response(JSON.stringify({ success: false, error: 'submissionId required.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

    // Fetch submission + user in one go via join
    const { data: sub } = await supabase
      .from('submissions')
      .select('submission_id, user_id, email_verification_status, whatsapp_number, whatsapp_verification_status, users(email, name)')
      .eq('submission_id', submissionId)
      .single()

    if (!sub)
      return new Response(JSON.stringify({ success: false, error: 'Submission not found.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 })

    const user = sub.users as any
    const newPin = String(Math.floor(1000 + Math.random() * 9000))

    // ── WhatsApp resend ──────────────────────────────────────────────────────
    if (channel === 'whatsapp') {
      if (!sub.whatsapp_number)
        return new Response(JSON.stringify({ success: false, error: 'No WhatsApp number on record.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })

      const waExpiry = new Date()
      waExpiry.setMinutes(waExpiry.getMinutes() + 15)

      await supabase.from('submissions').update({
        whatsapp_verification_pin:             newPin,
        whatsapp_verification_pin_expires_at:  waExpiry.toISOString(),
      }).eq('submission_id', submissionId)

      await sendWhatsAppPin(sub.whatsapp_number, newPin)
      console.log(`[resend-pin] WA PIN sent → ${sub.whatsapp_number} (submission ${submissionId})`)

      await supabase.from('events').insert({
        event_type: 'whatsapp_pin_resent',
        submission_id: submissionId,
        metadata: {}
      })

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── Email resend (default) ───────────────────────────────────────────────
    if (sub.email_verification_status === 'email_verified')
      return new Response(JSON.stringify({ success: true, alreadyVerified: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    if (!user?.email)
      return new Response(JSON.stringify({ success: false, error: 'User not found.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 })

    const verifyToken = crypto.randomUUID()
    const emailExpiry = new Date()
    emailExpiry.setMinutes(emailExpiry.getMinutes() + 15)

    await supabase.from('submissions').update({
      email_verification_pin:             newPin,
      email_verification_token:           verifyToken,
      email_verification_pin_expires_at:  emailExpiry.toISOString()
    }).eq('submission_id', submissionId)

    const siteUrl = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'
    await sendResendPinEmail(user.email, user.name || 'there', newPin, verifyToken, siteUrl)

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
