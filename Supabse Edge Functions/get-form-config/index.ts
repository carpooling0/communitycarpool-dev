import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Returns the config keys the frontend form needs on page load.
// Fails safe — returns conservative defaults on any error so the form always loads.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const keys = ['whatsapp_verification_enabled', 'email_verification_enabled']
    const { data } = await supabase
      .from('config')
      .select('key, value')
      .in('key', keys)

    const cfg: Record<string, string> = {}
    for (const row of (data || [])) cfg[row.key] = row.value

    return new Response(JSON.stringify({
      whatsappVerificationEnabled: cfg['whatsapp_verification_enabled'] === 'true',
      emailVerificationEnabled:    cfg['email_verification_enabled']    !== 'false', // defaults true
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('[get-form-config] error:', err.message)
    // Safe defaults — never break the form
    return new Response(JSON.stringify({
      whatsappVerificationEnabled: false,
      emailVerificationEnabled:    true,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
