import type { Canal } from "../avisos.js";

export type ConfigTelegram = { token: string; chat: string };

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
          body: JSON.stringify({ chat_id: cfg.chat, text: texto }),
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
