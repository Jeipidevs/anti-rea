import type { OutgoingHttpHeaders, ServerResponse } from "node:http";

// Respostas próprias do porteiro (sombra, desafio, recusa, indisponível, rotas internas).

const CSP_SOMBRA = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
const CSP_DESAFIO =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; connect-src 'self'";

const CSP_PAINEL = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const HTML = "text/html; charset=utf-8";

/** Escreve a resposta inteira; não faz nada se o visitante já foi embora ou a resposta já começou. */
export function enviar(res: ServerResponse, status: number, cabecalhos: OutgoingHttpHeaders, corpo = ""): void {
  if (res.headersSent || res.destroyed) return;
  if (status === 204) {
    res.writeHead(status, cabecalhos);
    res.end();
    return;
  }
  const bytes = Buffer.from(corpo, "utf8");
  res.writeHead(status, { ...cabecalhos, "content-length": bytes.length });
  res.end(bytes);
}

export function responderSombra(res: ServerResponse, html: string, status: 200 | 404): void {
  enviar(
    res,
    status,
    { "content-type": HTML, "content-security-policy": CSP_SOMBRA, "x-robots-tag": "noindex", "cache-control": "no-store" },
    html,
  );
}

export function responderDesafio(res: ServerResponse, html: string): void {
  enviar(
    res,
    200,
    { "content-type": HTML, "content-security-policy": CSP_DESAFIO, "x-robots-tag": "noindex", "cache-control": "no-store" },
    html,
  );
}

/** Painel do registro: só do dono; sem script, sem cache, sem iframe e sem Referer para fora. */
export function responderPainel(res: ServerResponse, html: string): void {
  enviar(
    res,
    200,
    {
      "content-type": HTML,
      "content-security-policy": CSP_PAINEL,
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
      "cache-control": "no-store",
    },
    html,
  );
}

export function responderTexto(res: ServerResponse, status: number, texto: string, extras: OutgoingHttpHeaders = {}): void {
  enviar(res, status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extras }, texto);
}

export function responderRecusa(res: ServerResponse): void {
  responderTexto(res, 403, "Acesso negado.");
}

const INDISPONIVEL = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Site temporariamente indisponível</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:0 16px;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;color:#222;background:#fafafa}</style>
</head>
<body>
<main>
<h1>Site temporariamente indisponível</h1>
<p>Tente de novo em alguns instantes.</p>
</main>
</body>
</html>
`;

/** 502 quando o site está fora do ar, 504 quando ele não responde a tempo. Sem evento e sem aviso. */
export function responderIndisponivel(res: ServerResponse, status: 502 | 504 = 502): void {
  enviar(
    res,
    status,
    { "content-type": HTML, "content-security-policy": CSP_SOMBRA, "x-robots-tag": "noindex", "cache-control": "no-store" },
    INDISPONIVEL,
  );
}

export function responderJson(res: ServerResponse, status: number, dados: unknown, cookies: string[] = []): void {
  const extras: OutgoingHttpHeaders = cookies.length > 0 ? { "set-cookie": cookies } : {};
  enviar(res, status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extras }, JSON.stringify(dados));
}

export function responderVazio(res: ServerResponse, status: number, extras: OutgoingHttpHeaders = {}): void {
  enviar(res, status, { "cache-control": "no-store", ...extras });
}
