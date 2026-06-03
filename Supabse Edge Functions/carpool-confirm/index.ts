import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const SITE_URL = Deno.env.get('SITE_URL') || 'https://communitycarpool.org'

function htmlPage(title: string, emoji: string, heading: string, body: string, color = '#1B5C3A'): Response {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${title} — Community Carpool</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:460px;margin:40px auto;padding:0 20px;text-align:center;">
    <a href="${SITE_URL}" style="text-decoration:none;">
      <img src="${SITE_URL}/logo-email.png" alt="Community Carpool" style="height:48px;width:auto;margin-bottom:28px;" />
    </a>
    <div style="background:white;border-radius:16px;padding:36px 28px;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
      <div style="font-size:52px;margin-bottom:16px;">${emoji}</div>
      <h1 style="color:#111827;font-size:22px;font-weight:800;margin:0 0 12px;font-family:Montserrat,Inter,sans-serif;">${heading}</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px;">${body}</p>
      <a href="${SITE_URL}" style="display:inline-block;background:${color};color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;font-family:Montserrat,Inter,sans-serif;">Back to Community Carpool</a>
    </div>
    <p style="color:#d1d5db;font-size:12px;margin-top:20px;">Community Carpool &middot; communitycarpool.org</p>
  </div>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const token   = url.searchParams.get('token')
  const matchId = parseInt(url.searchParams.get('matchId') || '0')
  const answer  = url.searchParams.get('answer') // 'yes' | 'no'

  if (!token || !matchId || !['yes', 'no'].includes(answer || '')) {
    return htmlPage('Invalid Link', '&#x1F615;', 'Invalid Link', 'This link appears to be broken or expired. Please check your email for the correct link.', '#6b7280')
  }

  try {
    // Validate token
    const { data: user } = await supabase.from('users')
      .select('user_id, name').eq('match_page_token', token).single()
    if (!user) return htmlPage('Invalid Link', '&#x1F615;', 'Invalid Link', 'We couldn\'t verify your identity. Please check your email for the correct link.', '#6b7280')

    // Load match
    const { data: match } = await supabase.from('matches')
      .select('match_id, status, sub_a:submissions!sub_a_id(user_id), sub_b:submissions!sub_b_id(user_id)')
      .eq('match_id', matchId).single()
    if (!match) return htmlPage('Not Found', '&#x1F615;', 'Match Not Found', 'This match could not be found. It may have been removed.', '#6b7280')

    // Check ownership
    const isSubA = match.sub_a.user_id === user.user_id
    const isSubB = match.sub_b.user_id === user.user_id
    if (!isSubA && !isSubB) return htmlPage('Unauthorised', '&#x1F6AB;', 'Unauthorised', 'You don\'t appear to be part of this match.', '#6b7280')

    // Already answered
    if (match.status === 'carpooling' || match.status === 'no_carpool') {
      const already = match.status === 'carpooling'
      return htmlPage(
        already ? 'Already Confirmed' : 'Already Recorded',
        already ? '&#x1F697;' : '&#x1F44D;',
        already ? 'Already Confirmed!' : 'Already Recorded',
        already ? 'You\'ve already confirmed you\'re carpooling together. Keep up the great work!' : 'Your response has already been recorded. Thank you!',
        already ? '#16a34a' : '#6b7280'
      )
    }

    if (answer === 'yes') {
      await supabase.from('matches').update({
        status: 'carpooling',
        carpooling_confirmed_at: new Date().toISOString()
      }).eq('match_id', matchId)
      await supabase.from('events').insert({
        event_type: 'carpooling_confirmed',
        user_id: user.user_id, match_id: matchId,
        metadata: { answer: 'yes' }
      })
      return htmlPage(
        'Carpooling Confirmed',
        '&#x1F389;',
        'You\'re Carpooling!',
        'Amazing! Every shared ride saves fuel, cuts emissions, and puts money back in your pocket. Thank you for making a difference 🌱',
        '#16a34a'
      )
    } else {
      await supabase.from('matches').update({ status: 'no_carpool' }).eq('match_id', matchId)
      await supabase.from('events').insert({
        event_type: 'carpooling_declined',
        user_id: user.user_id, match_id: matchId,
        metadata: { answer: 'no' }
      })
      return htmlPage(
        'Thanks for letting us know',
        '&#x1F44D;',
        'Thanks for letting us know!',
        'No worries at all. Your journey stays active and you may get more matches as more people join in your area.',
        '#1B5C3A'
      )
    }

  } catch (err: any) {
    console.error('[carpool-confirm] Error:', err.message)
    return htmlPage('Error', '&#x26A0;&#xFE0F;', 'Something went wrong', 'Please try again or contact support if the problem persists.', '#6b7280')
  }
})
