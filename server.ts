import express from "express"
import { randomUUID, type UUID } from "node:crypto"

const app = express()

const port = 3000

// middleware para ler body json
app.use(express.json())

interface Tarefa {
    id: UUID,
    title: String,
    status: "Pendente" | "Finalizado" | "Em andamento"
}

// banco provisorio em RAM
let temp_bd: Tarefa[] = [
    {id: randomUUID(), title: "Estudar REST", status: "Pendente"}
]

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
app.get('/api/tasks', (_, res) => {
    res.json(
        temp_bd
    )
})

// POST /tasks - Cria uma nova tarefa
app.post('/api/tasks', (req, res) => {
    const { title } = req.body

    const newTask: Tarefa = {
        id: randomUUID(),
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
    const deleteId = req.params.id

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


