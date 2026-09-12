const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const LOGIN_DOMAIN = "painel.local";
const usernameParaEmail = (username) => `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`;
const emailParaUsername = (email) => (email || "").split("@")[0];

const telaLogin = document.getElementById("tela-login");
const dashboard = document.getElementById("dashboard");
const formLogin = document.getElementById("form-login");
const loginErro = document.getElementById("login-erro");

let graficoProduto = null;
let graficoMotorista = null;
let realtimeChannel = null;
let perfilAtual = null; // { id, username, role }

// ───────────────────────── Autenticação ─────────────────────────

async function verificarSessao() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    await mostrarDashboard();
  } else {
    mostrarLogin();
  }
}

function mostrarLogin() {
  telaLogin.hidden = false;
  dashboard.hidden = true;
}

async function mostrarDashboard() {
  telaLogin.hidden = true;
  dashboard.hidden = false;
  await carregarPerfilAtual();
  iniciarRealtime();
  atualizarDados();
}

async function carregarPerfilAtual() {
  const { data: auth } = await supabaseClient.auth.getUser();
  if (!auth.user) return;

  const { data: perfil } = await supabaseClient
    .from("profiles")
    .select("id, username, full_name, role")
    .eq("id", auth.user.id)
    .single();

  perfilAtual = perfil;
  const ehAdmin = perfil?.role === "admin";
  document.getElementById("btn-usuarios").hidden = !ehAdmin;
  document.getElementById("btn-usuarios-mobile").hidden = !ehAdmin;

  const nome = perfil?.full_name || perfil?.username || "";
  document.querySelectorAll(".usuario-nome").forEach((el) => (el.textContent = nome));
}

// ───────────────────────── Menu mobile ─────────────────────────

const menuMobile = document.getElementById("menu-mobile");

document.getElementById("btn-menu-mobile").addEventListener("click", () => {
  menuMobile.hidden = !menuMobile.hidden;
  menuMobile.classList.toggle("aberto", !menuMobile.hidden);
});

document.getElementById("btn-sair-mobile").addEventListener("click", () => {
  document.getElementById("btn-sair").click();
});

document.getElementById("btn-usuarios-mobile").addEventListener("click", () => {
  menuMobile.hidden = true;
  menuMobile.classList.remove("aberto");
  document.getElementById("btn-usuarios").click();
});

formLogin.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  loginErro.hidden = true;
  const usuario = document.getElementById("login-usuario").value.trim();
  const senha = document.getElementById("login-senha").value;

  const { error } = await supabaseClient.auth.signInWithPassword({
    email: usernameParaEmail(usuario),
    password: senha,
  });
  if (error) {
    loginErro.textContent = "Usuário ou senha inválidos.";
    loginErro.hidden = false;
    return;
  }
  await mostrarDashboard();
});

document.getElementById("btn-sair").addEventListener("click", async () => {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  await supabaseClient.auth.signOut();
  mostrarLogin();
});

// ───────────────────────── Gerenciar usuários ─────────────────────────

const modalUsuarios = document.getElementById("modal-usuarios");
const corpoUsuarios = document.getElementById("corpo-usuarios");
const formNovoUsuario = document.getElementById("form-novo-usuario");
const usuariosErro = document.getElementById("usuarios-erro");

document.getElementById("btn-usuarios").addEventListener("click", async () => {
  modalUsuarios.hidden = false;
  await carregarListaUsuarios();
});
document.getElementById("btn-fechar-usuarios").addEventListener("click", () => {
  modalUsuarios.hidden = true;
});

async function chamarFuncaoAdmin(nome, corpo) {
  const { data, error } = await supabaseClient.functions.invoke(nome, { body: corpo });
  if (error) {
    const msg = data?.error || error.message || "Erro desconhecido";
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function carregarListaUsuarios() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, username, full_name, role")
    .order("username");

  corpoUsuarios.innerHTML = "";
  if (error) {
    corpoUsuarios.innerHTML = `<tr><td colspan="4">Erro ao carregar: ${error.message}</td></tr>`;
    return;
  }

  for (const u of data) {
    const tr = document.createElement("tr");
    const souEu = perfilAtual && u.id === perfilAtual.id;
    tr.innerHTML = `
      <td>${u.username}</td>
      <td>${u.full_name || "—"}</td>
      <td>${u.role}</td>
      <td>
        <button class="btn-mini" data-acao="redefinir" data-id="${u.id}" data-user="${u.username}">Redefinir senha</button>
        ${souEu ? "" : `<button class="btn-mini btn-mini-perigo" data-acao="apagar" data-id="${u.id}" data-user="${u.username}">Apagar</button>`}
      </td>
    `;
    corpoUsuarios.appendChild(tr);
  }
}

corpoUsuarios.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-acao]");
  if (!btn) return;
  const { acao, id, user } = btn.dataset;

  if (acao === "redefinir") {
    const novaSenha = prompt(`Nova senha para "${user}":`);
    if (!novaSenha) return;
    try {
      await chamarFuncaoAdmin("reset-password", { user_id: id, password: novaSenha });
      alert("Senha redefinida.");
    } catch (e) {
      alert("Erro: " + e.message);
    }
  }

  if (acao === "apagar") {
    if (!confirm(`Apagar o usuário "${user}"? Essa ação não pode ser desfeita.`)) return;
    try {
      await chamarFuncaoAdmin("delete-user", { user_id: id });
      await carregarListaUsuarios();
    } catch (e) {
      alert("Erro: " + e.message);
    }
  }
});

formNovoUsuario.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  usuariosErro.hidden = true;

  const username = document.getElementById("novo-username").value.trim();
  const full_name = document.getElementById("novo-nome").value.trim();
  const password = document.getElementById("novo-senha").value;
  const role = document.getElementById("novo-role").value;

  try {
    await chamarFuncaoAdmin("create-user", { username, password, full_name, role });
    formNovoUsuario.reset();
    await carregarListaUsuarios();
  } catch (e) {
    usuariosErro.textContent = e.message;
    usuariosErro.hidden = false;
  }
});

// ───────────────────────── Filtro de período ─────────────────────────

const seletorPeriodo = document.getElementById("periodo");
const grupoDatas = document.getElementById("grupo-datas");
const inputInicio = document.getElementById("data-inicio");
const inputFim = document.getElementById("data-fim");
const seletorUnidade = document.getElementById("unidade");

seletorPeriodo.addEventListener("change", () => {
  grupoDatas.hidden = seletorPeriodo.value !== "custom";
  atualizarDados();
});
inputInicio.addEventListener("change", atualizarDados);
inputFim.addEventListener("change", atualizarDados);
seletorUnidade.addEventListener("change", renderizarUnidade);
document.getElementById("btn-atualizar").addEventListener("click", atualizarDados);

function calcularIntervalo() {
  const hoje = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);

  if (seletorPeriodo.value === "custom") {
    const ini = inputInicio.value || fmt(hoje);
    const fim = inputFim.value || fmt(hoje);
    return { inicio: ini, fim: fim };
  }

  let dias = 1;
  if (seletorPeriodo.value === "7d") dias = 7;
  if (seletorPeriodo.value === "30d") dias = 30;

  const inicioDate = new Date(hoje);
  inicioDate.setDate(inicioDate.getDate() - (dias - 1));

  return { inicio: fmt(inicioDate), fim: fmt(hoje) };
}

// ───────────────────────── Busca de dados ─────────────────────────

let ultimasPesagens = [];

async function atualizarDados() {
  const { inicio, fim } = calcularIntervalo();

  const { data, error } = await supabaseClient
    .from("pesagens")
    .select("*")
    .gte("data_entrada", inicio)
    .lte("data_entrada", fim)
    .order("data_entrada", { ascending: false })
    .order("hora_entrada", { ascending: false })
    .limit(2000);

  if (error) {
    console.error("Erro ao buscar pesagens:", error.message);
    return;
  }

  ultimasPesagens = data || [];
  renderizarTudo();
  marcarAtualizado();
}

function marcarAtualizado() {
  const agora = new Date();
  document.getElementById("hora-atualizacao").textContent = agora.toLocaleTimeString("pt-BR");
}

// ───────────────────────── Realtime ─────────────────────────

function iniciarRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = supabaseClient
    .channel("pesagens-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "pesagens" },
      () => atualizarDados()
    )
    .subscribe();
}

// ───────────────────────── Renderização ─────────────────────────

function unidadeAtual() {
  return seletorUnidade.value;
}

function pesoFormatado(kg) {
  if (kg == null) return "—";
  if (unidadeAtual() === "kg") {
    return `${kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
  }
  return `${(kg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} t`;
}

function renderizarUnidade() {
  document.querySelectorAll(".unid-label").forEach((el) => (el.textContent = unidadeAtual()));
  renderizarTudo();
}

function renderizarTudo() {
  renderizarCartoes();
  renderizarGraficos();
  renderizarTabela();
}

function renderizarCartoes() {
  const linhas = ultimasPesagens;
  const total = linhas.length;
  const somaKg = linhas.reduce((acc, p) => acc + (Number(p.peso_real_kg) || 0), 0);
  const mediaKg = total ? somaKg / total : 0;
  const veiculos = new Set(linhas.map((p) => p.placa_veiculo).filter(Boolean)).size;

  const divisor = unidadeAtual() === "kg" ? 1 : 1000;
  const casas = unidadeAtual() === "kg" ? 0 : 3;

  document.getElementById("valor-peso-medio").textContent = (mediaKg / divisor).toLocaleString(
    "pt-BR",
    { maximumFractionDigits: casas }
  );
  document.getElementById("valor-veiculos").textContent = veiculos;
  document.getElementById("valor-total-pesagens").textContent = total;
  document.getElementById("valor-peso-total").textContent = (somaKg / divisor).toLocaleString(
    "pt-BR",
    { maximumFractionDigits: casas }
  );

  const rotulo = `${total} pesagem(ns) no período`;
  document.getElementById("sub-peso-medio").textContent = rotulo;
  document.getElementById("sub-veiculos").textContent = rotulo;
  document.getElementById("sub-total-pesagens").textContent = rotulo;
  document.getElementById("sub-peso-total").textContent = rotulo;
}

function agruparContagem(linhas, campo) {
  const mapa = new Map();
  for (const p of linhas) {
    const chave = p[campo] || "—";
    mapa.set(chave, (mapa.get(chave) || 0) + 1);
  }
  return [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
}

function renderizarGraficos() {
  const porProduto = agruparContagem(ultimasPesagens, "produto");
  const porMotorista = agruparContagem(ultimasPesagens, "nome_motorista");

  graficoProduto = renderizarBarra(graficoProduto, "grafico-produto", porProduto, "#3b82f6");
  graficoMotorista = renderizarBarra(graficoMotorista, "grafico-motorista", porMotorista, "#8b6ef2");
}

function renderizarBarra(instancia, canvasId, dados, cor) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  const labels = dados.map((d) => d[0]);
  const valores = dados.map((d) => d[1]);

  if (instancia) {
    instancia.data.labels = labels;
    instancia.data.datasets[0].data = valores;
    instancia.update();
    return instancia;
  }

  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Pesagens", data: valores, backgroundColor: cor, borderRadius: 4 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8b98ac" }, grid: { color: "#1f2c42" } },
        y: { ticks: { color: "#8b98ac", precision: 0 }, grid: { color: "#1f2c42" } },
      },
    },
  });
}

const BADGE_CLASSES = {
  emitido: "badge-emitido",
  erro: "badge-erro",
  enviado: "badge-enviado",
  verificar: "badge-verificar",
};

function badgeFiscal(status) {
  const classe = BADGE_CLASSES[status] || "badge-pendente";
  const texto = status || "pendente";
  return `<span class="badge ${classe}">${texto}</span>`;
}

function renderizarTabela() {
  const corpo = document.getElementById("tabela-corpo");
  const vazio = document.getElementById("lista-vazia");
  corpo.innerHTML = "";

  if (ultimasPesagens.length === 0) {
    vazio.hidden = false;
    return;
  }
  vazio.hidden = true;

  for (const p of ultimasPesagens) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.numero_pesagem ?? p.id}</td>
      <td>${formatarData(p.data_entrada)}</td>
      <td>${(p.hora_entrada || "").slice(0, 8)}</td>
      <td>${p.placa_veiculo || "—"}</td>
      <td>${p.nome_motorista || "—"}</td>
      <td>${p.produto || "—"}</td>
      <td>${p.nome_transportadora || "—"}</td>
      <td>${pesoFormatado(p.peso_real_kg)}</td>
      <td>${badgeFiscal(p.fiscal_danfe)}</td>
    `;
    corpo.appendChild(tr);
  }
}

function formatarData(iso) {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

// ───────────────────────── Boot ─────────────────────────

verificarSessao();
