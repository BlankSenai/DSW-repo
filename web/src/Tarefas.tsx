/**
 * Tarefas.tsx — a tela principal do Gerenciador de Tarefas.
 *
 * É aqui que o front "conversa" com a API: lista, cria, conclui e exclui
 * tarefas. Tudo passa por api.ts, que por baixo coloca o token do usuário.
 *
 * A tela tem quatro partes visíveis:
 *   1. cabeçalho — e-mail de quem está conectado e botão Sair
 *   2. formulário — campos de título/prioridade e busca
 *   3. lista  — as tarefas, com contador e rolagem
 *   4. modal  — confirmação antes de excluir
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  atualizarTarefa,
  criarTarefa,
  deletarTarefa,
  listarTarefas,
  type Tarefa,
  type Usuario,
} from "./api";

// Tipos derivados de Tarefa: se o back mudar o conjunto de valores,
// o TypeScript avisa aqui sem precisar mexer em nada.
type Prioridade = Tarefa["prioridade"]; // "low" | "medium" | "high"
type Status = Tarefa["status"]; // "pending" | "completed"

/**
 * A API fala inglês (low/medium/high) porque é o contrato com o banco,
 * mas a tela fala português. Este dicionário é a tradução.
 * O Record<Prioridade, string> garante que, se o back inventar uma prioridade
 * nova, o TypeScript reclame até você traduzir aqui.
 */
const PRIORIDADES_PT: Record<Prioridade, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

/** As opções na ordem em que aparecem no <select>. */
const PRIORIDADES: Prioridade[] = ["low", "medium", "high"];

/** Cores do badge de prioridade, por nível. */
const COR_PRIORIDADE: Record<Prioridade, string> = {
  low: "bg-slate-700/60 text-slate-300 ring-slate-600",
  medium: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  high: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
};

/** Quanto tempo esperamos a pessoa parar de digitar antes de buscar. */
const DEBOUNCE_MS = 400;

/** Extrai a mensagem de erro de qualquer coisa que tenha sido lançada. */
function mensagemDe(erro: unknown, padrao: string): string {
  return erro instanceof Error ? erro.message : padrao;
}

// ---------------------------------------------------------------------------
// O componente
// ---------------------------------------------------------------------------

interface TarefasProps {
  /** Quem está logado — vem do App, que decodificou o token. */
  usuario: Usuario;
  /** Volta para a tela de login (o App é quem apaga o token). */
  aoSair: () => void;
}

export default function Tarefas({ usuario, aoSair }: TarefasProps) {
  // --- dados ---------------------------------------------------------------
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // --- busca ---------------------------------------------------------------
  // Dois estados de propósito: `busca` é o que está na caixa de texto (muda a
  // cada tecla) e `buscaAplicada` é o que realmente vai para a API. Sem essa
  // separação, cada tecla dispararia uma requisição.
  const [busca, setBusca] = useState(""); // muda a cada tecla
  const [buscaAplicada, setBuscaAplicada] = useState(""); // vai para a API

  // --- formulário de criação ----------------------------------------------
  const [titulo, setTitulo] = useState("");
  const [prioridade, setPrioridade] = useState<Prioridade>("medium");
  const [criando, setCriando] = useState(false);

  // --- modal de exclusão ---------------------------------------------------
  const [paraExcluir, setParaExcluir] = useState<Tarefa | null>(null);

  /**
   * Guarda o id da requisição em andamento. Serve para descartar respostas
   * antigas: se você digita "c", "ca", "cas" rápido, as três requisições saem
   * juntas e nem sempre voltam na ordem. Sem esta trava, a resposta do "c"
   * poderia chegar por último e sobrescrever a lista com o resultado errado.
   */
  const requisicaoAtual = useRef(0);

  /**
   * O termo que foi REALMENTE enviado para a API na última vez.
   *
   * Serve para o efeito de debounce saber se o valor mudou de verdade. Um
   * useState não serviria: aqui o valor só interessa lá dentro do setTimeout,
   * e não no próximo render.
   */
  const ultimaBusca = useRef("");

  /** Esta resposta ainda interessa, ou outra requisição já começou? */
  const aindaValida = (meuId: number): boolean =>
    meuId === requisicaoAtual.current;

  /**
   * Recarrega a lista. Usada pelos botões (criar, concluir, excluir) depois
   * de uma alteração, para a tela refletir o que o banco gravou.
   */
  const carregar = useCallback(async (): Promise<void> => {
    const meuId = ++requisicaoAtual.current;
    try {
      const dados = await listarTarefas(buscaAplicada);
      if (!aindaValida(meuId)) return;
      setTarefas(dados);
      // Limpamos o aviso só depois do sucesso, para uma falha antiga não
      // piscar na tela enquanto a nova requisição ainda está em voo.
      setErro("");
    } catch (e) {
      if (!aindaValida(meuId)) return;
      setErro(mensagemDe(e, "Não foi possível carregar suas tarefas."));
    } finally {
      if (aindaValida(meuId)) setCarregando(false);
    }
  }, [buscaAplicada]);

  /**
   * Efeito 1 — o "debounce". Espera a digitação parar antes de aplicar a busca.
   * O return é a função de limpeza: se a pessoa digitar mais, o React roda ela
   * primeiro, cancelando o setTimeout anterior. É o que evita o "efeito máquina
   * de escrever" na API.
   *
   * O setCarregando fica dentro do setTimeout de propósito: ali ele já roda
   * assíncrono, então não provoca um render extra logo no começo do efeito.
   *
   * E a linha do `if` é o que impede um bug muito confuso. Na montagem, `busca`
   * e `ultimaBusca` já valem "": o timer dispara 400ms depois e não muda nada.
   * Se marcássemos "carregando" assim mesmo, a tela entraria em "Carregando..."
   * e nunca mais sairia, porque sem busca nova não existe resposta para
   * desligar a flag. A lista apareceria por um instante e sumiria.
   */
  useEffect(() => {
    const temporizador = setTimeout(() => {
      const termo = busca.trim();

      // Nada mudou de verdade: não busca e não mexe no "carregando".
      if (termo === ultimaBusca.current) return;

      ultimaBusca.current = termo;
      setBuscaAplicada(termo);
      setCarregando(true);
    }, DEBOUNCE_MS);
    return () => clearTimeout(temporizador);
  }, [busca]);

  /**
   * Efeito 2 — busca os dados na abertura e a cada busca aplicada.
   *
   * Repare que o estado só é tocado DENTRO dos callbacks do .then, nunca no
   * corpo do efeito. É o padrão recomendado pelo React para buscar dados: se
   * atualizássemos estado direto aqui, teríamos um render em cascata
   * desnecessário logo na montagem.
   *
   * São duas proteções, com papéis diferentes:
   *  - `montado` é a limpeza do efeito. Se a tela sair (ou a busca mudar
   *    antes da resposta chegar), a resposta chega tarde e é ignorada.
   *  - `aindaValida(meuId)` é a trava contra respostas fora de ordem, e
   *    vale inclusive para as requisições disparadas pelos botões.
   */
  useEffect(() => {
    const meuId = ++requisicaoAtual.current;
    let montado = true;

    listarTarefas(buscaAplicada).then(
      (dados) => {
        if (!montado || !aindaValida(meuId)) return;
        setTarefas(dados);
        setErro("");
        setCarregando(false);
      },
      (e: unknown) => {
        if (!montado || !aindaValida(meuId)) return;
        setErro(mensagemDe(e, "Não foi possível carregar suas tarefas."));
        setCarregando(false);
      },
    );

    return () => {
      montado = false;
    };
  }, [buscaAplicada]);

  // --- criar ---------------------------------------------------------------
  const criar = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    const tituloLimpo = titulo.trim();
    if (tituloLimpo.length < 3) {
      setErro("O título precisa ter ao menos 3 caracteres.");
      return;
    }

    setCriando(true);
    setErro("");

    try {
      await criarTarefa(tituloLimpo, prioridade);
      setTitulo("");
      setPrioridade("medium");
      await carregar();
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível criar a tarefa."));
    } finally {
      setCriando(false);
    }
  };

  // --- concluir / reabrir --------------------------------------------------
  const alternarStatus = async (tarefa: Tarefa): Promise<void> => {
    const novoStatus: Status =
      tarefa.status === "completed" ? "pending" : "completed";

    setErro("");
    try {
      await atualizarTarefa(tarefa.id, { status: novoStatus });
      await carregar();
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível atualizar a tarefa."));
    }
  };

  // --- excluir -------------------------------------------------------------
  const confirmarExcluir = async (): Promise<void> => {
    if (!paraExcluir) return;
    const alvo = paraExcluir;

    // Fecha o modal na hora: o clique já foi confirmado, não faz sentido
    // deixar a janela aberta esperando a resposta da rede.
    setParaExcluir(null);
    setErro("");

    try {
      await deletarTarefa(alvo.id);
      await carregar();
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível excluir a tarefa."));
    }
  };

  // --- acessibilidade do modal --------------------------------------------
  // Ao abrir, o foco vai para o botão de confirmar, para quem navega só com o
  // teclado saber imediatamente onde está.
  const botaoConfirmar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (paraExcluir) botaoConfirmar.current?.focus();
  }, [paraExcluir]);

  // Esc fecha o modal. Só fica de escuta quando o modal está aberto.
  useEffect(() => {
    if (!paraExcluir) return;

    const aoTeclar = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setParaExcluir(null);
    };

    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [paraExcluir]);

  // --- contadores ----------------------------------------------------------
  const total = tarefas.length;
  const concluidas = tarefas.filter((t) => t.status === "completed").length;
  const pendentes = total - concluidas;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-10">
      {/* ---------------------------------------------------------- 1. cabeçalho */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Minhas Tarefas
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Conectado como <span className="text-slate-200">{usuario.email}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={aoSair}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Sair
        </button>
      </header>

      {/* ------------------------------------------------------- 2. criar tarefa */}
      <form
        onSubmit={criar}
        className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:flex-row"
      >
        <div className="flex-1">
          <label htmlFor="titulo" className="sr-only">
            Título da nova tarefa
          </label>
          <input
            id="titulo"
            type="text"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="O que precisa ser feito?"
            maxLength={120}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="prioridade" className="sr-only">
            Prioridade
          </label>
          <select
            id="prioridade"
            value={prioridade}
            onChange={(e) => setPrioridade(e.target.value as Prioridade)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-slate-500 focus:outline-none sm:w-auto"
          >
            {PRIORIDADES.map((p) => (
              <option key={p} value={p}>
                {PRIORIDADES_PT[p]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={criando}
          className="rounded-md bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white disabled:opacity-50"
        >
          {criando ? "Criando..." : "Adicionar"}
        </button>
      </form>

      {/* ------------------------------------------------------------- 3. busca */}
      <div className="flex flex-col gap-2">
        <label htmlFor="busca" className="text-sm font-medium text-slate-300">
          Buscar por título
        </label>
        <input
          id="busca"
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Digite para filtrar..."
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
        />
      </div>

      {/* -------------------------------------------------------------- 4. erro */}
      {erro && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          <span>{erro}</span>
          <button
            type="button"
            onClick={() => setErro("")}
            aria-label="Fechar aviso"
            className="shrink-0 text-rose-300 transition hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- 5. lista */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        {/* aria-live faz o leitor de tela anunciar a contagem a cada mudança */}
        <p aria-live="polite" className="mb-3 text-sm text-slate-400">
          {carregando
            ? "Carregando..."
            : `${pendentes} pendente(s) e ${concluidas} concluída(s).`}
        </p>

        {carregando ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Buscando suas tarefas...
          </p>
        ) : total === 0 ? (
          <div className="py-10 text-center">
            <p className="text-slate-300">
              {buscaAplicada
                ? `Nenhuma tarefa contém "${buscaAplicada}".`
                : "Nenhuma tarefa por aqui ainda."}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {buscaAplicada
                ? "Tente outro termo de busca."
                : "Use o formulário acima para criar a primeira."}
            </p>
          </div>
        ) : (
          <ul className="flex max-h-[60vh] list-none flex-col gap-2 overflow-y-auto p-0 pr-1">
            {tarefas.map((t) => {
              const feita = t.status === "completed";

              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm ${
                        feita
                          ? "text-slate-500 line-through"
                          : "text-slate-100"
                      }`}
                    >
                      {t.titulo}
                    </p>
                    <span
                      className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ring-1 ${COR_PRIORIDADE[t.prioridade]}`}
                    >
                      {PRIORIDADES_PT[t.prioridade]}
                    </span>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void alternarStatus(t)}
                      className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
                    >
                      {feita ? "Reabrir" : "Concluir"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setParaExcluir(t)}
                      className="rounded border border-rose-500/40 px-3 py-1 text-xs text-rose-300 transition hover:border-rose-400 hover:text-rose-200"
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ------------------------------------------------------- 6. modal de exclusão */}
      {paraExcluir && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          // Clicar no fundo (fora do cartão) cancela.
          onClick={() => setParaExcluir(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-modal"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
          >
            <h2 id="titulo-modal" className="text-lg font-semibold text-white">
              Excluir esta tarefa?
            </h2>

            <p className="mt-2 text-sm text-slate-400">
              <span className="text-slate-200">{paraExcluir.titulo}</span> será
              removida permanentemente. Não dá para desfazer.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setParaExcluir(null)}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Cancelar
              </button>

              <button
                ref={botaoConfirmar}
                type="button"
                onClick={() => void confirmarExcluir()}
                className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
