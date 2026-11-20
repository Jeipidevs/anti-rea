import type { Canal } from "../avisos.js";

export type ConfigTelegram = { token: string; chat: string };

/** A Bot API recusa (HTTP 400) sendMessage com texto acima de 4096 caracteres. */
const MAX_TEXTO = 4096;

function cortar(texto: string): string {
  if (texto.length <= MAX_TEXTO) return texto;
  let fim = MAX_TEXTO - 1;
  // Não deixa metade de um par substituto (emoji) no fim.
  const ultimo = texto.charCodeAt(fim - 1);
  if (ultimo >= 0xd800 && ultimo <= 0xdbff) fim--;
  return `${texto.slice(0, fim)}\u2026`;
}

/** Telegram pela Bot API: POST /bot{token}/sendMessage, texto puro (sem parse_mode). */
export function canalTelegram(cfg: ConfigTelegram, fetchFn: typeof fetch): Canal {
  const destino = `https://api.telegram.org/bot${cfg.token}/sendMessage`;
  // O token vai na URL: qualquer mensagem de erro que a cite sai com ele trocado por ***.
  const semToken = (texto: string) => texto.split(cfg.token).join("***");
  return {
    nome: "telegram",
    async enviar(texto) {
      let resposta: Response;
      try {
        resposta = await fetchFn(destino, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: cfg.chat, text: cortar(texto) }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (erro) {
        throw new Error(semToken(erro instanceof Error ? erro.message : String(erro)));
      }
      await resposta.body?.cancel();
      if (!resposta.ok) throw new Error(`Bot API do Telegram respondeu HTTP ${resposta.status}`);
    },
  };
}
