import express from "express"
import Database from "better-sqlite3"

const app = express()

const port = 3000

// 1. Molde (Interface) das tarefas — nomes das colunas reais do banco
interface Tarefa {
  IDTAREFA: number;
  TITULO: string;
  STATUS: string;
  PRIORIDADE: string;
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

// middleware para ler body json
app.use(express.json())

const db = new Database("tarefas.db")

db.exec(`
    CREATE TABLE IF NOT EXISTS TAREFAS (
        IDTAREFA INTEGER PRIMARY KEY AUTOINCREMENT,
        TITULO TEXT NOT NULL,
        STATUS TEXT DEFAULT 'Pendente',
        PRIORIDADE TEXT DEFAULT 'Media'
    );    

    CREATE TABLE IF NOT EXISTS USUARIOS (
        IDUSUARIO INTEGER PRIMARY KEY AUTOINCREMENT,
        EMAIL TEXT NOT NULL,
        SENHA TEXT NOT NULL
    );
`)

// Escrevemos (compilamos) as buscas UMA ÚNICA VEZ e guardamos na memória.
// Precisam vir depois do CREATE TABLE, senão o prepare estoura ("no such table").
const stmtContarUsuarios = db.prepare("SELECT COUNT(*) AS count FROM USUARIOS")
const stmtInserirUsuario = db.prepare("INSERT INTO USUARIOS (EMAIL, SENHA) VALUES (?, ?)")
const stmtListarTodas = db.prepare("SELECT * FROM TAREFAS")
const stmtBuscarPorTitulo = db.prepare("SELECT * FROM TAREFAS WHERE TITULO LIKE ?")
const stmtBuscarPorId = db.prepare("SELECT * FROM TAREFAS WHERE IDTAREFA = ?")
const stmtInserirTarefa = db.prepare("INSERT INTO TAREFAS (TITULO, STATUS, PRIORIDADE) VALUES (?, 'Pendente', ?)")
const stmtDeletarTarefa = db.prepare("DELETE FROM TAREFAS WHERE IDTAREFA = ?")

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

// GET /tasks - Busca tarefas cadastradas
app.get("/api/tasks", (req, res) => {
    // 1. Coerção segura: se vier array/objeto na URL, vira string vazia
    const search = typeof req.query.search === "string" ? req.query.search : "";
    try {
        if (search) {
            // 2. O '%' entra só dentro do parâmetro (?), nunca na string da query
            const tarefas = stmtBuscarPorTitulo.all(`%${search}%`)
            res.json(tarefas);
        } else {
            // 3. Busca já compilada no Passo 2
            const tarefas = stmtListarTodas.all();
            res.json(tarefas);
        }
    } catch {
        // 4. Erro genérico: não vaza a estrutura do banco pra internet
        res.status(500).json({ error: "Erro interno ao processar a listagem." });
    }
});

// POST /tasks - Cria uma nova tarefa
app.post("/api/tasks", (req, res) => {
    const { title, prioridade } = req.body;
    const prioridadeValida = normalizarPrioridade(prioridade);

    // Validação rígida: Título obrigatório, não vazio e com tamanho mínimo
    // Sanitizamos com .trim() ANTES de checar o length, aplicando a regra de negócio
    if (!tituloValido(title)) {
        return res.status(400).json({
            error: "O título da tarefa é obrigatório e deve conter pelo menos 3 caracteres válidos."
        });
    }

    try {
        const resultado = stmtInserirTarefa.run(title.trim(), prioridadeValida);

        // Retorna o objeto recém-criado usando o ID gerado (lastInsertRowid).
        const novaTarefa = stmtBuscarPorId.get(resultado.lastInsertRowid);
        return res.status(201).json(novaTarefa);
    } catch (erro) {
        return res.status(500).json({ error: "Erro ao processar persistência" });
    }
});

// Rota para deletar fisicamente uma tarefa do banco
app.delete("/api/tasks/:id", (req, res) => {
    const id = parsearId(req.params.id);
    if (id === null) {
        res.status(404).json({ error: "Tarefa não localizada para exclusão." });
        return;
    }
    try {
        const resultado = stmtDeletarTarefa.run(id);
        
        // No SQLite, o sucesso é medido pelo número de 
        // linhas afetadas (changes)
        if (resultado.changes === 0) {
            res.status(404).json(
                { error: "Tarefa não localizada para exclusão." }
            );
            return;
        }
        res.json(
            { message: "Tarefa excluída do banco SQLite com sucesso!" }
        );
    } catch (erro) { 
        res.status(500).json(
        { error: erro instanceof Error ? erro.message : "Erro desconhecido" }
        );
    }
});

// A Rota PUT atualiza uma tarefa existente no SQLite com validações estritas
app.put("/api/tasks/:id", (req, res) => {
  const idParaAtualizar = parsearId(req.params.id);

  // 1. Validação do ID numérico recebido na URL
  if (idParaAtualizar === null) {
    return res.status(400).json({ error: "ID inválido." });
  }


  const { title, prioridade, status } = req.body;


  // 2. Validação rígida do Título (assim como na Aula 10)
  if (!tituloValido(title)) {
    return res.status(400).json({
      error: "O título da tarefa é obrigatório e deve conter pelo menos 3 caracteres válidos."
    });
  }


  // 3. Sanitização e valores padrão para prioridade e status
  const prioridadeValida = normalizarPrioridade(prioridade);
  const statusValido = normalizarStatus(status);


  try {
    // 4. Execução do UPDATE utilizando Prepared Statement (?) para segurança
    const sql = "UPDATE TAREFAS SET TITULO = ?, STATUS = ?, PRIORIDADE = ? WHERE IDTAREFA = ?";
    const resultado = db.prepare(sql).run(title.trim(), statusValido, prioridadeValida, idParaAtualizar);


    // 5. Verifica se alguma linha foi de fato modificada no banco
    if (resultado.changes === 0) {
      return res.status(404).json({ message: "Tarefa não encontrada para atualização!" });
    }


    // 6. Busca a tarefa recém-atualizada para retornar no corpo da resposta (Princípio REST)
    const tarefaAtualizada = stmtBuscarPorId.get(idParaAtualizar);
    return res.status(200).json(tarefaAtualizada);


  } catch (erro) {
    return res.status(500).json({ error: "Erro ao processar a atualização no banco de dados." });
  }
});

// A Rota PATCH executa atualizações parciais com validações sob demanda de forma segura e atômica
app.patch("/api/tasks/:id", (req, res) => {
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
      const tarefaExistente = stmtBuscarPorId.get(idParaAtualizar) as Tarefa | undefined;
      if (!tarefaExistente) return null;

      const camposParaAtualizar: string[] = [];
      const valoresParaAtualizar: any[] = [];

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
      const sql = `UPDATE TAREFAS SET ${camposParaAtualizar.join(", ")} WHERE IDTAREFA = ?`;
      valoresParaAtualizar.push(idParaAtualizar);

      db.prepare(sql).run(...valoresParaAtualizar);
      return stmtBuscarPorId.get(idParaAtualizar);
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


