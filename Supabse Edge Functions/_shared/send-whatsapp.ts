// ── WhatsApp template sender via Meta Cloud API ───────────────────────────────
// Used by: batch-send-emails, update-match-status
// The PIN sender (submit-journey, resend-pin) uses a dedicated template call
// (whatsapp_accountcreation_cc with a single pin_code param) — see pin-email.ts.

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  bodyParams: Array<{ parameter_name: string; text: string }>,
  buttonToken?: string
): Promise<void> {
  const accessToken   = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  if (!accessToken || !phoneNumberId)
    throw new Error('WhatsApp secrets not configured')

  const components: any[] = [{
    type: 'body',
    parameters: bodyParams.map(p => ({ type: 'text', parameter_name: p.parameter_name, text: p.text })),
  }]
  if (buttonToken) {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: buttonToken }] })
  }

  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: { name: templateName, language: { code: 'en' }, components },
    }),
  })
  if (!res.ok) throw new Error(`WhatsApp API error ${res.status}: ${await res.text()}`)
}
