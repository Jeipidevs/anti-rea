import type { Achado, ItemExame, Nivel, Relatorio } from "./exame.js";

// O relatório do exame: o resumo do terminal e a página HTML com o que fazer em cada item.

const MARCA: Record<Nivel, string> = { grave: "✖", atencao: "!", ok: "✔" };
const NOME_NIVEL: Record<Nivel, string> = { grave: "grave", atencao: "atenção", ok: "ok" };
/** Linhas por item no terminal; o resto fica no HTML. */
const LINHAS_POR_ITEM = 5;

export const EXPLICACAO: Record<ItemExame, { nome: string; porque: string; fazer: string }> = {
  mapas: {
    nome: "Mapas de código",
    porque:
      "O mapa de código (.map) reconstrói o seu código original, com nomes, pastas e às vezes os comentários. É o primeiro arquivo que uma ferramenta de engenharia reversa procura.",
    fazer:
      "Desligue o mapa na compilação de produção (no Next.js, productionBrowserSourceMaps: false; no Vite, build.sourcemap: false) ou não publique os arquivos .map. Com o ANTI-REA na frente, eles já ficam trancados para todo mundo.",
  },
  sensiveis: {
    nome: "Arquivos sensíveis",
    porque:
      "Arquivos como .env, .git e backups guardam senhas, chaves e o histórico inteiro do código. Robôs procuram por eles em todo site, o tempo todo.",
    fazer:
      "Apague o arquivo do servidor agora e troque toda senha e chave que estava nele: considere que já foi lida. Depois confira por que ele foi publicado (pasta errada no deploy, backup na pasta pública).",
  },
  api: {
    nome: "API sem login",
    porque:
      "Estas rotas aparecem no JavaScript do site e responderam com dado para quem não fez login. Se o dado não for público, qualquer um lê direto, sem passar pela tela.",
    fazer:
      "Confira cada rota: se o dado é público (lista de produtos, horários), está tudo bem. Se não é, exija login no servidor, não só na tela. O exame só fez GET e pulou rotas com nome de ação (apagar, sair, cancelar).",
  },
  chaves: {
    nome: "Chaves no código",
    porque:
      "Tudo que vai para o navegador pode ser lido por qualquer um. Chave secreta no código entregue à tela é chave pública.",
    fazer:
      "Troque a chave no serviço de origem agora (a antiga já vazou) e passe a usá-la só no servidor. Chave do Google para mapas e afins pode ficar no navegador, desde que restrita ao seu domínio no painel do Google.",
  },
  porteiro: {
    nome: "Porteiro",
    porque:
      "Sem o porteiro, ferramentas de engenharia reversa e robôs copiadores chegam direto ao site e ninguém fica sabendo.",
    fazer: "Instale o ANTI-REA na frente do site: npx @jeipidevs/anti-rea init.",
  },
};

function contagem(r: Relatorio): Record<Nivel, number> {
  const c: Record<Nivel, number> = { grave: 0, atencao: 0, ok: 0 };
  for (const a of r.achados) c[a.nivel]++;
  return c;
}

function linhaDoTotal(r: Relatorio): string {
  const c = contagem(r);
  return `${c.grave} ${c.grave === 1 ? "grave" : "graves"}  ·  ${c.atencao} atenção  ·  ${c.ok} ok`;
}

/** As linhas do terminal, no formato da tela do README. */
export function resumoTerminal(r: Relatorio, arquivo: string): string[] {
  const linhas = ["Dono confirmado pelo arquivo /.well-known/anti-rea.txt"];
  if (r.comoDono) linhas.push("Examinado por trás do porteiro, com o passe de dono (nada disso virou aviso)");
  linhas.push("", "O que um curioso consegue ver do seu site");
  const porItem = new Map<string, number>();
  for (const a of r.achados) {
    const chave = `${a.nivel}:${a.item}`;
    const n = (porItem.get(chave) ?? 0) + 1;
    porItem.set(chave, n);
    if (n <= LINHAS_POR_ITEM) linhas.push(`${MARCA[a.nivel]} ${a.titulo}${a.onde ? `  ${a.onde}` : ""}`);
    else if (n === LINHAS_POR_ITEM + 1) linhas.push(`  e mais no relatório`);
  }
  if (r.parouNaPorta) {
    linhas.push(
      "",
      "O exame parou na porta, como qualquer ferramenta: sem o passe de dono, o porteiro não entrega os",
      "scripts e tranca os arquivos. Para examinar o site por trás dele, rode de novo com o seu link de dono:",
      `anti-rea exame ${r.url} --dono <link de anti-rea dono>`,
    );
  }
  if (r.semTeto > 0) linhas.push("", `${r.semTeto} pedidos ficaram de fora pelo teto de pedidos do exame.`);
  linhas.push("", linhaDoTotal(r), "", "Relatório completo com o que fazer em cada item:", arquivo);
  return linhas;
}

function esc(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ORDEM_ITEM: ItemExame[] = ["mapas", "sensiveis", "api", "chaves", "porteiro"];
const PESO: Record<Nivel, number> = { grave: 0, atencao: 1, ok: 2 };

function secao(item: ItemExame, achados: Achado[]): string {
  const pior = achados.reduce<Nivel>((n, a) => (PESO[a.nivel] < PESO[n] ? a.nivel : n), "ok");
  const e = EXPLICACAO[item];
  const lista = achados
    .map((a) => `<li class="${a.nivel}"><span class="marca">${MARCA[a.nivel]}</span> ${esc(a.titulo)}${a.onde ? ` <code>${esc(a.onde)}</code>` : ""}</li>`)
    .join("");
  const conselho =
    pior === "ok"
      ? ""
      : `<p><b>Por que importa.</b> ${esc(e.porque)}</p><p><b>O que fazer.</b> ${esc(e.fazer)}</p>`;
  return `<section class="item ${pior}"><h2><span class="selo">${NOME_NIVEL[pior]}</span> ${esc(e.nome)}</h2><ul>${lista}</ul>${conselho}</section>`;
}

const ESTILO = `
*{box-sizing:border-box}
body{margin:0;padding:24px 16px 48px;background:#0B0C14;color:#EEF0FF;font:16px/1.55 Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:820px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}.sub{color:#8A90B2;margin:0 0 20px}
.total{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 20px}
.total span{background:#141626;border:1px solid #262A40;border-radius:999px;padding:4px 14px}
.total .grave{color:#FF8DA2}.total .atencao{color:#FFC24B}.total .ok{color:#3BE8A8}
.item{background:#141626;border:1px solid #262A40;border-left:4px solid #3BE8A8;border-radius:12px;padding:14px 18px;margin:0 0 14px}
.item.grave{border-left-color:#FF5C7A}.item.atencao{border-left-color:#FFC24B}
h2{font-size:17px;margin:0 0 8px;display:flex;gap:10px;align-items:center}
.selo{font-size:12px;text-transform:uppercase;letter-spacing:.04em;border-radius:6px;padding:2px 8px;background:#1E2135;color:#8A90B2}
.grave .selo{background:#3A1520;color:#FF8DA2}.atencao .selo{background:#3A2E10;color:#FFC24B}.ok .selo{background:#0F3328;color:#3BE8A8}
ul{list-style:none;margin:0 0 8px;padding:0}li{padding:3px 0;overflow-wrap:anywhere}
li.grave .marca{color:#FF5C7A}li.atencao .marca{color:#FFC24B}li.ok .marca{color:#3BE8A8}
code{background:#0B0C14;border:1px solid #262A40;border-radius:6px;padding:1px 6px;font-size:14px}
p{margin:8px 0;color:#C9CCF0}
.porta{background:#1B1836;border:1px solid #3A3570;border-radius:12px;padding:12px 16px}
footer{margin-top:28px;color:#5C6285;font-size:13px}
`;

/** A página do relatório, inteira e sem script. */
export function relatorioHtml(r: Relatorio): string {
  const c = contagem(r);
  const secoes = ORDEM_ITEM.map((item) => ({ item, achados: r.achados.filter((a) => a.item === item) }))
    .filter((s) => s.achados.length > 0)
    .sort((a, b) => {
      const pior = (x: Achado[]) => Math.min(...x.map((y) => PESO[y.nivel]));
      return pior(a.achados) - pior(b.achados);
    })
    .map((s) => secao(s.item, s.achados))
    .join("\n");
  const porta = r.parouNaPorta
    ? `<p class="porta">O exame parou na porta, como qualquer ferramenta: sem o passe de dono, o porteiro não entrega os scripts e tranca os arquivos. Para examinar o site por trás dele, rode <code>anti-rea exame ${esc(r.url)} --dono &lt;seu link de dono&gt;</code> (o link sai em <code>anti-rea dono</code>).</p>`
    : "";
  const modo = r.comoDono ? " · por trás do porteiro, com o passe de dono" : "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Exame de ${esc(r.host)}</title>
<style>${ESTILO}</style>
</head>
<body>
<main>
<h1>O que um curioso consegue ver de ${esc(r.host)}</h1>
<p class="sub">Exame do ANTI-REA em ${esc(r.quando.slice(0, 16).replace("T", " "))} UTC${modo} · ${r.pedidos} pedidos, só leitura · ${r.scripts === 1 ? "1 script lido" : `${r.scripts} scripts lidos`}</p>
<p class="total"><span class="grave">${c.grave} ${c.grave === 1 ? "grave" : "graves"}</span><span class="atencao">${c.atencao} atenção</span><span class="ok">${c.ok} ok</span></p>
${porta}
${secoes}
<footer>O exame só faz pedidos de leitura (GET, HEAD e OPTIONS), só no site que provou ser seu. Ele não encontra tudo: um item ok quer dizer que o exame não achou, não que não existe.</footer>
</main>
</body>
</html>
`;
}
