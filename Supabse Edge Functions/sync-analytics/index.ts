import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UMAMI_BASE = 'https://api.umami.is/v1/eu'
const UMAMI_WEBSITE_ID = '95b6c0b0-6a71-42ea-8f2d-56ec5eb5e55a'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const { date, token, secret } = body

    // Auth: admin token OR cron secret
    const cronSecret = Deno.env.get('SYNC_SECRET')
    let authed = false
    if (secret && cronSecret && secret === cronSecret) {
      authed = true
    } else if (token) {
      const supabaseUrl = Deno.env.get('DB_URL')!
      const authRes = await fetch(`${supabaseUrl}/functions/v1/admin-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'me', token }),
      })
      const authData = await authRes.json()
      if (authData.success) authed = true
    }
    if (!authed) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const umamiKey = Deno.env.get('UMAMI_API_KEY')
    if (!umamiKey) {
      return new Response(JSON.stringify({ success: false, error: 'UMAMI_API_KEY not configured' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    // Target date: provided date, or yesterday (default for nightly cron — today is always partial)
    const targetDate = date ? new Date(date) : new Date(Date.now() - 86400000)
    const dateStr = targetDate.toISOString().slice(0, 10)
    const startAt = new Date(dateStr + 'T00:00:00.000Z').getTime()
    const endAt   = new Date(dateStr + 'T23:59:59.999Z').getTime()

    const uHeaders = { 'x-umami-api-key': umamiKey }
    const id = UMAMI_WEBSITE_ID
    const qs = `startAt=${startAt}&endAt=${endAt}`

    const uGet = (path: string) =>
      fetch(`${UMAMI_BASE}${path}`, { headers: uHeaders }).then(r => r.json())

    const [
      stats, pvHourly,
      pages, entryPages, exitPages,
      referrers, channels,
      browsers, os, devices,
      countries, regions, cities,
      languages, screens, queries,
      events,
    ] = await Promise.all([
      uGet(`/websites/${id}/stats?${qs}`),
      uGet(`/websites/${id}/pageviews?${qs}&unit=hour`),
      uGet(`/websites/${id}/metrics?${qs}&type=url`),
      uGet(`/websites/${id}/metrics?${qs}&type=entry`),
      uGet(`/websites/${id}/metrics?${qs}&type=exit`),
      uGet(`/websites/${id}/metrics?${qs}&type=referrer`),
      uGet(`/websites/${id}/metrics?${qs}&type=channel`),
      uGet(`/websites/${id}/metrics?${qs}&type=browser`),
      uGet(`/websites/${id}/metrics?${qs}&type=os`),
      uGet(`/websites/${id}/metrics?${qs}&type=device`),
      uGet(`/websites/${id}/metrics?${qs}&type=country`),
      uGet(`/websites/${id}/metrics?${qs}&type=region`),
      uGet(`/websites/${id}/metrics?${qs}&type=city`),
      uGet(`/websites/${id}/metrics?${qs}&type=language`),
      uGet(`/websites/${id}/metrics?${qs}&type=screen`),
      uGet(`/websites/${id}/metrics?${qs}&type=query`),
      uGet(`/websites/${id}/metrics?${qs}&type=event`),
    ])

    const gv = (s: any, f: string) => {
      const v = s[f]
      if (v === undefined || v === null) return 0
      return typeof v === 'object' ? Number(v.value) || 0 : Number(v) || 0
    }

    const pvCount   = gv(stats, 'pageviews')
    const visitors  = gv(stats, 'visitors')
    const visits    = gv(stats, 'visits')
    const bounces   = gv(stats, 'bounces')
    const totaltime = gv(stats, 'totaltime')

    // Build 24-slot hourly array
    const hourMap: Record<number, { pageviews: number; sessions: number }> = {}
    ;(pvHourly.pageviews || []).forEach((d: any) => {
      const h = new Date(d.x).getUTCHours()
      if (!hourMap[h]) hourMap[h] = { pageviews: 0, sessions: 0 }
      hourMap[h].pageviews += d.y
    })
    ;(pvHourly.sessions || []).forEach((d: any) => {
      const h = new Date(d.x).getUTCHours()
      if (!hourMap[h]) hourMap[h] = { pageviews: 0, sessions: 0 }
      hourMap[h].sessions += d.y
    })
    const pageviews_hourly = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      pageviews: hourMap[h]?.pageviews || 0,
      sessions:  hourMap[h]?.sessions  || 0,
    }))

    const supabase = createClient(
      Deno.env.get('DB_URL')!,
      Deno.env.get('DB_SERVICE_KEY')!
    )

    const { error } = await supabase.from('analytics_daily').upsert({
      date: dateStr,
      pageviews: pvCount, visitors, visits, bounces, totaltime,
      bounce_rate:  visits > 0 ? bounces / visits   : 0,
      avg_duration: visits > 0 ? totaltime / visits : 0,
      pages, entry_pages: entryPages, exit_pages: exitPages,
      referrers, channels,
      browsers, os, devices,
      countries, regions, cities,
      languages, screens, queries,
      events,
      pageviews_hourly,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'date' })

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, date: dateStr, pageviews: pvCount, visitors, visits }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
