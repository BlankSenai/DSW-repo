import express, { type Request, type Response, type NextFunction } from "express"
import Database from "better-sqlite3"
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express()

const port = Number(process.env.PORT) || 3000

const JWT_SECRET = process.env.JWT_SECRET ||
  "pneumoultromicroscopicosilicovulcanoconiotico";

// 1. Molde (Interface) das tarefas — nomes das colunas reais do banco
interface Tarefa {
  IDTAREFA: number;
  TITULO: string;
  STATUS: string;
  PRIORIDADE: string;
  USUARIO_ID: number;
}

interface Usuario {
  IDUSUARIO: number;
  EMAIL: string;
  SENHA: string;
}

interface AuthRequest<P = Request["params"]> extends Request<P> {
  usuarioId?: number; // Injetaremos o ID aqui após validar o token
}

// 2. Regras centralizadas. Mudou a regra, muda só aqui.
const PRIORIDADES = ["Baixa", "Media", "Alta"] as const;
const STATUS_VALIDOS = ["Pendente", "Finalizada"] as const;

// 3. Helpers de validação — escritos uma vez, usados em todo lugar.
const tituloValido = (t: unknown): t is string =>
  typeof t === "string" && t.trim().length >= 3;

const normalizarPrioridade = (p: unknown): string => {
  const lista = PRIORIDADES as readonly string[];
  return typeof p === "string" && lista.includes(p) ? p : "Media";
};

const normalizarStatus = (s: unknown): string => {
  const lista = STATUS_VALIDOS as readonly string[];
  return typeof s === "string" && lista.includes(s) ? s : "Pendente";
};

// 4. Helper para transformar e validar IDs vindos da URL
const parsearId = (idParam: string): number | null => {
  if (idParam.trim() === "") return null;
  const id = Number(idParam);
  return Number.isInteger(id) ? id : null;
};

// 5. Middleware de Autenticação: roda antes da rota e barra quem não tem token válido
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

// middleware para ler body json
app.use(express.json())

const db = new Database("tarefas.db")

// CREATE TABLE IF NOT EXISTS não altera tabela já existente: se o banco local
// ainda tem a TAREFAS antiga (sem dono), descartamos para recriar com o vínculo.
const colunasTarefas = db.prepare("PRAGMA table_info(TAREFAS)").all() as { name: string }[]
if (colunasTarefas.length > 0 && !colunasTarefas.some(c => c.name === "USUARIO_ID")) {
  db.exec("DROP TABLE TAREFAS")
}

db.exec(`
    CREATE TABLE IF NOT EXISTS USUARIOS (
        IDUSUARIO INTEGER PRIMARY KEY AUTOINCREMENT,
        EMAIL TEXT UNIQUE NOT NULL,
        SENHA TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS TAREFAS (
        IDTAREFA INTEGER PRIMARY KEY AUTOINCREMENT,
        TITULO TEXT NOT NULL,
        STATUS TEXT DEFAULT 'Pendente',
        PRIORIDADE TEXT DEFAULT 'Media',
        USUARIO_ID INTEGER NOT NULL, /* <-- VÍNCULO COM O DONO DA TAREFA */
        FOREIGN KEY(USUARIO_ID) REFERENCES USUARIOS(IDUSUARIO)
    );
`)

// Escrevemos (compilamos) as buscas UMA ÚNICA VEZ e guardamos na memória.
// Precisam vir depois do CREATE TABLE, senão o prepare estoura ("no such table").
const stmtContarUsuarios = db.prepare("SELECT COUNT(*) AS count FROM USUARIOS")
const stmtInserirUsuario = db.prepare("INSERT INTO USUARIOS (EMAIL, SENHA) VALUES (?, ?)")
const stmtListarTodas = db.prepare("SELECT * FROM TAREFAS WHERE USUARIO_ID = ?")
const stmtBuscarPorTitulo = db.prepare("SELECT * FROM TAREFAS WHERE TITULO LIKE ? AND USUARIO_ID = ?")
const stmtBuscarPorId = db.prepare("SELECT * FROM TAREFAS WHERE IDTAREFA = ? AND USUARIO_ID = ?")
const stmtInserirTarefa = db.prepare("INSERT INTO TAREFAS (TITULO, STATUS, PRIORIDADE, USUARIO_ID) VALUES (?, 'Pendente', ?, ?)")
const stmtDeletarTarefa = db.prepare("DELETE FROM TAREFAS WHERE IDTAREFA = ? AND USUARIO_ID = ?")
const stmtBuscarUsuarioPorId = db.prepare("SELECT * FROM USUARIOS WHERE IDUSUARIO = ?");
const stmtBuscarUsuarioPorEmail = db.prepare("SELECT * FROM USUARIOS WHERE EMAIL = ?");

// Inserindo dados falsos para serem vazados
const usuariosExistentes = stmtContarUsuarios.get() as { count: number }

if (usuariosExistentes.count === 0) {
  // Dados parametrizados (?), sem colar texto direto na query
  stmtInserirUsuario.run("admin@senai.com", "senha_super_secreta_123")
}

console.log('Banco de dados SQLITE iniciado com sucesso.')

// GET /health - Integridade do sistema
app.get('/api/health', (_, res) => {
  res.json({
    status: "ok",
    message: "Gestor de tarefas saudável"
  })
})

// GET /version - Versão e nome do sistema
app.get('/api/version', (_, res) => {
  res.json({
    appName: "Gerenciador de Tarefas Multi-Usuário",
    version: "1.0.0"
  })
})

//POST /auth/register - Cadastra usuário com credencial criptografada
app.post("/api/auth/register", (req, res) => {
  const { email, senha } = req.body;

  // Validação inicial dos dados
  if (typeof email !== "string" || typeof senha !== "string") {
    return res.status(400).json({
      error: "E-mail e senha são obrigatórios."
    });
  }

  if (senha.trim().length < 6) {
    return res.status(400).json({
      error: "A senha deve ter ao menos 6 caracteres."
    });
  }
  // Criando a "impressão digital" da senha
  const hash = bcrypt.hashSync(senha, 10);

  try {
    const resultado = stmtInserirUsuario.run(email.trim(), hash);
    const usuario = stmtBuscarUsuarioPorId.get(resultado.lastInsertRowid) as Usuario;

    return res.status(201).json({
      id: usuario.IDUSUARIO,
      email: usuario.EMAIL
    });
  } catch {
    return res.status(409).json({ error: "E-mail já cadastrado." });
  }
});

//POST /auth/login - Autentica usuario e gera token de acesso
app.post("/api/auth/login", (req, res) => {
  const { email, senha } = req.body;

  if (typeof email !== "string" || typeof senha !== "string") {
    return res.status(400).json({ error: "E-mail e senha são obrigatórios." });
  }

  const usuario = stmtBuscarUsuarioPorEmail.get(email.trim()) as Usuario | undefined;

  // Compara SEMPRE com hash (mesmo se usuário não existir) para evitar vazamento
  const hashEsperado = usuario?.SENHA ?? "$2a$10$fakehashparanaquebrarcomparacao";

  const senhaOk = bcrypt.compareSync(senha, hashEsperado);

  if (!usuario || !senhaOk) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }

  // Gerando o "Crachá" de acesso
  const token = jwt.sign(
    {
      id: usuario.IDUSUARIO,
      email: usuario.EMAIL
    },
    JWT_SECRET,
    {
      expiresIn: "2h",
    });
    
  return res.json({ token });
});

// GET /tasks - Busca tarefas cadastradas
app.get("/api/tasks", authenticate, (req: AuthRequest, res: Response) => {
  const usuarioId = req.usuarioId!; // Garantimos que existe pois o middleware já checou
  // 1. Coerção segura: se vier array/objeto na URL, vira string vazia
  const search = typeof req.query.search === "string" ? req.query.search : "";
  try {
    if (search) {
      // 2. O '%' entra só dentro do parâmetro (?), nunca na string da query
      const tarefas = stmtBuscarPorTitulo.all(`%${search}%`, usuarioId)
      res.json(tarefas);
    } else {
      // 3. Busca já compilada no Passo 2
      const tarefas = stmtListarTodas.all(usuarioId);
      res.json(tarefas);
    }
  } catch {
    // 4. Erro genérico: não vaza a estrutura do banco pra internet
    res.status(500).json({ error: "Erro interno ao processar a listagem." });
  }
});

// POST /tasks - Cria uma nova tarefa
app.post("/api/tasks", authenticate, (req: AuthRequest, res: Response) => {
  const usuarioId = req.usuarioId!;
  const { title, prioridade } = req.body;
  const prioridadeValida = normalizarPrioridade(prioridade);

  // Validação via helper (type guard)
  if (!tituloValido(title)) {
    return res.status(400).json({
      error: "O título da tarefa é obrigatório e deve conter pelo menos 3 caracteres válidos."
    });
  }

  try {
    const resultado = stmtInserirTarefa.run(title.trim(), prioridadeValida, usuarioId);
    const novaTarefa = stmtBuscarPorId.get(resultado.lastInsertRowid, usuarioId) as Tarefa;
    return res.status(201).json(novaTarefa);
  } catch {
    return res.status(500).json({ error: "Erro ao processar persistência" });
  }
});

// Rota para deletar fisicamente uma tarefa do banco
app.delete("/api/tasks/:id", authenticate, (req: AuthRequest<{ id: string }>, res: Response) => {
  const usuarioId = req.usuarioId!;
  // Validação de ID padronizada (igual PUT/PATCH)
  const idParaDeletar = parsearId(req.params.id);
  if (idParaDeletar === null) {
    return res.status(400).json({ error: "ID inválido." });
  }
  try {
    const resultado = stmtDeletarTarefa.run(idParaDeletar, usuarioId);

    // No SQLite, o sucesso é medido pelo número de
    // linhas afetadas (changes)
    if (resultado.changes === 0) {
      return res.status(404).json({ error: "Tarefa não localizada para exclusão." });
    }
    res.json({ message: "Tarefa excluída do banco SQLite com sucesso!" });
  } catch {
    res.status(500).json({ error: "Erro interno ao processar a exclusão." });
  }
});

// A Rota PUT atualiza uma tarefa existente no SQLite com validações estritas
app.put("/api/tasks/:id", authenticate, (req: AuthRequest<{ id: string }>, res: Response) => {
  const usuarioId = req.usuarioId!;
  const idParaAtualizar = parsearId(req.params.id);
  if (idParaAtualizar === null) {
    return res.status(400).json({ error: "ID inválido." });
  }

  const { title, prioridade, status } = req.body;

  // Validação via helpers
  if (!tituloValido(title)) {
    return res.status(400).json({
      error: "O título da tarefa é obrigatório e deve conter pelo menos 3 caracteres válidos."
    });
  }

  const prioridadeValida = normalizarPrioridade(prioridade);
  const statusValido = normalizarStatus(status);

  try {
    // UPDATE completo não tem statement fixo no topo: criado inline,
    // mas ainda com placeholders (?) para segurança
    const sql = "UPDATE TAREFAS SET TITULO = ?, STATUS = ?, PRIORIDADE = ? WHERE IDTAREFA = ? AND USUARIO_ID = ?";
    const resultado = db.prepare(sql).run(title.trim(), statusValido, prioridadeValida, idParaAtualizar, usuarioId);

    if (resultado.changes === 0) {
      return res.status(404).json({ message: "Tarefa não encontrada para atualização!" });
    }

    const tarefaAtualizada = stmtBuscarPorId.get(idParaAtualizar, usuarioId) as Tarefa;
    return res.status(200).json(tarefaAtualizada);
  } catch {
    return res.status(500).json({ error: "Erro ao processar a atualização no banco de dados." });
  }
});

// A Rota PATCH executa atualizações parciais com validações sob demanda de forma segura e atômica
app.patch("/api/tasks/:id", authenticate, (req: AuthRequest<{ id: string }>, res: Response) => {
  const usuarioId = req.usuarioId!;
  const idParaAtualizar = parsearId(req.params.id);

  if (idParaAtualizar === null) {
    return res.status(400).json({ error: "ID inválido." });
  }


  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: "Nenhum campo fornecido para atualização." });
  }

  const { title, prioridade, status } = req.body;

  try {
    // Usamos uma transação para garantir consistência ao buscar e atualizar (evita estado parcial)
    const fluxoAtualizacao = db.transaction(() => {
      // 3. Busca o registro atual no banco para validação cruzada/existência
      const tarefaExistente = stmtBuscarPorId.get(idParaAtualizar, usuarioId) as Tarefa | undefined;
      if (!tarefaExistente) return null;

      const camposParaAtualizar: string[] = [];
      const valoresParaAtualizar: unknown[] = [];

      // 4. Validação condicional: Título (se enviado)
      if (title !== undefined) {
        if (!tituloValido(title)) {
          throw new Error("O título da tarefa deve conter pelo menos 3 caracteres válidos.");
        }
        camposParaAtualizar.push("TITULO = ?");
        valoresParaAtualizar.push(title.trim());
      }

      // 5. Validação condicional: Prioridade (se enviada)
      if (prioridade !== undefined) {
        if (!(PRIORIDADES as readonly string[]).includes(prioridade)) {
          throw new Error("Prioridade inválida. Use 'Baixa', 'Media' ou 'Alta'.");
        }
        camposParaAtualizar.push("PRIORIDADE = ?");
        valoresParaAtualizar.push(prioridade);
      }

      // 6. Validação condicional: Status (se enviado)
      if (status !== undefined) {
        if (!(STATUS_VALIDOS as readonly string[]).includes(status)) {
          throw new Error("Status inválido. Use 'Pendente' ou 'Finalizada'.");
        }
        camposParaAtualizar.push("STATUS = ?");
        valoresParaAtualizar.push(status);
      }

      if (camposParaAtualizar.length === 0) return tarefaExistente;

      // 7. Montagem segura da query dinâmica com Prepared Statements
      const sql = `UPDATE TAREFAS SET ${camposParaAtualizar.join(", ")} WHERE IDTAREFA = ? AND USUARIO_ID = ?`;
      valoresParaAtualizar.push(idParaAtualizar, usuarioId);

      db.prepare(sql).run(...valoresParaAtualizar);
      return stmtBuscarPorId.get(idParaAtualizar, usuarioId) as Tarefa;
    });

    const resultado = fluxoAtualizacao();

    if (!resultado) {
      return res.status(404).json({ message: "Tarefa não encontrada para atualização parcial!" });
    }

    return res.status(200).json(resultado);

  } catch (erro) {
    if (erro instanceof Error &&
      (erro.message.includes("inválid") || erro.message.includes("caracteres"))) {
      return res.status(400).json({ error: erro.message });
    }
    return res.status(500).json({ error: "Erro ao processar a atualização parcial no banco." });
  }
});

app.listen(port, () => {
  console.log(`Servidor funfando em http://localhost:${port}`)
})


