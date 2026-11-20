import type { Canal } from "../avisos.js";

export type ConfigWhatsapp = { url: string; instancia: string; token: string; para: string };

/** WhatsApp pela Evolution API: POST {url}/message/sendText/{instancia}, cabeçalho apikey. */
export function canalWhatsapp(cfg: ConfigWhatsapp, fetchFn: typeof fetch): Canal {
  const destino = `${cfg.url.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(cfg.instancia)}`;
  return {
    nome: "whatsapp",
    async enviar(texto) {
      const resposta = await fetchFn(destino, {
        method: "POST",
        headers: { apikey: cfg.token, "content-type": "application/json" },
        body: JSON.stringify({ number: cfg.para, text: texto }),
        signal: AbortSignal.timeout(10_000),
      });
      await resposta.body?.cancel();
      if (!resposta.ok) throw new Error(`Evolution API respondeu HTTP ${resposta.status}`);
    },
  };
}
