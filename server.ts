import express from "express"
import Database from "better-sqlite3"

const app = express()

const port = 3000

// middleware para ler body json
app.use(express.json())

interface Tarefa {
    id: number,
    title: String,
    status: "Pendente" | "Finalizado" | "Em andamento"
}

// banco provisorio em RAM
let temp_bd: Tarefa[] = [
    { id: 1, title: "Estudar REST", status: "Pendente" }
]

const db = new Database("tarefas.db")

db.exec(`
    CREATE TABLE IF NOT EXISTS TAREFAS (
        IDTAREFA INTEGER PRIMARY KEY AUTOINCREMENT,
        TITULO TEXT NOT NULL,
        STATUS TEXT DEFAULT 'Pendente'
    );    

    CREATE TABLE IF NOT EXISTS USUARIOS (
        IDUSUARIO INTEGER PRIMARY KEY AUTOINCREMENT,
        EMAIL TEXT NOT NULL,
        SENHA TEXT NOT NULL
    );
`)

// Inserindo dados falsos para serem vazados
const usuariosExistentes = db.prepare("SELECT COUNT(*) AS COUNT FROM USUARIOS").get() as any

if (usuariosExistentes.count == 0) {
    db.exec(`
        INSERT INTO USUARIOS (EMAIL, SENHA) VALUES (
            'admin',
            'P@ssw0rd'
        );    
    `)
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
    const { search } = req.query;
    try {
        if (search) {
            // Prepared Statement: O '?' protege contra Injeção de SQL.
            const sql = "SELECT * FROM TAREFAS WHERE TITULO LIKE ?";

            const tarefas = db.prepare(sql).all(`% ${ search } %`)
            res.json(tarefas);
        } else {
            const tarefas = db.prepare("SELECT * FROM TAREFAS").all();
            res.json(tarefas);
        }
    } catch (erro) {
        // Exibir o erro real ajuda a compreender a quebra de sintaxe gerada pelo ataque
        res.status(500).json({ error: erro instanceof Error ? erro.message : "Erro desconhecido" });
    }
});

// POST /tasks - Cria uma nova tarefa
app.post('/api/tasks', (req, res) => {
    const { title } = req.body

    const newTask: Tarefa = {
        id: Date.now(),
        title: title,
        status: "Pendente"
    }

    temp_bd.push(newTask)

    res.status(201).json({
        newTask
    })
})

// DELETE /tasks - Deleta uma tarefa
app.delete('/api/tasks/:id', (req, res) => {
    const deleteId = Number(req.params.id)

    const task: Tarefa | undefined = temp_bd.find(t => t.id == deleteId)

    if (task) {
        temp_bd = temp_bd.filter(t => t.id != deleteId)

        res.json({
            message: "Tarefa excluída com sucesso"
        })
    } else {
        res.status(404).json({
            message: "Tarefa não encontrada"
        })
    }

})



app.listen(port, () => {
    console.log(`Servidor funfando em http://localhost:${port}`)
})


