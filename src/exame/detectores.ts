// Detectores do exame: funções puras que olham um texto e dizem o que acharam. Nenhuma faz pedido.

/** Quantos scripts da página o exame abre, no máximo. */
export const MAX_SCRIPTS = 25;
/** Quantas rotas de API tiradas do JavaScript o exame confere, no máximo. */
export const MAX_ROTAS_API = 20;

/** Scripts da página (src de <script> e href de <link> de pré-carga de .js), só da mesma origem. */
export function scriptsDaPagina(html: string, pagina: URL): URL[] {
  const achados = new Map<string, URL>();
  const somar = (bruto: string | undefined) => {
    if (!bruto) return;
    let url: URL;
    try {
      url = new URL(bruto.replace(/&amp;/g, "&"), pagina);
    } catch {
      return;
    }
    if (url.origin !== pagina.origin) return;
    url.hash = "";
    if (achados.size < MAX_SCRIPTS) achados.set(url.href, url);
  };
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) somar(m[1] ?? m[2] ?? m[3]);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\brel\s*=\s*["']?(?:modulepreload|preload)\b/i.test(tag)) continue;
    const href = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(tag);
    const valor = href?.[1] ?? href?.[2] ?? href?.[3];
    if (valor && /\.m?js(?:[?#]|$)/i.test(valor)) somar(valor);
  }
  return [...achados.values()];
}

export type MapaDeclarado = { tipo: "url"; url: string } | { tipo: "embutido" } | null;

/** O comentário sourceMappingURL do fim do script, se houver. */
export function mapaDeclarado(js: string): MapaDeclarado {
  const todos = [...js.matchAll(/[#@]\s*sourceMappingURL\s*=\s*([^\s*'"]+)/g)];
  const ultimo = todos.at(-1)?.[1];
  if (!ultimo) return null;
  if (/^data:/i.test(ultimo)) return { tipo: "embutido" };
  return { tipo: "url", url: ultimo };
}

/**
 * O texto é um mapa de código (source map v3)? Confere pelo começo, sem precisar do arquivo inteiro.
 * `comFonte`: o mapa leva o código original inteiro (sourcesContent).
 */
export function pareceMapa(texto: string): { mapa: boolean; comFonte: boolean } {
  const inicio = texto.replace(/^\)\]\}'[^\n]*\n/, "").trimStart();
  const mapa = inicio.startsWith("{") && /"version"\s*:\s*3\b/.test(texto) && /"(?:sources|sections)"\s*:/.test(texto);
  return { mapa, comFonte: mapa && /"sourcesContent"\s*:\s*\[\s*"/.test(texto) };
}

const PARECE_HTML = /^\s*(?:<!doctype|<html|<head|<body|<\?xml|<!--)/i;

function envDeVerdade(t: string): boolean {
  return !PARECE_HTML.test(t) && /^[ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=[ \t]*\S/m.test(t) && !/<\/?[a-z][^>]*>/i.test(t.slice(0, 2000));
}

function comeca(bytes: Buffer, magica: number[]): boolean {
  return magica.every((b, i) => bytes[i] === b);
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const GZIP = [0x1f, 0x8b];
const SQL = (t: string) => !PARECE_HTML.test(t) && /\b(?:CREATE TABLE|INSERT INTO|DROP TABLE)\b/i.test(t);

export type Sensivel = { caminho: string; confere: (texto: string, bytes: Buffer) => boolean };

/**
 * Arquivos que nunca deviam estar no ar, cada um com o que prova que ele está mesmo lá. Site que
 * devolve 200 com a página inicial para qualquer caminho (página única) não vira falso positivo.
 */
export const SENSIVEIS: Sensivel[] = [
  ...[".env", ".env.local", ".env.production", ".env.backup", ".env.bak", ".env.old"].map((nome) => ({
    caminho: `/${nome}`,
    confere: envDeVerdade,
  })),
  { caminho: "/.git/HEAD", confere: (t) => /^ref: refs\/|^[0-9a-f]{40}\s*$/.test(t) },
  { caminho: "/.git/config", confere: (t) => /^\s*\[core\]/m.test(t) },
  { caminho: "/.svn/entries", confere: (t) => /^\d+\s*$/m.test(t.split("\n", 1)[0] ?? "") && !PARECE_HTML.test(t) },
  { caminho: "/.DS_Store", confere: (_t, b) => comeca(b, [0, 0, 0, 1, 0x42, 0x75, 0x64, 0x31]) },
  { caminho: "/.npmrc", confere: (t) => !PARECE_HTML.test(t) && /_authToken|_auth\s*=|registry\s*=/.test(t) },
  { caminho: "/.htpasswd", confere: (t) => !PARECE_HTML.test(t) && /^[^:\s<]+:\$?[\w./$]{8,}/m.test(t) },
  ...["wp-config.php.bak", "wp-config.php.old", "wp-config.php.save", "wp-config.php~", "wp-config.php.orig"].map((nome) => ({
    caminho: `/${nome}`,
    confere: (t: string) => /DB_PASSWORD|DB_NAME/.test(t),
  })),
  ...["backup.zip", "site.zip", "www.zip", "public_html.zip"].map((nome) => ({
    caminho: `/${nome}`,
    confere: (_t: string, b: Buffer) => comeca(b, ZIP),
  })),
  ...["backup.tar.gz", "site.tar.gz"].map((nome) => ({ caminho: `/${nome}`, confere: (_t: string, b: Buffer) => comeca(b, GZIP) })),
  ...["backup.sql", "dump.sql", "database.sql", "db.sql"].map((nome) => ({ caminho: `/${nome}`, confere: SQL })),
  { caminho: "/phpinfo.php", confere: (t) => /<title>phpinfo\(\)<\/title>|PHP Version \d/.test(t) },
];

const ROTA = /["'`](\/(?:api|rest|graphql|wp-json|v1|v2)(?:\/[^"'`\s?#<>]*)?)["'`]/g;
/** Nome que sugere ação: GET nele poderia mudar alguma coisa num site mal feito. O exame pula. */
const DESTRUTIVA = /(?:delete|remove|logout|log-out|signout|sign-out|sair|cancel|destroy|reset|apagar|excluir|unsubscribe|purge|drop|revoke)/i;

/** Rotas de API citadas no JavaScript, sem parâmetro de molde e sem nome de ação destrutiva. */
export function rotasDeApi(js: string): string[] {
  const rotas = new Set<string>();
  for (const m of js.matchAll(ROTA)) {
    const rota = m[1]!;
    if (/[${}:*\\]/.test(rota) || DESTRUTIVA.test(rota) || rota.length > 120) continue;
    rotas.add(rota);
    if (rotas.size >= MAX_ROTAS_API) break;
  }
  return [...rotas];
}

/** A API respondeu com dado (JSON que não é vazio nem erro) para quem não fez login? */
export function respostaAberta(status: number, tipo: string, corpo: string): boolean {
  if (status !== 200 || !/json/i.test(tipo)) return false;
  let valor: unknown;
  try {
    valor = JSON.parse(corpo);
  } catch {
    return false;
  }
  if (valor === null || typeof valor !== "object") return false;
  if (Array.isArray(valor)) return valor.length > 0;
  const chaves = Object.keys(valor);
  if (chaves.length === 0) return false;
  return !chaves.some((k) => /^(?:error|erro|errors|message)$/i.test(k)) || chaves.length > 3;
}

export type Chave = { tipo: string; grave: boolean; trecho: string; linha: number };

const CHAVES: Array<{ tipo: string; grave: boolean; padrao: RegExp }> = [
  { tipo: "chave da AWS", grave: true, padrao: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { tipo: "chave secreta do Stripe", grave: true, padrao: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/g },
  { tipo: "token do GitHub", grave: true, padrao: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { tipo: "token do Slack", grave: true, padrao: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { tipo: "chave da Anthropic", grave: true, padrao: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { tipo: "chave da OpenAI", grave: true, padrao: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}\b|\bsk-proj-[A-Za-z0-9_-]{40,}/g },
  { tipo: "chave do SendGrid", grave: true, padrao: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { tipo: "chave privada", grave: true, padrao: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { tipo: "chave do Google (confira se está restrita ao seu domínio)", grave: false, padrao: /\bAIza[0-9A-Za-z_-]{35}\b/g },
];

const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function papelDoJwt(jwt: string): string | null {
  try {
    const carga = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as { role?: unknown };
    return typeof carga.role === "string" ? carga.role : null;
  } catch {
    return null;
  }
}

/** Mostra só o começo: o relatório não pode virar o lugar onde a chave vaza de novo. */
export function mascarar(valor: string): string {
  return `${valor.slice(0, Math.min(8, Math.floor(valor.length / 3)))}••••`;
}

function linhaDe(texto: string, indice: number): number {
  let linha = 1;
  for (let i = texto.indexOf("\n"); i !== -1 && i < indice; i = texto.indexOf("\n", i + 1)) linha++;
  return linha;
}

/** Chaves secretas que parecem ter ido parar no código entregue ao navegador. */
export function chavesAparentes(texto: string): Chave[] {
  const achadas: Chave[] = [];
  const vistas = new Set<string>();
  const somar = (tipo: string, grave: boolean, valor: string, indice: number) => {
    if (vistas.has(valor)) return;
    vistas.add(valor);
    achadas.push({ tipo, grave, trecho: mascarar(valor), linha: linhaDe(texto, indice) });
  };
  for (const { tipo, grave, padrao } of CHAVES) {
    for (const m of texto.matchAll(padrao)) somar(tipo, grave, m[0], m.index);
  }
  for (const m of texto.matchAll(JWT)) {
    if (papelDoJwt(m[0]) === "service_role") somar("chave service_role do Supabase", true, m[0], m.index);
  }
  return achadas;
}
