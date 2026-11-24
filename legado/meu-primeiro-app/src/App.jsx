import { useState } from 'react';
import Tarefa from './Tarefa';

function App() {
  const [tarefas, setTarefas] = useState([]);
  const [novoTitulo, setNovoTitulo] = useState('');

  function adicionarTarefa(evento) {
    evento.preventDefault();

    const tituloLimpo = novoTitulo.trim();

    if (tituloLimpo === '') {
      return;
    }

    const novaTarefa = {
      id: Date.now(),
      titulo: tituloLimpo,
      concluida: false
    };

    setTarefas((listaAtual) => [...listaAtual, novaTarefa]);
    setNovoTitulo('');
  }

  function alternarConclusao(id) {
    setTarefas((listaAtual) =>
      listaAtual.map((tarefa) =>
        tarefa.id === id ? { ...tarefa, concluida: !tarefa.concluida } : tarefa
      )
    );
  }

  function excluirTarefa(id) {
    setTarefas((listaAtual) => listaAtual.filter((tarefa) => tarefa.id !== id));
  }

  const totalPendentes = tarefas.filter((tarefa) => !tarefa.concluida).length;

  const totalConcluidas = tarefas.filter((tarefa) => tarefa.concluida).length;

  return (
    <>
      <main>
        <h1>Minha Lista de Tarefas</h1>
        <p>Organiza suas atividades do dia</p>

        <form onSubmit={adicionarTarefa}>
          <label htmlFor="tituloTarefa">Nova Tarefa:</label>
          <input
            type="text"
            id="tituloTarefa"
            value={novoTitulo}
            onChange={(evento) => setNovoTitulo(evento.target.value)}
            placeholder='Ex.: Estudar React'
          />

          {'  '}

          <button type="submit">Adicionar</button>
        </form>

        <ul>
          {tarefas.map((tarefa) => (
            <Tarefa
              tarefa={tarefa}
              onAlternarConclusao={alternarConclusao}
              onExcluirTarefa={excluirTarefa}
            />
          ))}
        </ul>

        <p>Total de Tarefas: {tarefas.length}</p>
        <p>Pendentes: {totalPendentes}</p>
        <p>Concluídas: {totalConcluidas}</p>
      </main>
    </>
  );
}

export default App;