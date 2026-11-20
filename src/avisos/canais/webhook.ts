import { createHmac } from "node:crypto";
import type { Canal } from "../avisos.js";

export type ConfigWebhook = { url: string; segredo: string };

/**
 * Webhook assinado: POST em JSON, com X-Anti-Rea-Signature: sha256=<hex>, o HMAC-SHA256 do corpo exato
 * enviado, com o segredo do webhook. Aviso de um pedido manda o Evento (o texto não vai); texto sem
 * evento (resumo do dia, aviso agrupado do teto) manda {"tipo":"resumo","texto":...,"quando":<ISO>}.
 */
export function canalWebhook(cfg: ConfigWebhook, fetchFn: typeof fetch, agora: () => number = Date.now): Canal {
  return {
    nome: "webhook",
    async enviar(texto, evento) {
      const corpo = JSON.stringify(
        evento ?? { tipo: "resumo", texto, quando: new Date(agora()).toISOString() },
      );
      const assinatura = createHmac("sha256", cfg.segredo).update(corpo).digest("hex");
      const resposta = await fetchFn(cfg.url, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Anti-Rea-Signature": `sha256=${assinatura}` },
        body: corpo,
        signal: AbortSignal.timeout(10_000),
      });
      await resposta.body?.cancel();
      if (!resposta.ok) throw new Error(`webhook respondeu HTTP ${resposta.status}`);
    },
  };
}
