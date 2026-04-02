import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UMAMI_BASE = 'https://api.umami.is/v1'
const UMAMI_WEBSITE_ID = '95b6c0b0-6a71-42ea-8f2d-56ec5eb5e55a'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const { token, startAt, endAt, unit } = await req.json()

    // Validate admin session
    const supabaseUrl = Deno.env.get('DB_URL')!
    const authRes = await fetch(`${supabaseUrl}/functions/v1/admin-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'me', token }),
    })
    const authData = await authRes.json()
    if (!authData.success) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const umamiKey = Deno.env.get('UMAMI_API_KEY')
    if (!umamiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'UMAMI_API_KEY not configured' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const headers = { 'x-umami-api-key': umamiKey }
    const id = UMAMI_WEBSITE_ID
    const qs = `startAt=${startAt}&endAt=${endAt}`
    const qsUnit = `${qs}&unit=${unit}`

    function umamiGet(path: string) {
      return fetch(`${UMAMI_BASE}${path}`, { headers }).then(r => r.json())
    }

    const [
      stats,
      pageviews,
      pages,
      entryPages,
      exitPages,
      referrers,
      channels,
      browsers,
      os,
      devices,
      countries,
      regions,
      cities,
      languages,
      screens,
      queries,
    ] = await Promise.all([
      umamiGet(`/websites/${id}/stats?${qs}`),
      umamiGet(`/websites/${id}/pageviews?${qsUnit}`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=url`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=entry`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=exit`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=referrer`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=channel`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=browser`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=os`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=device`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=country`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=region`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=city`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=language`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=screen`),
      umamiGet(`/websites/${id}/metrics?${qs}&type=query`),
    ])

    return new Response(
      JSON.stringify({
        success: true,
        stats, pageviews,
        pages, entryPages, exitPages,
        referrers, channels,
        browsers, os, devices,
        countries, regions, cities,
        languages, screens, queries,
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
