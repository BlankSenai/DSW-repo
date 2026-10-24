/**
 * Login.tsx — a tela de login/registro.
 *
 * Um único componente atende os dois casos. O estado `modo` decide se o
 * botão principal chama /api/auth/register ou /api/auth/login, e se o
 * texto diz "Entrar" ou "Criar conta".
 */

import { useState } from "react";
import { login, registrar } from "./api";

/** O que o App precisa saber: o login deu certo. */
interface LoginProps {
  aoLogar: () => void;
}

/** Os dois modos da tela. O TypeScript impede trocaremos por engano. */
type Modo = "login" | "registro";

export default function Login({ aoLogar }: LoginProps) {
  // O que o usuário está digitando agora.
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");

  // Qual tela estamos exibindo: login ou registro.
  const [modo, setModo] = useState<Modo>("login");

  // feedbacks da requisição
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  /**
   * Regras de negócio que o back também exige.
   * Validar aqui não substitui a validação do servidor (o back sempre
   * valida de novo) — serve só para dar um retorno rápido e amigável.
   */
  const validar = (): string => {
    if (!email.trim()) return "Informe o e-mail.";
    // A barra do @ é o mínimo esperado para um e-mail.
    if (!email.includes("@")) return "Informe um e-mail válido.";

    if (!senha) return "Informe a senha.";
    // O server.ts exige 6 caracteres no registro (POST /api/auth/register).
    if (modo === "registro" && senha.length < 6) {
      return "A senha deve ter pelo menos 6 caracteres.";
    }
    return "";
  };

  /**
   * O que acontece ao apertar o botão principal.
   * `async` porque involves fetch (uma Promise). Por isso o `try/catch`.
   */
  const enviar = async (e: React.FormEvent) => {
    // Sem isso, o browser recarregaria a página e perderíamos todo o estado.
    e.preventDefault();

    setErro("");

    // Conferimos as regras antes de gastar uma ida ao servidor.
    const problema = validar();
    if (problema) {
      setErro(problema);
      return; // não segue para o fetch
    }

    setCarregando(true);

    try {
      if (modo === "login") {
        await login(email.trim(), senha);
      } else {
        // Primeiro cria a conta...
        await registrar(email.trim(), senha);
        // ...e só então entra com ela, para o usuário não ter que digitar de novo.
        await login(email.trim(), senha);
      }

      // Deu certo: avisamos o App, que vai trocar a tela.
      aoLogar();
    } catch (err) {
      // A mensagem veio pronta do back (ex.: "E-mail já cadastrado.").
      setErro(err instanceof Error ? err.message : "Falha ao autenticar.");
    } finally {
      // Roda tanto no sucesso quanto no erro: destrava o botão.
      setCarregando(false);
    }
  };

  const ehLogin = modo === "login";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <h1 className="text-center text-2xl font-bold tracking-tight text-white">
          Gerenciador de Tarefas
        </h1>
        <p className="mt-2 text-center text-sm text-slate-400">
          {ehLogin ? "Entre para continuar" : "Crie sua conta para começar"}
        </p>

        <form onSubmit={enviar} className="mt-8 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium text-slate-300">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com"
              autoComplete="email"
              required
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2.5 text-base text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="senha" className="text-sm font-medium text-slate-300">
              Senha
            </label>
            <input
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder={ehLogin ? "Sua senha" : "Mínimo de 6 caracteres"}
              // O teclado do celular oferece o campo certo para cada caso.
              autoComplete={ehLogin ? "current-password" : "new-password"}
              required
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2.5 text-base text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Mensagem de erro. role="alert" faz o leitor de tela anunciar. */}
          {erro && (
            <p
              role="alert"
              className="rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300"
            >
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={carregando}
            className="rounded-md bg-blue-600 py-2.5 font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {carregando ? "Aguarde..." : ehLogin ? "Entrar" : "Criar conta"}
          </button>
        </form>

        {/* type="button" é obrigatório aqui: dentro de um <form>, um button
            sem type vira "submit" e recarregaria a página. */}
        <button
          type="button"
          onClick={() => {
            setModo(ehLogin ? "registro" : "login");
            setErro(""); // troca de modo sem deixar erro antigo na tela
          }}
          className="mt-4 w-full text-sm text-slate-400 transition hover:text-white"
        >
          {ehLogin ? "Não tem conta? Registre-se" : "Já tem conta? Entrar"}
        </button>
      </div>
    </div>
  );
}
