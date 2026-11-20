import type { Sinal } from "./ferramentas.js";

// Arquivos trancados (spec 3.5): fecham para todo mundo, até em caminho isento. A documentação
// (README, docs/01 e docs/03) lista exatamente estas listas; um teste confere.

/** Segmento, em qualquer pasta, com este nome exato (já em minúsculas). */
export const SEGMENTOS_TRANCADOS = [
  ".git",
  ".svn",
  ".hg",
  ".ds_store",
  ".env",
  ".envrc",
  ".htpasswd",
  ".htaccess",
  ".npmrc",
  ".git-credentials",
  ".ssh",
  ".aws",
] as const;
/** Segmento, em qualquer pasta, que começa assim (`.env.local`, `wp-config.php.bak`). */
export const COMECOS_TRANCADOS = [".env.", "wp-config.php."] as const;
/** Fim do caminho: cópia do editor e backup. */
export const SUFIXOS_TRANCADOS = [".bak", ".old", ".orig", ".save", "~", ".swp", ".swo", ".sql", ".sql.gz"] as const;
/** Extensões de arquivo compactado. */
export const COMPACTADOS = [".zip", ".tar", ".tar.gz", ".tgz", ".gz", ".7z", ".rar"] as const;
/** Compactado cujo nome começa assim, em qualquer pasta (`backup-2026.zip`, `bkp_site.7z`). */
export const COMECOS_DE_BACKUP = ["backup", "bkp"] as const;
/** Compactado com este nome, só na raiz (`/site.zip`, `/www.tar.gz`). */
export const NOMES_DE_SITE = ["site", "www", "web", "html", "public_html", "htdocs", "wwwroot", "db", "database", "dump"] as const;

const SEGMENTOS = new Set<string>(SEGMENTOS_TRANCADOS);
const PREFIXOS_VARREDURA = [
  "/phpmyadmin",
  "/pma",
  "/server-status",
  "/cgi-bin/",
  "/vendor/phpunit",
  "/actuator",
  "/console",
  "/boaform",
  "/hnap1",
];

function normalizar(caminho: string): string {
  return (caminho.split(/[?#]/)[0] ?? "").toLowerCase();
}

/** Nome do arquivo sem a extensão de compactado, ou null quando ele não é um compactado. */
function nomeDoCompactado(arquivo: string): string | null {
  const ext = COMPACTADOS.filter((e) => arquivo.endsWith(e)).sort((a, b) => b.length - a.length)[0];
  return ext === undefined ? null : arquivo.slice(0, -ext.length);
}

/** Compactado com nome de backup (qualquer pasta) ou com nome de site (só na raiz). */
function backupCompactado(segmentos: string[]): boolean {
  const arquivo = segmentos[segmentos.length - 1] ?? "";
  const nome = nomeDoCompactado(arquivo);
  if (nome === null) return false;
  if (COMECOS_DE_BACKUP.some((c) => nome.startsWith(c))) return true;
  return segmentos.length === 1 && (NOMES_DE_SITE as readonly string[]).includes(nome);
}

/** Segredo: configuração, credencial ou repositório. Navegador nenhum pede isso sozinho. */
export const MOTIVO_SENSIVEL = "arquivo sensível";
/** Cópia de editor, dump ou compactado com nome de backup: pode ser um download do próprio site. */
export const MOTIVO_BACKUP = "arquivo de backup";

export function caminhoTrancado(caminho: string): Sinal | null {
  const p = normalizar(caminho);
  if (p.endsWith(".map")) return { motivo: "mapa de código", gravidade: "copia" };
  const segmentos = p.split("/").slice(1);
  if (segmentos.some((s) => SEGMENTOS.has(s) || COMECOS_TRANCADOS.some((c) => s.startsWith(c)))) {
    return { motivo: MOTIVO_SENSIVEL, gravidade: "varredura" };
  }
  if (SUFIXOS_TRANCADOS.some((s) => p.endsWith(s)) || backupCompactado(segmentos)) {
    return { motivo: MOTIVO_BACKUP, gravidade: "varredura" };
  }
  return null;
}

export function caminhoDeVarredura(caminho: string): Sinal | null {
  const p = normalizar(caminho);
  for (const prefixo of PREFIXOS_VARREDURA) {
    const casa = prefixo.endsWith("/") ? p.startsWith(prefixo) : p === prefixo || p.startsWith(prefixo + "/");
    if (casa) return { motivo: "caminho de varredura", gravidade: "varredura" };
  }
  return null;
}
