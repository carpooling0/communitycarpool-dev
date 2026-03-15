/**
 * process-deletions — Daily cron job
 *
 * Permanently deletes users whose deletion_requested_at exceeded the retention window.
 * Schedule via Supabase Dashboard → Edge Functions → process-deletions → Schedule
 * Recommended schedule: daily at 02:00 GST (22:00 UTC)
 *
 * Requires: Authorization header with Supabase service role key
 */
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

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || ''
  if (!resendKey || !fromEmail) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Community Carpool <${fromEmail}>`, to: [to], subject, html })
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const retentionDays = parseInt(await getConfig('data_retention_days') || '30', 10)
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()

    // Find users whose retention window has passed
    const { data: usersToDelete, error: fetchErr } = await supabase
      .from('users')
      .select('user_id, email, name, deletion_requested_at')
      .not('deletion_requested_at', 'is', null)
      .lt('deletion_requested_at', cutoff)

    if (fetchErr) throw fetchErr
    if (!usersToDelete || usersToDelete.length === 0) {
      return json({ success: true, message: 'No users due for deletion', deleted: 0 })
    }

    console.log(`[process-deletions] Found ${usersToDelete.length} user(s) to delete`)

    const results: { userId: number; email: string; status: string }[] = []

    for (const user of usersToDelete) {
      try {
        // 1. Get submission IDs
        const { data: subs } = await supabase
          .from('submissions')
          .select('submission_id')
          .eq('user_id', user.user_id)
        const subIds = (subs || []).map((s: any) => s.submission_id)

        // 2. Get match IDs
        let matchIds: number[] = []
        if (subIds.length > 0) {
          const [{ data: matchesA }, { data: matchesB }] = await Promise.all([
            supabase.from('matches').select('match_id').in('sub_a_id', subIds),
            supabase.from('matches').select('match_id').in('sub_b_id', subIds)
          ])
          matchIds = [
            ...((matchesA || []).map((m: any) => m.match_id)),
            ...((matchesB || []).map((m: any) => m.match_id))
          ]
        }

        // 3. Count before deletion (for log)
        const [{ count: eventsCount }, { count: feedbackCount }] = await Promise.all([
          supabase.from('events').select('*', { count: 'exact', head: true }).eq('user_id', user.user_id),
          supabase.from('feedback').select('*', { count: 'exact', head: true }).eq('submitted_by_user_id', user.user_id)
        ])

        // 4. Delete in FK-safe order
        // Step A: delete user's own data in parallel (no cross-table FK dependencies here)
        await Promise.all([
          supabase.from('events').delete().eq('user_id', user.user_id),
          supabase.from('feedback').delete().eq('submitted_by_user_id', user.user_id),
          supabase.from('support_tickets').delete().eq('email', user.email) // GDPR
        ])

        // Step B: delete all events referencing the user's matches (from partner side too)
        // Must happen before deleting matches to avoid FK constraint violations
        if (matchIds.length > 0) {
          await supabase.from('events').delete().in('match_id', matchIds)
          await supabase.from('matches').delete().in('match_id', matchIds)
        }
        if (subIds.length > 0) {
          await supabase.from('submissions').delete().in('submission_id', subIds)
        }
        await supabase.from('users').delete().eq('user_id', user.user_id)

        // 5. Write to deletion_log (audit trail)
        await supabase.from('deletion_log').insert({
          user_id:               user.user_id,
          email:                 user.email,
          name:                  user.name,
          deletion_requested_at: user.deletion_requested_at,
          deleted_at:            new Date().toISOString(),
          submissions_deleted:   subIds.length,
          matches_deleted:       matchIds.length,
          events_deleted:        eventsCount || 0,
          feedback_deleted:      feedbackCount || 0
        })

        results.push({ userId: user.user_id, email: user.email, status: 'deleted' })
        console.log(`[process-deletions] Deleted user ${user.user_id} (${user.email})`)

      } catch (userErr: any) {
        console.error(`[process-deletions] Failed for user ${user.user_id}:`, userErr.message)
        results.push({ userId: user.user_id, email: user.email, status: `error: ${userErr.message}` })
      }
    }

    const deleted = results.filter(r => r.status === 'deleted').length
    const failed  = results.filter(r => r.status.startsWith('error')).length

    // 6. Email admin summary
    const notifyEmail = await getConfig('support_notify_email')
    if (notifyEmail && deleted > 0) {
      const rows = results.map(r =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${r.userId}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${r.email}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${r.status}</td></tr>`
      ).join('')

      const html = `<div style="font-family:sans-serif;padding:24px;">
        <h2>🗑️ Data Deletion Run Complete</h2>
        <p><b>Date:</b> ${new Date().toISOString()}</p>
        <p><b>Deleted:</b> ${deleted} &nbsp;|&nbsp; <b>Failed:</b> ${failed}</p>
        <table style="border-collapse:collapse;width:100%;margin-top:16px;">
          <tr style="background:#f9fafb;"><th style="padding:6px 10px;text-align:left;font-size:12px;">User ID</th><th style="padding:6px 10px;text-align:left;font-size:12px;">Email</th><th style="padding:6px 10px;text-align:left;font-size:12px;">Status</th></tr>
          ${rows}
        </table>
      </div>`

      await sendEmail(notifyEmail, `[Deletion Run] ${deleted} account(s) deleted`, html)
    }

    return json({ success: true, deleted, failed, results })

  } catch (err: any) {
    console.error('[process-deletions] Fatal error:', err)
    return json({ success: false, error: err.message }, 500)
  }
})
