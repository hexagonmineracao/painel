// Edge Function: cria um novo usuário (auth + profile) a pedido de um admin.
// Necessário porque a criação de usuários exige a service role key, que nunca
// deve ficar exposta no frontend estático — ela só existe no runtime da function.
//
// Login é por "usuário", não por email — o Supabase Auth exige um email
// internamente, então geramos um email sintético (usuario@painel.local)
// que nunca é usado pra enviar nada de verdade.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const LOGIN_DOMAIN = 'painel.local'
const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`

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

  // Client autenticado como o chamador, só para checar se é admin.
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
    return json({ error: 'Apenas administradores podem criar usuários' }, 403)
  }

  const { username, password, full_name, role } = await req.json()
  if (!username || !password || !role) {
    return json({ error: 'Campos obrigatórios ausentes' }, 400)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: existing } = await adminClient
    .from('profiles')
    .select('id')
    .eq('username', username.trim().toLowerCase())
    .maybeSingle()
  if (existing) {
    return json({ error: 'Esse nome de usuário já está em uso' }, 400)
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
  })
  if (createError || !created.user) {
    return json({ error: createError?.message ?? 'Falha ao criar usuário' }, 400)
  }

  const { error: profileError } = await adminClient.from('profiles').insert({
    id: created.user.id,
    full_name: full_name || username,
    username: username.trim().toLowerCase(),
    role,
  })
  if (profileError) {
    return json({ error: profileError.message }, 400)
  }

  return json({ ok: true })
})
