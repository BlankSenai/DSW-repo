import express from "express"

const app = express()

const port = 3000

// GET /health - Integridade do sistema
app.get('/api/health', (_, res) => {
    res.json({
        status: "ok",
        message: "Gestor de tarefas saudável"
    })
})


app.listen(port, () => {
    console.log(`Servidor funfando em http://localhost:${port}`)
})


