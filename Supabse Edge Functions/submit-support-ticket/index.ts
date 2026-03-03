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

async function sendAdminEmail(ticket: any): Promise<void> {
  const notifyEmail = await getConfig('support_notify_email')
  if (!notifyEmail) return

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return

  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''
  const typeLabel: Record<string, string> = {
    deletion:    '🗑️ Data Deletion',
    report_user: '⚠️ Report a User',
    technical:   '🔧 Technical Issue'
  }

  const fields: Record<string, string> = {}
  if (ticket.email)                       fields['Submitted By']       = ticket.email
  if (ticket.issue_against_subject_email) fields['Issue Against']      = ticket.issue_against_subject_email
  if (ticket.issue_reported_type)         fields['Issue Type']         = ticket.issue_reported_type
  if (ticket.details_note)                fields['Details']            = ticket.details_note
  if (ticket.ip_address)                  fields['IP Address']         = ticket.ip_address

  const rows = Object.entries(fields)
    .map(([k, v]) => `<tr><td style="padding:6px 12px;color:#6b7280;font-size:13px;">${k}</td><td style="padding:6px 12px;font-size:13px;">${v}</td></tr>`)
    .join('')

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
      <div style="background:white;border-radius:16px;padding:32px;">
        <h2 style="color:#111827;margin-bottom:4px;">New Support Ticket #${ticket.ticket_id}</h2>
        <p style="color:#6b7280;margin-bottom:24px;">${typeLabel[ticket.request_type] || ticket.request_type}</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <tr style="background:#f9fafb;"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#9ca3af;">FIELD</th><th style="padding:8px 12px;text-align:left;font-size:12px;color:#9ca3af;">VALUE</th></tr>
          ${rows}
        </table>
      </div>
    </div></body></html>`

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Community Carpool Support <${fromEmail}>`,
      to: [notifyEmail],
      subject: `[Support #${ticket.ticket_id}] ${typeLabel[ticket.request_type] || ticket.request_type}${ticket.email ? ' — ' + ticket.email : ''}`,
      html
    })
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { requestType, ip, ...fields } = body

    if (!requestType) {
      return new Response(JSON.stringify({ success: false, error: 'requestType is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Deletion requests are handled exclusively by manage-deletion — never store tickets for them
    if (requestType === 'deletion') {
      return new Response(JSON.stringify({ success: false, error: 'Deletion requests must go through manage-deletion' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .insert({
        request_type:                requestType,
        email:                       fields.email                || null,
        issue_against_subject_email: fields.subjectEmail         || null,
        issue_reported_type:         fields.issueDescription     || null,
        details_note:                fields.details              || null,
        ip_address:                  ip                          || null
      })
      .select()
      .single()

    if (error) throw error

    sendAdminEmail(ticket).catch(e => console.error('Admin notify failed:', e))

    return new Response(JSON.stringify({ success: true, ticketId: ticket.ticket_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('submit-support-ticket error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
