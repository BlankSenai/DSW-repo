/**
 * api.ts — a ponte entre o front-end (React) e a nossa API (server.ts).
 *
 * Este arquivo é o ÚNICO lugar do front que conhece o endereço da API.
 * Se um dia a porta mudar (3000 -> 4000), ou a API subir para a nuvem,
 * você mexe em UMA linha aqui e o resto do projeto continua funcionando.
 *
 * Organização do arquivo:
 *   1. Tipos          — o "contrato" de dados que o back devolve
 *   2. Token (JWT)    — guardar, ler e apagar a credencial do usuário
 *   3. Tratar resposta— transformar a resposta HTTP em dado ou erro
 *   4. Autenticação   — login e registro
 *   5. Tarefas        — as chamadas do CRUD (preparadas para a Aula 07)
 */

// ---------------------------------------------------------------------------
// 1. Endereço da API e tipos de dados
// ---------------------------------------------------------------------------

// Endereço do back-end. Em produção isso vira uma variável de ambiente.
// const API_BASE = "http://localhost:3000";
const API_BASE = "";


// Chave usada no localStorage para guardar o token. Com um prefixo nosso,
// para não colidir com nada de outro projeto na mesma máquina.
const TOKEN_KEY = "gestor:token";


/** O que a API devolve em /api/auth/login. */
export interface AuthResult {
  token: string;
}


/** O que a API devolve em /api/auth/register. */
export interface RegistroResult {
  id: number;
  email: string;
}


/** O usuário logado, reconstruído a partir do token. */
export interface Usuario {
  id: number;
  email: string;
}


/** Uma tarefa, exatamente como a tabela `tarefas` do SQLite. */
export interface Tarefa {
  id: number;
  titulo: string;
  status: "pending" | "completed";
  prioridade: "low" | "medium" | "high";
}


// ---------------------------------------------------------------------------
// 2. Token (JWT) — guardar, ler e apagar a credencial
// ---------------------------------------------------------------------------

/** Salva o token que o back entregou no login. */
export const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
};

/** Recupera o token salvo, ou null se o usuário nunca entrou. */
export const getToken = (): string | null => {
  return localStorage.getItem(TOKEN_KEY);
};

/** Apaga o token. É isso que o botão "Sair" vai chamar (logout). */
export const clearToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
};

/**
 * Monta os cabeçalhos das requisições, já com o token quando existir.
 *
 * É o mesmo formato que o middleware `authenticate` do server.ts exige:
 * o header precisa começar com a palavra "Bearer", um espaço, e o token.
 */
export const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

// ---------------------------------------------------------------------------
// 3. Tratar resposta — transformar HTTP em dado ou em erro
// ---------------------------------------------------------------------------

/**
 * Lê a resposta e devolve os dados quando deu certo; quando deu errado,
 * lança um Error com a mensagem que o servidor prepared.
 *
 * Por que lançar em vez de "devolver null"?
 * Assim o `catch` do componente já funciona, sem precisar checar dois casos.
 */
const tratarResposta = async <T,>(res: Response): Promise<T> => {
  const texto = await res.text();

  // Nem toda resposta devolve JSON (ex.: o DELETE responde só com mensagem).
  // Se o corpo não for JSON válido, deixamos `dados` como null e seguimos.
  let dados: unknown;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }

  if (!res.ok) {
    // O back sempre manda { error: "..." } nas falhas: aproveitamos a mensagem.
    const mensagem =
      (dados as { error?: string } | null)?.error ??
      `Falha na requisição (HTTP ${res.status}).`;
    throw new Error(mensagem);
  }

  return dados as T;
};

// ---------------------------------------------------------------------------
// 4. Autenticação
// ---------------------------------------------------------------------------

/**
 * Descobre quem está logado, decodificando o token.
 *
 * IMPORTANTE: decodificar NÃO é validar.
 * O token é um JWT: a parte do meio é o conteúdo (payload) em Base64Url,
 * legível por qualquer pessoa. A assinatura é que prova que o servidor
 * emitiu aquilo — e essa prova só o back pode fazer.
 * Por isso usamos isso APENAS para mostrar o nome/e-mail na tela.
 * Quem decide se o acesso é permitido continua sendo o server.ts.
 *
 * Se o token estiver corrompido ou vencido, devolvemos null e limpamos
 * o storage, para o app voltar para a tela de login sozinho.
 */
export const getUsuario = (): Usuario | null => {
  const token = getToken();
  if (!token) return null;

  // Um JWT tem 3 partes separadas por ponto: cabecalho . payload . assinatura
  const partes = token.split(".");
  if (partes.length !== 3) {
    clearToken();
    return null;
  }

  try {
    // O payload usa Base64Url, que troca + por - e / por _.
    // Precisamos voltar ao Base64 "normal" antes de decodificar.
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");

    // atob devolve bytes; montamos a string %XX para respeitar UTF-8
    // (assim acentos como "joão" não viram lixo).
    const binario = atob(base64);
    const percentEncoded = binario
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("");
    const payload: unknown = JSON.parse(decodeURIComponent(percentEncoded));

    // Usamos o token apenas como fonte de EXIBIÇÃO, nunca de autorização.
    const dados = payload as { id?: number; email?: string; exp?: number };
    if (typeof dados?.id !== "number" || typeof dados?.email !== "string") {
      clearToken();
      return null;
    }

    // O server.ts gera o token com 2h de validade (`expiresIn: "2h"`).
    // Checar o exp evita deixar a tela "logada" com um token morto.
    if (typeof dados.exp === "number" && dados.exp * 1000 < Date.now()) {
      clearToken();
      return null;
    }

    return { id: dados.id, email: dados.email };
  } catch {
    clearToken();
    return null;
  }
};

/**
 * POST /api/auth/login
 * Recebe e-mail e senha; se estiver certo, devolve o token e já o guarda.
 */
export const login = async (email: string, senha: string): Promise<AuthResult> => {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha }),
  });

  const dados = await tratarResposta<AuthResult>(res);
  setToken(dados.token); // guarda o JWT no localStorage
  return dados;
};

/**
 * POST /api/auth/register
 * Cria a conta. Ainda NÃO loga: quem faz isso é o login, chamado em seguida.
 */
export const registrar = async (
  email: string,
  senha: string,
): Promise<RegistroResult> => {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha }),
  });

  return await tratarResposta<RegistroResult>(res);
};

// ---------------------------------------------------------------------------
// 5. Tarefas — o CRUD, já pronto para a Aula 07
// ---------------------------------------------------------------------------

/** GET /api/tasks?search=... — lista as tarefas do usuário logado. */
export const listarTarefas = async (search = ""): Promise<Tarefa[]> => {
  const url = `${API_BASE}/api/tasks${
    search ? `?search=${encodeURIComponent(search)}` : ""
  }`;
  const res = await fetch(url, { headers: authHeaders() });
  return await tratarResposta<Tarefa[]>(res);
};

/** POST /api/tasks — cria uma tarefa. */
export const criarTarefa = async (
  titulo: string,
  prioridade: Tarefa["prioridade"],
): Promise<Tarefa> => {
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ titulo, prioridade }),
  });
  return await tratarResposta<Tarefa>(res);
};

/** PATCH /api/tasks/:id — atualiza só os campos enviados. */
export const atualizarTarefa = async (
  id: number,
  dados: Partial<Pick<Tarefa, "titulo" | "status" | "prioridade">>,
): Promise<Tarefa> => {
  const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(dados),
  });
  return await tratarResposta<Tarefa>(res);
};

/** DELETE /api/tasks/:id — remove a tarefa. */
export const deletarTarefa = async (id: number): Promise<{ message: string }> => {
  const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return await tratarResposta<{ message: string }>(res);
};
