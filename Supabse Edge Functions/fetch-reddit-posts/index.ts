import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.19'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

const SUBREDDITS = [
  // Carpooling & commuting
  'carpooling', 'carpool', 'commuting', 'rideshare',

  // Sustainability & environment
  'sustainability', 'environment', 'climate', 'zerowaste', 'Anticonsumption',

  // Urban & transport
  'fuckcars', 'urbanplanning', 'notjustbikes', '15minutecity', 'cities',

  // UAE / Gulf
  'dubai', 'UAE', 'DubaiExpats', 'DubaiLife', 'abudhabi', 'sharjah',

  // India — tier 1 cities
  'india', 'mumbai', 'delhi', 'bangalore', 'hyderabad', 'Chennai', 'kolkata', 'pune', 'Ahmedabad',

  // India — tier 2 cities
  'Kerala', 'trivandrum', 'Kochi', 'trichy', 'Coimbatore',
  'Noida', 'Chandigarh', 'Jaipur', 'rajasthan', 'lucknow', 'Indore', 'bhopal', 'Nagpur',
  'Visakhapatnam', 'Vijayawada', 'Bhubaneswar', 'Guwahati',
  'Surat', 'Vadodara', 'Amritsar', 'Patna',

  // Expat & cost of living
  'expats', 'Frugal', 'personalfinance'
]

const MIN_SCORE = 3
const MAX_AGE_HOURS = 36
const MIN_RELEVANCE = 6

async function fetchSubreddit(subreddit: string): Promise<any[]> {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=25`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CommunityCarpool/1.0 (content monitoring bot)' }
    })
    if (!res.ok) {
      console.error(`Reddit fetch failed for r/${subreddit}: ${res.status}`)
      return []
    }
    const json = await res.json()
    return json.data?.children?.map((c: any) => c.data) || []
  } catch (err: any) {
    console.error(`Error fetching r/${subreddit}: ${err.message}`)
    return []
  }
}

function passesHardFilter(post: any): boolean {
  const ageHours = (Date.now() - post.created_utc * 1000) / (1000 * 60 * 60)
  if (ageHours > MAX_AGE_HOURS) return false
  if (post.score < MIN_SCORE) return false
  if (post.is_video) return false
  if (post.post_hint === 'image') return false
  if (post.stickied) return false
  return true
}

async function callBedrock(prompt: string): Promise<string> {
  const region = Deno.env.get('AWS_BEDROCK_REGION') || 'eu-west-1'
  const aws = new AwsClient({
    accessKeyId: Deno.env.get('AWS_BEDROCK_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('AWS_BEDROCK_SECRET_ACCESS_KEY')!,
    region,
    service: 'bedrock'
  })

  const modelId = 'anthropic.claude-3-haiku-20240307-v1:0'
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  })

  const res = await aws.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Bedrock error ${res.status}: ${errText}`)
  }

  const json = await res.json()
  return json.content[0].text
}

async function analysePost(post: any, subreddit: string): Promise<any | null> {
  const prompt = `You are drafting Reddit replies for someone who built a free carpooling platform called CommunityCarpool.org. It matches commuters globally based on route compatibility. They want to be a genuine, helpful voice in commuting and sustainability communities, not a spammer. Most moderators will delete overtly promotional posts, so replies should feel like a real person talking, not marketing.

Analyse this Reddit post and return ONLY valid JSON, no other text.

Subreddit: r/${subreddit}
Title: ${post.title}
Body: ${(post.selftext || '').slice(0, 500)}

Return this exact JSON:
{
  "relevance_score": <integer 1-10, how relevant is this for the platform to engage with>,
  "intent": <one of: "discussion" | "complaint" | "advice-seeking" | "informational">,
  "reply_a": <helpful reply, no mention of CommunityCarpool at all, max 100 words, casual Reddit tone, no bullet points, no em-dashes>,
  "reply_b": <helpful reply that weaves in a brief natural mention of communitycarpool.org, max 100 words, no bullet points, no em-dashes, reads like a person not a brand>,
  "reply_c": <reply that mentions communitycarpool.org more directly, only appropriate when the post is specifically asking for carpooling or commuting solutions, max 100 words, no bullet points, no em-dashes>
}

Rules:
- Write like a knowledgeable person, not a company
- No em-dashes anywhere in any reply
- No bullet points
- Keep it conversational and concise
- For reply_b: the mention should feel incidental, not like the point of the reply
- For reply_c: phrase it as something like "I actually built something for this" rather than leading with the brand name
- reply_c is only appropriate when the post directly asks for carpooling or commuting tools`

  try {
    const raw = await callBedrock(prompt)
    const json = JSON.parse(raw.trim())
    return json
  } catch (err: any) {
    console.error(`Failed to analyse post "${post.title}": ${err.message}`)
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    let processed = 0
    let inserted = 0

    for (const subreddit of SUBREDDITS) {
      const posts = await fetchSubreddit(subreddit)

      for (const post of posts) {
        if (!passesHardFilter(post)) continue

        // Skip if already in DB
        const { data: existing } = await supabase
          .from('reddit_digest')
          .select('id')
          .eq('post_id', post.id)
          .single()
        if (existing) continue

        processed++

        const analysis = await analysePost(post, subreddit)
        if (!analysis) continue
        if (analysis.relevance_score < MIN_RELEVANCE) continue

        const { error } = await supabase.from('reddit_digest').insert({
          subreddit,
          post_id: post.id,
          post_title: post.title,
          post_body: (post.selftext || '').slice(0, 1000),
          post_url: `https://www.reddit.com${post.permalink}`,
          post_score: post.score,
          post_created_at: new Date(post.created_utc * 1000).toISOString(),
          comment_count: post.num_comments,
          relevance_score: analysis.relevance_score,
          intent: analysis.intent,
          reply_a: analysis.reply_a,
          reply_b: analysis.reply_b,
          reply_c: analysis.reply_c,
          status: 'pending'
        })

        if (!error) inserted++
      }

      // Small delay between subreddits to respect Reddit rate limits
      await new Promise(r => setTimeout(r, 250))
    }

    return new Response(JSON.stringify({ success: true, processed, inserted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('fetch-reddit-posts error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    })
  }
})
