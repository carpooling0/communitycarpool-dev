import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.19'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const region   = Deno.env.get('AWS_REGION')             || 'us-east-1'
    const keyId    = Deno.env.get('AWS_ACCESS_KEY_ID')!
    const secret   = Deno.env.get('AWS_SECRET_ACCESS_KEY')!
    const from     = 'Community Carpool <noreply@communitycarpool.org>'
    const to       = 'yalama@gmail.com'

    const aws = new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, region, service: 'ses' })

    const payload = {
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: 'CommunityCarpool — SES sandbox test', Charset: 'UTF-8' },
          Body: {
            Html: {
              Data: `<p>Hi,</p><p>This is a sandbox test email from <strong>CommunityCarpool.org</strong> sent via Amazon SES.</p><p>If you received this, SES is working correctly.</p>`,
              Charset: 'UTF-8'
            },
            Text: {
              Data: 'CommunityCarpool SES sandbox test. If you received this, SES is working correctly.',
              Charset: 'UTF-8'
            }
          }
        }
      }
    }

    const res = await aws.fetch(
      `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    )

    const body = await res.text()

    if (!res.ok) {
      return new Response(JSON.stringify({ success: false, status: res.status, error: body }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
      })
    }

    const result = JSON.parse(body)
    return new Response(JSON.stringify({ success: true, messageId: result.MessageId, to, from }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    })
  }
})
