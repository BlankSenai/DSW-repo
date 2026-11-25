import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import express, { type Request, type Response, type NextFunction } from "express";
import { createClient, type InValue } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// O projeto roda como ESM ("type": "module"), e nesse modo não existe o
// __dirname do Node antigo: ele é reconstruído a partir de import.meta.url.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Variáveis de ambiente (Aula 09)
// O .env é lido ANTES de qualquer process.env.X, senão PORT e JWT_SECRET
// escritos nele seriam ignorados.
// ============================================================================

const ARQUIVO_ENV = path.join(__dirname, ".env");

/**
 * Carrega o .env (se existir) com uma verificação contra o BOM do Windows.
 *
 * O Bloco de Notas e versões antigas do PowerShell salvam UTF-8 com uma marca
 * invisível no início (0xEF 0xBB 0xBF). Com ela, a primeira chave vira
 * "﻿TURSO_URL" em vez de "TURSO_URL", a variável "some" sem erro nenhum
 * e o servidor volta para o banco local. O aviso diz exatamente o que fazer.
 */
function carregarEnv(): void {
    if (!fs.existsSync(ARQUIVO_ENV)) return;

    const bruto = fs.readFileSync(ARQUIVO_ENV);
    if (bruto.length >= 3 && bruto[0] === 0xef && bruto[1] === 0xbb && bruto[2] === 0xbf) {
        console.warn(
            "\n[ATENÇÃO] O seu .env foi salvo COM BOM (marca de bytes 0xEF 0xBB 0xBF).\n" +
            "          Consequência: a PRIMEIRA variável do arquivo é ignorada sem erro.\n" +
            "          Salve de novo em UTF-8 SEM BOM (no VS Code: clique em\n" +
            "          'UTF-8 with BOM' no rodapé → Salvar com codificação → UTF-8).\n",
        );
    }

    // Variáveis que já existem no ambiente (ex.: as do painel do Render) têm
    // prioridade: o loadEnvFile não sobrescreve o que já está definido.
    process.loadEnvFile(ARQUIVO_ENV);
}

carregarEnv();

const app = express();
// Em desenvolvimento o Vite (5173) e a API (3000) são origens diferentes, então
// o navegador exige a autorização do CORS. Quando o próprio Express entrega a
// tela (Aula 08), tudo vem da mesma origem e o cors() vira um resquício inofensivo.
app.use(cors());

// Middleware para ler o corpo das requisições em formato JSON
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "super_secreto_desenvolvimento";

// ============================================================================
// Front-end servido pelo back (Aula 08) — caminhos e avisos
// ============================================================================

/** Pasta que o `npm run build` do Vite cria dentro de web/. */
const FRONT_DIST = path.join(__dirname, "web", "dist");

/** O arquivo de entrada que o SPA fallback entrega. */
const FRONT_INDEX = path.join(FRONT_DIST, "index.html");

/**
 * Resposta para quando alguém abre a página e o build do front ainda não
 * existe. Em vez do críptico "Cannot GET /", a mensagem diz o que fazer.
 */
const SEM_BUILD = [
    "Ainda não existe o build do front-end.",
    "",
    "Procurei este arquivo:",
    `  ${FRONT_INDEX}`,
    "",
    "Gere-o com:",
    "  npm run build:web",
    "",
    "Enquanto isso, a API continua funcionando em /api/health.",
].join("\n");

/**
 * Devolve a data de modificação mais recente dentro de uma pasta (olhando as
 * subpastas também). Serve para comparar os fontes do front com o build.
 */
function maisRecente(dir: string): number {
    let maior = 0;

    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const caminho = path.join(dir, entrada.name);

        if (entrada.isDirectory()) {
            maior = Math.max(maior, maisRecente(caminho));
        } else {
            maior = Math.max(maior, fs.statSync(caminho).mtimeMs);
        }
    }

    return maior;
}

// ============================================================================
// Tipos, regras e validações
// ============================================================================

// 1. "Moldes" (interfaces) das linhas que o banco devolve
interface Tarefa {
    id: number;
    usuario_id: number;
    titulo: string;
    descricao: string | null;
    status: string;
    prioridade: string;
    criado_em: string;
    atualizado_em: string;
}

interface Usuario {
    id: number;
    email: string;
    senha_hash: string;
    criado_em: string;
}

interface AuthRequest<P = Request["params"]> extends Request<P> {
    usuarioId?: number; // Injetaremos o ID aqui após validar o token
}

// 2. Centralizamos as regras. Se a regra mudar, mudamos em um só lugar!
const PRIORIDADES = ["low", "medium", "high"] as const;
const STATUS_VALIDOS = ["pending", "completed"] as const;

// 3. Funções ajudantes (Helpers). Escrevemos a validação uma vez e usamos em todo lugar.
const tituloValido = (t: unknown): t is string =>
    typeof t === "string" && t.trim().length >= 3;

const prioridadeValida = (p: unknown): p is (typeof PRIORIDADES)[number] =>
    typeof p === "string" && (PRIORIDADES as readonly string[]).includes(p);

const statusValido = (s: unknown): s is (typeof STATUS_VALIDOS)[number] =>
    typeof s === "string" && (STATUS_VALIDOS as readonly string[]).includes(s);

// POST e PUT são tolerantes: valor ausente ou inválido volta ao padrão.
const normalizarPrioridade = (p: unknown) => (prioridadeValida(p) ? p : "medium");
const normalizarStatus = (s: unknown) => (statusValido(s) ? s : "pending");

// 4. Um ajudante só para transformar e validar IDs
const parsearId = (idParam: string): number | null => {
    const id = Number(idParam);
    // Number("12abc") vira NaN imediatamente, o que é mais seguro!
    return Number.isInteger(id) ? id : null;
};

// ============================================================================
// Banco de dados: Turso (nuvem) ou arquivo local (Aula 09)
// ============================================================================

// Na nuvem (Render, Railway...) o disco é EFÊMERO: é apagado a cada deploy ou
// reinício. Um tarefas.db local perderia todos os usuários e tarefas. Com
// TURSO_URL e TURSO_TOKEN no ambiente, o mesmo SQLite passa a viver no Turso,
// acessado pela internet. Sem eles, continuamos no arquivo local.
const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN;

const usandoNuvem = Boolean(TURSO_URL && TURSO_TOKEN);
const MODO_BANCO = usandoNuvem ? "Turso / libSQL (nuvem)" : "arquivo local (SQLite)";
const ONDE_BANCO = usandoNuvem ? TURSO_URL! : path.resolve("tarefas.db");

const db = createClient(
    usandoNuvem
        ? { url: TURSO_URL!, authToken: TURSO_TOKEN }
        : { url: "file:./tarefas.db" },
);

/** Mostra no terminal onde os dados estão sendo gravados, sem adivinhação. */
function exibirBannerBanco(): void {
    console.log("============================================================");
    console.log("  Banco de dados");
    console.log("------------------------------------------------------------");
    console.log(`  Modo  : ${MODO_BANCO}`);
    console.log(`  Onde  : ${ONDE_BANCO}`);
    console.log(`  Token : ${usandoNuvem ? "presente (nunca será mostrado)" : "não informado"}`);
    if (!usandoNuvem) {
        console.log("  Para usar o Turso, crie um .env na raiz (veja o .env.example).");
    }
    console.log("============================================================");
}

const SQL_USUARIOS = `
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`;

const SQL_TAREFAS = `
    CREATE TABLE IF NOT EXISTS tarefas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        descricao TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        prioridade TEXT NOT NULL DEFAULT 'medium',
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
    )
`;

/** Colunas que este server.ts espera encontrar em cada tabela. */
const COLUNAS_ESPERADAS: Record<string, string[]> = {
    usuarios: ["id", "email", "senha_hash", "criado_em"],
    tarefas: ["id", "usuario_id", "titulo", "descricao", "status", "prioridade", "criado_em", "atualizado_em"],
};

/**
 * Confere se as tabelas têm as colunas desta versão. O CREATE TABLE IF NOT
 * EXISTS não mexe numa tabela que já existe: um tarefas.db criado antes da
 * Aula 09 (coluna "senha" em vez de "senha_hash") passaria despercebido e só
 * quebraria no primeiro login. Melhor parar na largada, dizendo o que fazer.
 */
async function conferirColunas(): Promise<void> {
    for (const [tabela, esperadas] of Object.entries(COLUNAS_ESPERADAS)) {
        const { rows } = await db.execute({
            sql: "SELECT name FROM pragma_table_info(?)",
            args: [tabela],
        });
        const existentes = rows.map((r) => String(r.name));
        const faltando = esperadas.filter((c) => !existentes.includes(c));

        if (faltando.length > 0) {
            throw Object.assign(
                new Error(
                    `A tabela "${tabela}" é de uma versão anterior (faltam: ${faltando.join(", ")}). ` +
                    (usandoNuvem
                        ? "Apague as tabelas no painel do Turso e reinicie."
                        : "Apague o arquivo tarefas.db e reinicie: ele é recriado vazio."),
                ),
                { code: "SCHEMA_ANTIGO" },
            );
        }
    }
}

/** Cria as tabelas, confere o schema e garante o usuário de laboratório. */
async function inicializarBanco(): Promise<void> {
    try {
        // Dois CREATE TABLE num único execute() fariam o segundo ser IGNORADO
        // em silêncio pelo libSQL. O batch roda cada um, e é atômico: se um
        // falhar, nenhum fica pela metade.
        await db.batch([SQL_USUARIOS, SQL_TAREFAS], "write");
        await conferirColunas();

        // Usuário inicial para facilitar o login em laboratório (senha com hash)
        const adminEmail = "admin@senai.com";
        const { rows } = await db.execute({
            sql: "SELECT id FROM usuarios WHERE email = ?",
            args: [adminEmail],
        });

        if (rows.length === 0) {
            const hash = await bcrypt.hash("senha_super_secreta_123", 10);
            await db.execute({
                sql: "INSERT INTO usuarios (email, senha_hash) VALUES (?, ?)",
                args: [adminEmail, hash],
            });
        }
    } catch (erro) {
        const { code, message } = erro as { code?: string; message?: string };
        console.error("\n[ERRO] Não consegui preparar o banco de dados.");
        console.error(`  Modo   : ${MODO_BANCO}`);
        console.error(`  Onde   : ${ONDE_BANCO}`);
        console.error(`  Código : ${code || "DESCONHECIDO"}`);
        console.error(`  Detalhe: ${message}`);
        if (usandoNuvem && code !== "SCHEMA_ANTIGO") {
            console.error("  O Turso devolve HTTP 404 tanto para URL errada quanto para token errado.");
            console.error("  Confira se a TURSO_URL não tem barra no final e se o TURSO_TOKEN está completo.");
        }
        console.error("");
        process.exit(1);
    }
}

// --- Helpers de consulta ----------------------------------------------------
// O libSQL é assíncrono: toda consulta é `await db.execute({ sql, args })`.
// Não existe mais db.prepare(): com o banco do outro lado da internet, o custo
// está na rede, não em compilar o SQL. O que NÃO muda: os valores vão sempre
// em `args`, com `?` no SQL. Nunca colamos texto na query (SQL Injection).

/** Primeira linha de um resultado, já com o tipo da tabela. */
function primeiraLinha<T>(rows: unknown[]): T | undefined {
    return rows[0] as T | undefined;
}

const buscarUsuarioPorEmail = async (email: string) =>
    primeiraLinha<Usuario>(
        (await db.execute({ sql: "SELECT * FROM usuarios WHERE email = ?", args: [email] })).rows,
    );

const buscarTarefa = async (id: number, usuarioId: number) =>
    primeiraLinha<Tarefa>(
        (await db.execute({
            sql: "SELECT * FROM tarefas WHERE id = ? AND usuario_id = ?",
            args: [id, usuarioId],
        })).rows,
    );

/**
 * Hash de uma senha que ninguém tem, usado quando o e-mail não existe.
 * Assim o login SEMPRE roda um bcrypt.compare de verdade (~50 ms), e o tempo
 * de resposta não denuncia quais e-mails estão cadastrados (timing attack).
 * Precisa ser um hash válido: com um texto qualquer, o bcrypt desiste na
 * hora e a resposta volta instantânea, entregando justamente essa pista.
 */
const HASH_FALSO = bcrypt.hashSync("senha-que-nenhum-usuario-tem", 10);

// ============================================================================
// Middleware de autenticação
// ============================================================================

const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Token ausente ou mal formatado." });
    }

    const token = header.split(" ")[1]; // Pega só o token após a palavra 'Bearer'

    try {
        const payload = jwt.verify(token, JWT_SECRET) as { id: number };
        req.usuarioId = payload.id; // Injeta o id no req para a rota usar
        next(); // Tudo certo! Segue para a rota.
    } catch {
        return res.status(401).json({ error: "Token inválido ou expirado." });
    }
};

// ============================================================================
// Rotas públicas
// ============================================================================

// Health check que confere o banco de verdade (SELECT 1), e não só o Express
app.get("/api/health", async (_req: Request, res: Response) => {
    try {
        await db.execute("SELECT 1");
        return res.json({
            status: "ok",
            message: "Servidor do Gestor de Tarefas ativo!",
            banco: MODO_BANCO,
        });
    } catch {
        return res.status(503).json({
            status: "erro",
            message: "O servidor está no ar, mas o banco de dados não respondeu.",
            banco: MODO_BANCO,
        });
    }
});

app.get("/api/version", (_req: Request, res: Response) => {
    res.json({ appName: "Gerenciador de Tarefas Multi-Usuário", version: "1.0.0" });
});

/**
 * Diagnóstico do banco (Aula 10). Em produção confirma, numa chamada só, que:
 *   1. o servidor alcança o banco (SELECT 1);
 *   2. as tabelas existem (lidas do catálogo sqlite_master);
 *   3. quantos registros há em cada uma.
 * Só devolve nomes de tabelas e contagens, nunca o conteúdo.
 */
app.get("/api/db-check", async (_req: Request, res: Response) => {
    try {
        await db.execute("SELECT 1");

        const { rows } = await db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );
        const tabelas = rows.map((r) => String(r.name));

        const contagem: Record<string, number> = {};
        for (const nome of tabelas) {
            // Nome de tabela não pode ir como parâmetro (?), só valores podem.
            // Ele vem do próprio catálogo do banco, e ainda assim vai entre
            // aspas (com aspas internas duplicadas) para nunca virar SQL.
            const { rows: total } = await db.execute(
                `SELECT COUNT(*) AS total FROM "${nome.replace(/"/g, '""')}"`,
            );
            contagem[nome] = Number(total[0].total);
        }

        return res.json({ ok: true, banco: MODO_BANCO, tabelas, contagem });
    } catch {
        return res.status(503).json({ ok: false, banco: MODO_BANCO, error: "Falha ao consultar o banco." });
    }
});

app.post("/api/auth/register", async (req: Request, res: Response) => {
    const { email, senha } = req.body ?? {};

    if (typeof email !== "string" || typeof senha !== "string") {
        return res.status(400).json({ error: "E-mail e senha são obrigatórios." });
    }

    if (!email.includes("@")) {
        return res.status(400).json({ error: "E-mail inválido." });
    }

    if (senha.trim().length < 6) {
        return res.status(400).json({ error: "A senha deve ter ao menos 6 caracteres." });
    }

    // Criando a "impressão digital" da senha
    const hash = await bcrypt.hash(senha, 10);

    try {
        const resultado = await db.execute({
            sql: "INSERT INTO usuarios (email, senha_hash) VALUES (?, ?)",
            args: [email.trim(), hash],
        });

        // lastInsertRowid vem como bigint no libSQL: convertemos para number
        return res.status(201).json({ id: Number(resultado.lastInsertRowid), email: email.trim() });
    } catch (erro) {
        // 409 só para o conflito real (e-mail repetido, constraint UNIQUE).
        // Banco fora do ar é outra coisa: 500, e não "e-mail já cadastrado".
        if (String((erro as { code?: string }).code).startsWith("SQLITE_CONSTRAINT")) {
            return res.status(409).json({ error: "E-mail já cadastrado." });
        }
        return res.status(500).json({ error: "Não foi possível cadastrar agora. Tente de novo." });
    }
});

app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, senha } = req.body ?? {};

    if (typeof email !== "string" || typeof senha !== "string") {
        return res.status(400).json({ error: "E-mail e senha são obrigatórios." });
    }

    // Banco fora do ar é 500. Responder 401 aqui faria a pessoa achar que
    // errou a senha quando o problema é a rede.
    let usuario: Usuario | undefined;
    try {
        usuario = await buscarUsuarioPorEmail(email.trim());
    } catch {
        return res.status(500).json({ error: "Não foi possível entrar agora. Tente de novo." });
    }

    // Compara SEMPRE com um hash (mesmo se o usuário não existir)
    const senhaOk = await bcrypt.compare(senha, usuario?.senha_hash ?? HASH_FALSO);

    if (!usuario || !senhaOk) {
        return res.status(401).json({ error: "Credenciais inválidas." });
    }

    // Gerando o "Crachá" de acesso
    const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, {
        expiresIn: "2h",
    });

    return res.json({ token });
});

// ============================================================================
// Rotas de tarefas (protegidas e isoladas por usuario_id)
// ============================================================================

app.get("/api/tasks", authenticate, async (req: AuthRequest, res: Response) => {
    const usuarioId = req.usuarioId!; // Garantimos que existe pois o middleware já checou
    const search = typeof req.query.search === "string" ? req.query.search : "";

    try {
        const { rows } = search
            ? // O '%' entra DEPOIS, apenas dentro do parâmetro
              await db.execute({
                  sql: "SELECT * FROM tarefas WHERE usuario_id = ? AND titulo LIKE ? ORDER BY id",
                  args: [usuarioId, `%${search}%`],
              })
            : await db.execute({
                  sql: "SELECT * FROM tarefas WHERE usuario_id = ? ORDER BY id",
                  args: [usuarioId],
              });

        return res.json(rows);
    } catch {
        // Mensagem genérica para não vazar a estrutura do banco
        return res.status(500).json({ error: "Erro interno ao processar a listagem." });
    }
});

app.post("/api/tasks", authenticate, async (req: AuthRequest, res: Response) => {
    const usuarioId = req.usuarioId!;
    const { titulo, prioridade } = req.body ?? {};

    if (!tituloValido(titulo)) {
        return res.status(400).json({
            error: "O título da tarefa é obrigatório e deve conter pelo menos 3 caracteres válidos.",
        });
    }

    try {
        const resultado = await db.execute({
            sql: "INSERT INTO tarefas (titulo, status, prioridade, usuario_id) VALUES (?, 'pending', ?, ?)",
            args: [titulo.trim(), normalizarPrioridade(prioridade), usuarioId],
        });

        const novaTarefa = await buscarTarefa(Number(resultado.lastInsertRowid), usuarioId);
        return res.status(201).json(novaTarefa);
    } catch {
        return res.status(500).json({ error: "Erro ao processar persistência." });
    }
});

// Rota para deletar fisicamente uma tarefa do banco
app.delete("/api/tasks/:id", authenticate, async (req: AuthRequest<{ id: string }>, res: Response) => {
    const usuarioId = req.usuarioId!;
    const id = parsearId(req.params.id);

    if (id === null) {
        return res.status(400).json({ error: "ID inválido." });
    }

    try {
        const resultado = await db.execute({
            sql: "DELETE FROM tarefas WHERE id = ? AND usuario_id = ?",
            args: [id, usuarioId],
        });

        // rowsAffected é o antigo "changes" do better-sqlite3
        if (resultado.rowsAffected === 0) {
            return res.status(404).json({ error: "Tarefa não localizada para exclusão." });
        }

        return res.json({ message: "Tarefa excluída com sucesso!" });
    } catch {
        return res.status(500).json({ error: "Erro interno ao processar a exclusão." });
    }
});

// PUT: atualização completa (tolerante: prioridade/status inválidos voltam ao padrão)
app.put("/api/tasks/:id", authenticate, async (req: AuthRequest<{ id: string }>, res: Response) => {
    const usuarioId = req.usuarioId!;
    const id = parsearId(req.params.id);

    if (id === null) {
        return res.status(400).json({ error: "ID inválido." });
    }

    const { titulo, prioridade, status } = req.body ?? {};

    if (!tituloValido(titulo)) {
        return res.status(400).json({
            error: "O título da tarefa é obrigatório e deve conter pelo menos 3 caracteres válidos.",
        });
    }

    try {
        const resultado = await db.execute({
            sql: `UPDATE tarefas
                  SET titulo = ?, status = ?, prioridade = ?, atualizado_em = CURRENT_TIMESTAMP
                  WHERE id = ? AND usuario_id = ?`,
            args: [titulo.trim(), normalizarStatus(status), normalizarPrioridade(prioridade), id, usuarioId],
        });

        if (resultado.rowsAffected === 0) {
            return res.status(404).json({ error: "Tarefa não encontrada para atualização." });
        }

        return res.json(await buscarTarefa(id, usuarioId));
    } catch {
        return res.status(500).json({ error: "Erro ao processar a atualização no banco de dados." });
    }
});

// PATCH: atualização parcial (estrita: valor inválido devolve 400)
app.patch("/api/tasks/:id", authenticate, async (req: AuthRequest<{ id: string }>, res: Response) => {
    const usuarioId = req.usuarioId!;
    const id = parsearId(req.params.id);

    if (id === null) {
        return res.status(400).json({ error: "ID inválido." });
    }

    if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "Nenhum campo fornecido para atualização." });
    }

    const { titulo, prioridade, status } = req.body;

    // Valida TUDO antes de tocar no banco: ou a atualização inteira é válida,
    // ou nada é gravado. Um único UPDATE já é atômico no SQLite.
    const campos: string[] = [];
    const valores: InValue[] = [];

    if (titulo !== undefined) {
        if (!tituloValido(titulo)) {
            return res.status(400).json({ error: "O título da tarefa deve conter pelo menos 3 caracteres válidos." });
        }
        campos.push("titulo = ?");
        valores.push(titulo.trim());
    }

    if (prioridade !== undefined) {
        if (!prioridadeValida(prioridade)) {
            return res.status(400).json({ error: "Prioridade inválida. Use 'low', 'medium' ou 'high'." });
        }
        campos.push("prioridade = ?");
        valores.push(prioridade);
    }

    if (status !== undefined) {
        if (!statusValido(status)) {
            return res.status(400).json({ error: "Status inválido. Use 'pending' ou 'completed'." });
        }
        campos.push("status = ?");
        valores.push(status);
    }

    try {
        if (campos.length > 0) {
            // Query dinâmica SEGURA: os nomes das colunas vêm da nossa lista
            // fixa acima, e os valores vão como parâmetros (?).
            const resultado = await db.execute({
                sql: `UPDATE tarefas SET ${campos.join(", ")}, atualizado_em = CURRENT_TIMESTAMP
                      WHERE id = ? AND usuario_id = ?`,
                args: [...valores, id, usuarioId],
            });

            if (resultado.rowsAffected === 0) {
                return res.status(404).json({ error: "Tarefa não encontrada para atualização parcial." });
            }
        }

        const tarefa = await buscarTarefa(id, usuarioId);
        if (!tarefa) {
            return res.status(404).json({ error: "Tarefa não encontrada para atualização parcial." });
        }

        return res.json(tarefa);
    } catch {
        return res.status(500).json({ error: "Erro ao processar a atualização parcial no banco." });
    }
});

// ============================================================================
// Front-end servido pelo back (Aula 08)
// A ordem (a) → (b) → (c) é o mecanismo: cada peça só age quando as anteriores
// não responderam. Por isso tudo isto fica DEPOIS das rotas da API.
// ============================================================================

// (a) Rota de API que não existe responde 404 em JSON, e não HTML. Sem esta
// linha, "GET /api/typo" cairia no fallback (c) e devolveria o index.html com
// status 200: um erro da API viraria uma página de "sucesso".
app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Rota de API não encontrada." });
});

// (b) Os arquivos que o build do Vite gerou em web/dist: index.html, os .js
// com hash no nome, o .css e as imagens da public/. Se o arquivo pedido não
// existe, o express.static não responde nada e passa a vez para o (c).
app.use(express.static(FRONT_DIST));

// (c) SPA fallback: qualquer outro caminho é uma rota do React, que roda no
// navegador. Devolvemos o index.html para o app assumir — é o que permite
// recarregar (F5) uma rota como /tarefas sem "não encontrado".
// No Express 5 o curinga "*" não existe mais: usamos a regex /(.*)/.
app.get(/(.*)/, (_req: Request, res: Response) => {
    if (!fs.existsSync(FRONT_INDEX)) {
        return res.status(503).type("text/plain").send(SEM_BUILD);
    }

    return res.sendFile(FRONT_INDEX);
});

/**
 * Os dois avisos de inicialização:
 *   1. o build não existe  → diz como gerar;
 *   2. o build está VELHO  → algum arquivo de web/src mudou depois do último
 *      build, então a tela servida não mostra a sua última alteração.
 */
function verificarFront(): void {
    if (!fs.existsSync(FRONT_INDEX)) {
        console.warn("\n[ATENÇÃO] " + SEM_BUILD + "\n");
        return;
    }

    const fontes = path.join(__dirname, "web", "src");

    if (fs.existsSync(fontes) && maisRecente(fontes) > fs.statSync(FRONT_INDEX).mtimeMs) {
        console.warn(
            "\n[ATENÇÃO] O build do front está VELHO: algum arquivo de web/src " +
            "mudou depois do último build.\n" +
            "          Rode `npm run build:web` para ver a mudança.\n",
        );
    }
}

// ============================================================================
// Inicialização controlada (Aula 09)
// Como preparar o banco agora é assíncrono, o servidor só abre a porta DEPOIS
// que as tabelas estão confirmadas. Antes disso, nenhuma requisição entra.
// ============================================================================

async function iniciarServidor(): Promise<void> {
    await inicializarBanco();

    app.listen(PORT, () => {
        exibirBannerBanco();
        console.log(`Servidor rodando em: http://localhost:${PORT}`);
        console.log(`API:   http://localhost:${PORT}/api/health`);
        console.log(`Front: http://localhost:${PORT}`);
        verificarFront();
    });
}

iniciarServidor();
