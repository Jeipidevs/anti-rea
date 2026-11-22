import type { Evento, Registro } from "../registro/registro.js";

// Painel do registro: uma página HTML sem script, montada no servidor. Tudo que vem do registro passa
// por escape (agente, caminho e motivo podem ter sido escritos por quem foi pego).

export type Destino = Evento["destino"];
export type FiltroPainel = { dia: string; ip?: string; motivo?: string; destino?: Destino };
export type DadosPainel = {
  /** Dias com registro, do mais novo para o mais velho, com o total gravado. */
  dias: Array<{ dia: string; total: number }>;
  /** Eventos do dia do filtro (o filtro de ip, motivo e destino é aplicado aqui no painel). */
  eventos: Evento[];
  filtro: FiltroPainel;
  agora: Date;
  /** true na rota do porteiro (filtros viram links); false no arquivo gravado pelo comando. */
  links: boolean;
};

/** Quantos dias aparecem nas barras. */
export const DIAS_NO_PAINEL = 14;
/** Quantos eventos aparecem na tabela. */
export const EVENTOS_NA_TABELA = 300;
const TOPO = 10;
const DESTINOS: Destino[] = ["sombra", "recusado", "registrado"];
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const IP = /^[0-9A-Fa-f:.]{2,45}$/;

function diaValido(dia: string): boolean {
  if (!DIA.test(dia)) return false;
  const ms = Date.parse(`${dia}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === dia;
}

/** Filtro tirado da query da rota; o que não vale é ignorado. Sem dia, o dia de hoje em UTC. */
export function filtroDaQuery(query: string | null, agora: Date): FiltroPainel {
  const q = new URLSearchParams(query ?? "");
  const dia = q.get("dia") ?? "";
  const filtro: FiltroPainel = { dia: diaValido(dia) ? dia : agora.toISOString().slice(0, 10) };
  const ip = q.get("ip");
  if (ip && IP.test(ip)) filtro.ip = ip;
  const motivo = q.get("motivo");
  if (motivo && motivo.length <= 100 && !/[\u0000-\u001f]/.test(motivo)) filtro.motivo = motivo;
  const destino = q.get("destino");
  if (destino && (DESTINOS as string[]).includes(destino)) filtro.destino = destino as Destino;
  return filtro;
}

/** Lê do registro o que o painel mostra: os dias e os eventos do dia do filtro. */
export function dadosDoRegistro(registro: Registro, filtro: FiltroPainel, agora: Date, links: boolean): DadosPainel {
  const dias = registro
    .dias()
    .slice(0, DIAS_NO_PAINEL)
    .map((dia) => ({ dia, total: registro.gravados(dia) }));
  return { dias, eventos: registro.ler(filtro.dia), filtro, agora, links };
}

function esc(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : valor === undefined || valor === null ? "" : String(valor);
}

function cortar(valor: string, max: number): string {
  return valor.length > max ? `${valor.slice(0, max - 1)}…` : valor;
}

function link(filtro: FiltroPainel): string {
  const q = new URLSearchParams({ dia: filtro.dia });
  if (filtro.ip) q.set("ip", filtro.ip);
  if (filtro.motivo) q.set("motivo", filtro.motivo);
  if (filtro.destino) q.set("destino", filtro.destino);
  return `?${q.toString()}`;
}

function passaNoFiltro(e: Evento, f: FiltroPainel): boolean {
  return (!f.ip || texto(e.ip) === f.ip) && (!f.motivo || texto(e.motivo) === f.motivo) && (!f.destino || e.destino === f.destino);
}

function contar(eventos: Evento[], campo: keyof Evento): Array<[string, number]> {
  const mapa = new Map<string, number>();
  for (const e of eventos) {
    const chave = texto(e[campo]);
    mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
  }
  return [...mapa].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOPO);
}

const NOME_DESTINO: Record<Destino, string> = { sombra: "na sombra", recusado: "recusados", registrado: "só registrados" };

function cartoes(eventos: Evento[]): string {
  const total = `<div class="cartao"><b>${eventos.length}</b> <span>eventos</span></div>`;
  const porDestino = DESTINOS.map((d) => {
    const n = eventos.filter((e) => e.destino === d).length;
    return `<div class="cartao ${d}"><b>${n}</b> <span>${NOME_DESTINO[d]}</span></div>`;
  });
  return `<section class="cartoes">${total}${porDestino.join("")}</section>`;
}

function barras(d: DadosPainel): string {
  if (d.dias.length === 0) return "";
  const maior = Math.max(1, ...d.dias.map((x) => x.total));
  const itens = [...d.dias]
    .reverse()
    .map(({ dia, total }) => {
      const altura = Math.max(2, Math.round((total / maior) * 100));
      const rotulo = `${esc(dia.slice(8, 10))}/${esc(dia.slice(5, 7))}`;
      const corpo = `<span class="barra" style="height:${altura}%"></span><small>${rotulo}</small><small>${total}</small>`;
      const classe = dia === d.filtro.dia ? "dia atual" : "dia";
      return d.links
        ? `<a class="${classe}" href="${esc(link({ dia }))}" title="${esc(dia)}: ${total} eventos">${corpo}</a>`
        : `<span class="${classe}" title="${esc(dia)}: ${total} eventos">${corpo}</span>`;
    });
  return `<section><h2>Últimos dias</h2><div class="barras">${itens.join("")}</div></section>`;
}

function topo(titulo: string, linhas: Array<[string, number]>, filtrar?: (valor: string) => FiltroPainel): string {
  if (linhas.length === 0) return "";
  const itens = linhas.map(([valor, n]) => {
    const nome = esc(cortar(valor || "(vazio)", 80));
    const celula = filtrar ? `<a href="${esc(link(filtrar(valor)))}">${nome}</a>` : nome;
    return `<li><span>${celula}</span><b>${n}</b></li>`;
  });
  return `<div class="topo"><h3>${titulo}</h3><ol>${itens.join("")}</ol></div>`;
}

function hora(quando: unknown): string {
  const ms = Date.parse(texto(quando));
  return Number.isNaN(ms) ? "?" : new Date(ms).toISOString().slice(11, 19);
}

function tabela(eventos: Evento[]): string {
  if (eventos.length === 0) return `<p class="vazio">Nenhum evento neste dia.</p>`;
  const ultimos = [...eventos]
    .sort((a, b) => texto(b.quando).localeCompare(texto(a.quando)))
    .slice(0, EVENTOS_NA_TABELA);
  const linhas = ultimos.map(
    (e) =>
      `<tr class="${esc(e.destino)}"><td>${hora(e.quando)}</td><td>${esc(e.ip)}</td><td>${esc(cortar(texto(e.dominio), 60))}</td>` +
      `<td class="cam">${esc(cortar(texto(e.caminho), 120))}</td><td>${esc(e.motivo)}</td><td>${esc(e.destino)}</td>` +
      `<td class="ag">${esc(cortar(texto(e.agente), 120))}</td></tr>`,
  );
  const nota =
    eventos.length > EVENTOS_NA_TABELA ? `<p class="nota">Mostrando os ${EVENTOS_NA_TABELA} mais recentes de ${eventos.length}.</p>` : "";
  return (
    `${nota}<div class="rolagem"><table><thead><tr><th>Hora (UTC)</th><th>IP</th><th>Domínio</th><th>Caminho</th>` +
    `<th>Motivo</th><th>Destino</th><th>Agente</th></tr></thead><tbody>${linhas.join("")}</tbody></table></div>`
  );
}

function faixaDoFiltro(d: DadosPainel): string {
  const f = d.filtro;
  const partes = [f.ip && `IP ${esc(f.ip)}`, f.motivo && `motivo "${esc(f.motivo)}"`, f.destino && esc(NOME_DESTINO[f.destino])].filter(Boolean);
  if (partes.length === 0) return "";
  const limpar = d.links ? ` · <a href="${esc(link({ dia: f.dia }))}">limpar</a>` : "";
  return `<p class="filtro">Filtro: ${partes.join(" · ")}${limpar}</p>`;
}

const ESTILO = `
*{box-sizing:border-box}
body{margin:0;padding:24px 16px 48px;background:#0B0C14;color:#EEF0FF;font:15px/1.5 Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:1100px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px;color:#C9CCF0}h3{font-size:14px;margin:0 0 8px;color:#8A90B2;font-weight:600}
.sub{color:#8A90B2;margin:0 0 16px}
a{color:#A99FFF}
.cartoes{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.cartao{background:#141626;border:1px solid #262A40;border-radius:12px;padding:14px 16px}
.cartao b{display:block;font-size:26px}.cartao span{color:#8A90B2}
.cartao.sombra b{color:#B4AAFF}.cartao.recusado b{color:#FF8DA2}.cartao.registrado b{color:#FFC24B}
.barras{display:flex;gap:6px;align-items:flex-end;height:150px;background:#141626;border:1px solid #262A40;border-radius:12px;padding:12px}
.dia{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;text-decoration:none;color:#8A90B2}
.dia small{font-size:11px;line-height:1.3}
.barra{width:100%;max-width:36px;background:#3A3570;border-radius:4px 4px 0 0}
.dia.atual .barra{background:#7C6CFF}.dia.atual small{color:#EEF0FF}
.topos{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.topo{background:#141626;border:1px solid #262A40;border-radius:12px;padding:14px 16px}
.topo ol{list-style:none;margin:0;padding:0}
.topo li{display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-top:1px solid #1E2135}
.topo li:first-child{border-top:0}
.topo li span{overflow-wrap:anywhere}
.filtro{background:#1B1836;border:1px solid #3A3570;border-radius:8px;padding:8px 12px}
.rolagem{overflow-x:auto;border:1px solid #262A40;border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:6px 10px;border-top:1px solid #1E2135;vertical-align:top}
th{background:#141626;color:#8A90B2;font-weight:600;border-top:0;white-space:nowrap}
td.cam,td.ag{overflow-wrap:anywhere;min-width:160px}
tr.sombra td:nth-child(6){color:#B4AAFF}tr.recusado td:nth-child(6){color:#FF8DA2}tr.registrado td:nth-child(6){color:#FFC24B}
.vazio,.nota{color:#8A90B2}
footer{margin-top:32px;color:#5C6285;font-size:13px}
`;

/** A página do painel, inteira. Sem script: os filtros são links com a query. */
export function montarPainel(d: DadosPainel): string {
  const doDia = d.eventos.filter((e) => passaNoFiltro(e, d.filtro));
  const porIp = d.links ? (ip: string) => ({ ...d.filtro, ip }) : undefined;
  const porMotivo = d.links ? (motivo: string) => ({ ...d.filtro, motivo }) : undefined;
  const topos = [
    topo("IPs", contar(doDia, "ip"), porIp),
    topo("Motivos", contar(doDia, "motivo"), porMotivo),
    topo("Caminhos", contar(doDia, "caminho")),
    topo("Domínios", contar(doDia, "dominio")),
  ].join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Painel do ANTI-REA</title>
<style>${ESTILO}</style>
</head>
<body>
<main>
<h1>Painel do ANTI-REA</h1>
<p class="sub">Dia ${esc(d.filtro.dia)} (UTC) · gerado em ${esc(d.agora.toISOString().slice(0, 16).replace("T", " "))} UTC</p>
${faixaDoFiltro(d)}
${cartoes(doDia)}
${barras(d)}
${topos ? `<h2>Quem mais aparece</h2><section class="topos">${topos}</section>` : ""}
<h2>Eventos</h2>
${tabela(doDia)}
<footer>IP é dado pessoal (LGPD e GDPR): este painel é só do dono do site.</footer>
</main>
</body>
</html>
`;
}
