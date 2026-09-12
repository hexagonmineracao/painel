// Edge Function: admin apaga um usuário (auth.users — profiles cai junto via
// ON DELETE CASCADE). Precisa da service role key, por isso roda aqui.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'Não autenticado' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser()
  if (!caller) {
    return json({ error: 'Não autenticado' }, 401)
  }

  const { data: callerProfile } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single()
  if (callerProfile?.role !== 'admin') {
    return json({ error: 'Apenas administradores podem apagar usuários' }, 403)
  }

  const { user_id } = await req.json()
  if (!user_id) {
    return json({ error: 'Campo user_id ausente' }, 400)
  }
  if (user_id === caller.id) {
    return json({ error: 'Você não pode apagar seu próprio usuário' }, 400)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { error } = await adminClient.auth.admin.deleteUser(user_id)
  if (error) {
    return json({ error: error.message }, 400)
  }

  return json({ ok: true })
})
