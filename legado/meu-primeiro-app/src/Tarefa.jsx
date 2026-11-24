function Tarefa({ tarefa, onAlternarConclusao, onExcluirTarefa }) {
  return (
    <li key={tarefa.id}>
      <span style={{ textDecoration: tarefa.concluida ? 'line-through' : 'none' }}>
        {tarefa.titulo} - {tarefa.concluida ? 'Concluída' : 'Pendente'}
      </span>

      {'  '}

      <button onClick={() => onAlternarConclusao(tarefa.id)}>
        {tarefa.concluida ? 'Marcar como Pendente' : 'Marcar como Concluída'}
      </button>

      {'  '}

      <button onClick={() => onExcluirTarefa(tarefa.id)}>
        Excluir
      </button>
    </li>
  );
}

export default Tarefa;