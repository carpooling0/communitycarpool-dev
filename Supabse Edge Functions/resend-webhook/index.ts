import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)

// ── Svix webhook signature verification ─────────────────────────────────────
// Resend uses Svix to deliver webhooks. The signing secret lives in the
// Resend dashboard (Webhooks → your endpoint → Signing Secret).
// Format: "whsec_<base64-encoded-bytes>"
// Docs: https://resend.com/docs/dashboard/webhooks/introduction
async function verifyResendSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  rawBody: string
): Promise<boolean> {
  // Reject events older than 5 minutes (replay attack protection)
  const tsMs = parseInt(svixTimestamp, 10) * 1000
  if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) return false

  // Decode the secret: strip "whsec_" prefix and base64-decode
  const secretBytes = Uint8Array.from(
    atob(secret.replace(/^whsec_/, '')),
    c => c.charCodeAt(0)
  )

  // Import as HMAC-SHA256 key
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )

  // Message = "svix-id.svix-timestamp.raw-body"
  const message = `${svixId}.${svixTimestamp}.${rawBody}`
  const encoder = new TextEncoder()
  const signatureBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  const computedSig = btoa(String.fromCharCode(...new Uint8Array(signatureBuf)))

  // svix-signature can contain multiple space-separated sigs (for key rotation):
  // "v1,base64sig1 v1,base64sig2"
  for (const part of svixSignature.split(' ')) {
    const [version, sig] = part.split(',')
    if (version === 'v1' && sig === computedSig) return true
  }
  return false
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }, status
  })
}

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // Only accept POST
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  if (!webhookSecret) {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET not set')
    return json({ error: 'Webhook secret not configured' }, 500)
  }

  // Read raw body (must be done before any json parsing for signature verification)
  const rawBody = await req.text()

  // Verify Svix signature
  const svixId        = req.headers.get('svix-id') || ''
  const svixTimestamp = req.headers.get('svix-timestamp') || ''
  const svixSignature = req.headers.get('svix-signature') || ''

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.warn('[resend-webhook] Missing Svix headers')
    return json({ error: 'Missing webhook signature headers' }, 400)
  }

  const valid = await verifyResendSignature(
    webhookSecret, svixId, svixTimestamp, svixSignature, rawBody
  )
  if (!valid) {
    console.warn('[resend-webhook] Signature verification failed')
    return json({ error: 'Invalid webhook signature' }, 401)
  }

  // Parse event
  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const eventType = event.type as string   // e.g. "email.delivered"
  const data      = event.data || {}

  // We only care about email delivery events
  const trackedTypes = [
    'email.sent', 'email.delivered', 'email.delivery_delayed',
    'email.bounced', 'email.opened', 'email.clicked', 'email.complained'
  ]
  if (!trackedTypes.includes(eventType)) {
    // Acknowledge without storing (e.g. email.unsubscribed handled elsewhere)
    return json({ received: true, stored: false, reason: 'Event type not tracked' })
  }

  // Extract fields from the Resend event payload
  const messageId  = data.email_id as string | undefined   // e.g. "re_xxxx"
  const recipient  = Array.isArray(data.to) ? data.to[0] : data.to as string | undefined
  const tags       = (data.tags as Array<{ name: string; value: string }> | undefined) || []
  const batchId    = tags.find(t => t.name === 'batch_id')?.value || null
  const occurredAt = event.created_at as string | undefined

  // Store the event — provider-agnostic schema so SES/SendGrid webhooks can write here too
  const { error } = await supabase.from('email_events').insert({
    event_type:  eventType,
    message_id:  messageId  || null,
    provider:    'resend',
    recipient:   recipient  || null,
    batch_id:    batchId,
    raw_payload: event,
    occurred_at: occurredAt || new Date().toISOString()
  })

  if (error) {
    console.error('[resend-webhook] DB insert error:', error.message)
    return json({ error: 'Failed to store event' }, 500)
  }

  console.log(`[resend-webhook] Stored ${eventType} for message_id=${messageId}, batch=${batchId}`)
  return json({ received: true, stored: true, eventType })
})
