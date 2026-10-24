import cors from 'cors';
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken"; 
import express, { type Request, type Response, type NextFunction } from "express";
import Database from "better-sqlite3";

const app = express();
app.use(cors()); // Libera o CORS para todas as rotas

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "super_secreto_desenvolvimento";

// 1. Criamos um "molde" (Interface) para nossas tarefas
interface Tarefa {
    id: number;
    titulo: string;
    status: string;
    prioridade: string;
}

interface Usuario {
    id: number;
    email: string;
    senha: string;
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

const normalizarPrioridade = (p: unknown) => {
  const listaPrioridades = PRIORIDADES as readonly string[];
  
  return typeof p === "string" && listaPrioridades.includes(p) 
    ? p 
    : "medium";
};

const normalizarStatus = (s: unknown) => {
  const listaStatus = STATUS_VALIDOS as readonly string[];
  
  return typeof s === "string" && listaStatus.includes(s) 
    ? s 
    : "pending";
};


// 4. Um ajudante só para transformar e validar IDs
const parsearId = (idParam: string): number | null => {
    const id = Number(idParam);
    // Number("12abc") vira NaN imediatamente, o que é mais seguro!
    return isNaN(id) ? null : id;
};

// Middleware para ler o corpo das requisições em formato JSON
app.use(express.json());

const db = new Database("tarefas.db");

db.exec(`
    CREATE TABLE IF NOT EXISTS tarefas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        prioridade TEXT DEFAULT 'medium',
        usuario_id INTEGER NOT NULL,
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL
    );
`);

// Escrevemos (compilamos) as buscas UMA ÚNICA VEZ e guardamos na memória.
const stmtContarUsuarios = db.prepare("SELECT COUNT(*) as count FROM usuarios");
const stmtInserirUsuario = db.prepare("INSERT INTO usuarios (email, senha) VALUES (?, ?)");
const stmtListarTodas = db.prepare("SELECT * FROM tarefas WHERE usuario_id = ?");
const stmtBuscarPorTitulo = db.prepare("SELECT * FROM tarefas WHERE titulo LIKE ? AND usuario_id = ?");
const stmtBuscarPorId = db.prepare("SELECT * FROM tarefas WHERE id = ? AND usuario_id = ?");
const stmtInserirTarefa = db.prepare("INSERT INTO tarefas (titulo, status, prioridade, usuario_id) VALUES (?, 'pending', ?, ?)");
const stmtDeletarTarefa = db.prepare("DELETE FROM tarefas WHERE id = ? AND usuario_id = ?");
const stmtBuscarUsuarioPorId = db.prepare("SELECT * FROM usuarios WHERE id = ?");
const stmtBuscarUsuarioPorEmail = db.prepare("SELECT * FROM usuarios WHERE email = ?");

// Inserindo dados falsos para serem vazados
const usuariosExistentes = stmtContarUsuarios.get() as { count: number };
if (usuariosExistentes.count === 0) {
    // Bom: Usamos a busca já preparada e passamos os dados de forma parametrizada
    stmtInserirUsuario.run("admin@senai.com", "senha_super_secreta_123");
}

console.log("Banco de dados SQLite inicializado com sucesso!");

// Middleware de Autenticação
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

// Rota de integridade do sistema (Health Check)
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Servidor do Gestor de Tarefas ativo!"});
});

app.get("/api/version", (req, res) => {
    res.json({ appName: "Gerenciador de Tarefas Multi-Usuário", version: "1.0.0" });
});

app.get("/api/tasks", authenticate, (req: AuthRequest, res) => {
    const usuarioId = req.usuarioId!; // Garantimos que existe pois o middleware já checou
    const search = typeof req.query.search === "string" ? req.query.search : "";
    
    try {
        if (search) {
            // 2. Proteção: O '%' entra DEPOIS, apenas dentro do parâmetro
            const tarefas = stmtBuscarPorTitulo.all(`%${search}%`, usuarioId);
            res.json(tarefas);
        } else {
            // 3. Performance: Usamos a busca compilada lá do Passo 2
            const tarefas = stmtListarTodas.all(usuarioId);
            res.json(tarefas);
        }
    } catch {
        // 4. Erro Controlado: Se algo quebrar, damos uma mensagem genérica para não vazar a estrutura do banco
        res.status(500).json({ error: "Erro interno ao processar a listagem." });
    }
});

app.post("/api/tasks", authenticate, (req: AuthRequest, res) => {
    const usuarioId = req.usuarioId!;
    const { titulo, prioridade } = req.body;
    const prioridadeValida = normalizarPrioridade(prioridade);
    
    // Validação via helper (type guard)
    if (!tituloValido(titulo)) {
        return res.status(400).json({
            error: "O título da tarefa é obrigatório e deve conter pelo menos 3 caracteres válidos."
        });
    }
    
    try {
        const resultado = stmtInserirTarefa.run(titulo.trim(), prioridadeValida, usuarioId);
        const novaTarefa = stmtBuscarPorId.get(resultado.lastInsertRowid, usuarioId) as Tarefa;
        
        return res.status(201).json(novaTarefa);
    } catch {
        return res.status(500).json({ error: "Erro ao processar persistência" });
    }
});

// Rota para deletar fisicamente uma tarefa do banco
app.delete("/api/tasks/:id", authenticate, (req: AuthRequest<{ id: string }>, res) => {
    const usuarioId = req.usuarioId!;
    // Validação de ID padronizada (igual PUT/PATCH)
    const idParaDeletar = parsearId(req.params.id);
    
    if (idParaDeletar === null) {
        return res.status(400).json({ error: "ID inválido." });
    }
    
    try {
        const resultado = stmtDeletarTarefa.run(idParaDeletar, usuarioId);
        
        if (resultado.changes === 0) {
            return res.status(404).json({ error: "Tarefa não localizada para exclusão." });
        }
        
        res.json({ message: "Tarefa excluída do banco SQLite com sucesso!" });
    } catch {
        res.status(500).json({ error: "Erro interno ao processar a exclusão." });
    }
});

// A Rota PUT atualiza uma tarefa existente no SQLite com validações estritas
app.put("/api/tasks/:id", authenticate, (req: AuthRequest<{ id: string }>, res) => {
    const usuarioId = req.usuarioId!;
    const idParaAtualizar = parsearId(req.params.id);
    
    if (idParaAtualizar === null) {
        return res.status(400).json({ error: "ID inválido." });
    }
    
    const { titulo, prioridade, status } = req.body;
    
    // Validação via helpers
    if (!tituloValido(titulo)) {
        return res.status(400).json({
            error: "O título da tarefa é obrigatório e deve conter pelo menos 3 caracteres válidos."
        });
    }
    
    const prioridadeValida = normalizarPrioridade(prioridade);
    const statusValido = normalizarStatus(status);
    
    try {
        // Prepared statement inline (UPDATE completo não tem statement fixo no topo)
        const sql = "UPDATE tarefas SET titulo = ?, status = ?, prioridade = ? WHERE id = ? AND usuario_id = ?";
        const resultado = db.prepare(sql).run(titulo.trim(), statusValido, prioridadeValida, idParaAtualizar, usuarioId);
        
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
app.patch("/api/tasks/:id", authenticate, (req: AuthRequest<{ id: string }>, res) => {
    const usuarioId = req.usuarioId!;
    const idParaAtualizar = parsearId(req.params.id);
    
    if (idParaAtualizar === null) {
        return res.status(400).json({ error: "ID inválido." });
    }
    
    if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "Nenhum campo fornecido para atualização." });
    }
    
    const { titulo, prioridade, status } = req.body;
    
    try {
        const fluxoAtualizacao = db.transaction(() => {
            // Busca com statement singleton
            const tarefaExistente = stmtBuscarPorId.get(idParaAtualizar, usuarioId) as Tarefa | undefined;
            if (!tarefaExistente) return null;
            
            const camposParaAtualizar: string[] = [];
            const valoresParaAtualizar: unknown[] = [];
            
            // Título (se enviado)
            if (titulo !== undefined) {
                if (!tituloValido(titulo)) {
                    throw new Error("O título da tarefa deve conter pelo menos 3 caracteres válidos.");
                }
                camposParaAtualizar.push("titulo = ?");
                valoresParaAtualizar.push(titulo.trim());
            }
            
            // Prioridade (se enviada)
            if (prioridade !== undefined) {
                if (!PRIORIDADES.includes(prioridade as typeof PRIORIDADES[number])) {
                    throw new Error("Prioridade inválida. Use 'low', 'medium' ou 'high'.");
                }
                camposParaAtualizar.push("prioridade = ?");
                valoresParaAtualizar.push(prioridade);
            }
            
            // Status (se enviado)
            if (status !== undefined) {
                if (!STATUS_VALIDOS.includes(status as typeof STATUS_VALIDOS[number])) {
                    throw new Error("Status inválido. Use 'pending' ou 'completed'.");
                }
                camposParaAtualizar.push("status = ?");
                valoresParaAtualizar.push(status);
            }
            
            if (camposParaAtualizar.length === 0) return tarefaExistente;
            
            // Query dinâmica SEGURA: placeholders ? + valores array
            const sql = `UPDATE tarefas SET ${camposParaAtualizar.join(", ")} WHERE id = ? AND usuario_id = ?`;
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
        // Distingue erro de validação (400) de erro interno (500)
        if (erro instanceof Error && (erro.message.includes("inválid") || erro.message.includes("caracteres"))) {
            return res.status(400).json({ error: erro.message });
        }
        return res.status(500).json({ error: "Erro ao processar a atualização parcial no banco." });
    }
});

app.post("/api/auth/register", (req, res) => {
    const { email, senha } = req.body;
    
    // Validação inicial dos dados
    if (typeof email !== "string" || typeof senha !== "string") {
        return res.status(400).json({ error: "E-mail e senha são obrigatórios." });
    }
    
    if (senha.trim().length < 6) {
        return res.status(400).json({ error: "A senha deve ter ao menos 6 caracteres." });
    }
    
    // Criando a "impressão digital" da senha
    const hash = bcrypt.hashSync(senha, 10);
    
    try {
        const resultado = stmtInserirUsuario.run(email.trim(), hash);
        const usuario = stmtBuscarUsuarioPorId.get(resultado.lastInsertRowid) as Usuario;
        
        return res.status(201).json({ id: usuario.id, email: usuario.email });
    } catch {
        return res.status(409).json({ error: "E-mail já cadastrado." });
    }
});

app.post("/api/auth/login", (req, res) => {
    const { email, senha } = req.body;
    
    if (typeof email !== "string" || typeof senha !== "string") {
        return res.status(400).json({ error: "E-mail e senha são obrigatórios." });
    }
    
    const usuario = stmtBuscarUsuarioPorEmail.get(email.trim()) as Usuario | undefined;
    
    // Compara SEMPRE com hash (mesmo se usuário não existir) para evitar vazamento
    const hashEsperado = usuario?.senha ?? "$2a$10$fakehashparanaquebrarcomparacao";
    const senhaOk = bcrypt.compareSync(senha, hashEsperado);
    
    if (!usuario || !senhaOk) {
        return res.status(401).json({ error: "Credenciais inválidas." });
    }
    
    // Gerando o "Crachá" de acesso
    const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, {
        expiresIn: "2h",
    });
    
    return res.json({ token });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em: http://localhost:${PORT}`);
});