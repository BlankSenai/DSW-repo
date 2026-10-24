/**
 * App.tsx — o "cérebro" da aplicação: decide qual tela mostrar.
 *
 * Existem dois estados possíveis:
 *   - deslogado -> mostra o <Login />
 *   - logado    -> mostra o <Tarefas />
 *
 * O App não sabe nada sobre tarefas: ele só guarda QUEM está logado e
 * entrega essa informação para a tela seguinte. Quem manda na lista de
 * tarefas é o próprio Tarefas.tsx.
 */

import { useState } from "react";
import Login from "./Login";
import Tarefas from "./Tarefas";
import { clearToken, getUsuario, type Usuario } from "./api";

export default function App() {
  /**
   * O useState recebe uma FUNÇÃO como valor inicial. O React entende que
   * aquilo é uma "fábrica" e a chama uma única vez, já no primeiro render.
   *
   * Por que não getUsuario() direto? Porque a cada re-render o par
   * [usuario, setUsuario] é recriado. Se chamássemos direto, o token seria
   * lido e decodificado a cada tecla digitada na tela.
   */
  const [usuario, setUsuario] = useState<Usuario | null>(() => getUsuario());

  /**
   * Derivamos o "está logado?" do próprio usuario, em vez de guardar dois
   * estados que poderiam ficar dessincronizados (ex.: logado=true e usuario=null).
   *
   * Por isso NÃO existe um setLogado neste arquivo: quem loga e quem sai é o
   * usuario. Um estado a menos para manter em dia, uma classe de bug a menos.
   */
  const logado = usuario !== null;

  /** Chamado pelo Login quando a autenticação dá certo. */
  const aoLogar = (): void => {
    setUsuario(getUsuario());
  };

  /**
   * Chamado pelo botão "Sair" do Tarefas.
   *
   * Repare que o apagamento do token acontece AQUI, e não dentro do Tarefas.
   * Quem cuida da sessão é o App; a tela de tarefas só avisa "a pessoa pediu
   * para sair". Assim existe um único lugar no projeto que apaga o token.
   */
  const aoSair = (): void => {
    clearToken();
    setUsuario(null);
  };

  if (!logado) {
    return <Login aoLogar={aoLogar} />;
  }

  return <Tarefas usuario={usuario} aoSair={aoSair} />;
}
