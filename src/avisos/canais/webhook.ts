import { createHmac } from "node:crypto";
import type { Canal } from "../avisos.js";

export type ConfigWebhook = { url: string; segredo: string };

/**
 * Webhook assinado: POST do Evento em JSON, com X-Anti-Rea-Signature: sha256=<hex>,
 * o HMAC-SHA256 do corpo exato enviado, com o segredo do webhook. O texto do aviso não vai.
 */
export function canalWebhook(cfg: ConfigWebhook, fetchFn: typeof fetch): Canal {
  return {
    nome: "webhook",
    async enviar(_texto, evento) {
      const corpo = JSON.stringify(evento);
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
