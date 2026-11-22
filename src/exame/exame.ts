import { ClienteExame, type RespostaExame } from "./cliente.js";
import {
  chavesAparentes,
  mapaDeclarado,
  pareceMapa,
  respostaAberta,
  rotasDeApi,
  scriptsDaPagina,
  SENSIVEIS,
} from "./detectores.js";
import { conferirProva, type ResultadoProva } from "./prova.js";

// O exame: faz o que um curioso faria com uma ferramenta de engenharia reversa, só que para o dono ver
// primeiro. Só leitura, só no host provado.

export type Nivel = "grave" | "atencao" | "ok";
export type ItemExame = "porteiro" | "mapas" | "sensiveis" | "api" | "chaves";
export type Achado = { item: ItemExame; nivel: Nivel; titulo: string; onde?: string };

export type Relatorio = {
  url: string;
  host: string;
  quando: string;
  porteiro: boolean;
  comoDono: boolean;
  /** Porteiro na frente e sem link de dono: o exame parou na porta, como qualquer ferramenta. */
  parouNaPorta: boolean;
  /** Pedidos que não saíram porque o teto acabou. */
  semTeto: number;
  pedidos: number;
  scripts: number;
  achados: Achado[];
};

export class ErroDeProva extends Error {
  constructor(readonly resultado: Exclude<ResultadoProva, "ok">) {
    super(`prova de dono: ${resultado}`);
  }
}

export type OpcoesExame = {
  url: URL;
  codigo: string;
  /** Link de dono do porteiro: com ele o exame examina o site por trás do porteiro. */
  dono?: string;
  agente: string;
  agora?: Date;
  buscar?: typeof fetch;
};

const HTML = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
const COOKIE_PASSE = "anti_rea_passe";

async function emParalelo<T, R>(itens: T[], fazer: (item: T) => Promise<R>): Promise<R[]> {
  return Promise.all(itens.map(fazer));
}

/** O porteiro do ANTI-REA responde o script da guarda em /.anti-rea/guarda.js. */
async function temPorteiro(c: ClienteExame): Promise<boolean> {
  const r = await c.pedir("/.anti-rea/guarda.js", { seguir: false, maxBytes: 64 * 1024 });
  return r !== null && r.status === 200 && /javascript/i.test(r.tipo);
}

/** Entra pelo link de dono e guarda o passe. Erro claro quando o link não é deste site ou não deu passe. */
async function entrarComoDono(c: ClienteExame, link: string): Promise<void> {
  const url = c.resolver(link);
  if (!url || !url.pathname.startsWith("/.anti-rea/dono/")) {
    throw new Error(`O link de dono precisa ser deste site (${c.origem}/.anti-rea/dono/...). Rode anti-rea dono para ver o seu.`);
  }
  const r = await c.pedir(url, { seguir: false, maxBytes: 0 });
  const passe = r?.cabecalhos
    .getSetCookie()
    .map((linha) => linha.split(";", 1)[0]!)
    .find((par) => par.startsWith(`${COOKIE_PASSE}=`));
  if (!passe) throw new Error("O link de dono não deu o passe: confira se é o link atual (anti-rea dono).");
  c.usarCookie(passe);
}

function caminhoDe(url: URL): string {
  return url.pathname + url.search;
}

type Script = { url: URL; texto: string };

async function examinarMapas(c: ClienteExame, scripts: Script[]): Promise<Achado[]> {
  const achados: Achado[] = [];
  await emParalelo(scripts, async (s) => {
    const declarado = mapaDeclarado(s.texto);
    if (declarado?.tipo === "embutido") {
      achados.push({ item: "mapas", nivel: "grave", titulo: "Mapa de código embutido no script", onde: caminhoDe(s.url) });
      return;
    }
    const alvo = declarado ? c.resolver(new URL(declarado.url, s.url)) : c.resolver(new URL(`${s.url.pathname}.map`, s.url));
    if (!alvo) return;
    const r = await c.pedir(alvo, { accept: "application/json" });
    if (!r || r.status !== 200) return;
    const { mapa, comFonte } = pareceMapa(r.texto);
    if (!mapa) return;
    achados.push({
      item: "mapas",
      nivel: "grave",
      titulo: comFonte ? "Mapa de código público, com o código original inteiro" : "Mapa de código público",
      onde: caminhoDe(r.url),
    });
  });
  return achados;
}

async function examinarSensiveis(c: ClienteExame): Promise<Achado[]> {
  const achados: Achado[] = [];
  await emParalelo(SENSIVEIS, async (s) => {
    const r: RespostaExame | null = await c.pedir(s.caminho, { maxBytes: 64 * 1024, seguir: false });
    if (r && r.status === 200 && r.bytes.length > 0 && s.confere(r.texto, r.bytes)) {
      achados.push({ item: "sensiveis", nivel: "grave", titulo: "Arquivo sensível no ar", onde: s.caminho });
    }
  });
  return achados;
}

async function examinarApis(c: ClienteExame, rotas: string[]): Promise<Achado[]> {
  const achados: Achado[] = [];
  await emParalelo(rotas, async (rota) => {
    const r = await c.pedir(rota, { accept: "application/json", seguir: false, maxBytes: 256 * 1024 });
    if (r && respostaAberta(r.status, r.tipo, r.texto)) {
      achados.push({ item: "api", nivel: "atencao", titulo: "API responde sem login", onde: `GET ${rota}` });
    }
  });
  return achados;
}

function examinarChaves(fontes: Array<{ nome: string; texto: string }>): Achado[] {
  return fontes.flatMap(({ nome, texto }) =>
    chavesAparentes(texto).map((k) => ({
      item: "chaves" as const,
      nivel: k.grave ? ("grave" as const) : ("atencao" as const),
      titulo: `Chave aparente no código (${k.tipo})`,
      onde: `${nome} linha ${k.linha}: ${k.trecho}`,
    })),
  );
}

const ORDEM: Record<Nivel, number> = { grave: 0, atencao: 1, ok: 2 };
const ORDEM_ITEM: ItemExame[] = ["mapas", "sensiveis", "api", "chaves", "porteiro"];

function ordenar(achados: Achado[]): Achado[] {
  return [...achados].sort(
    (a, b) =>
      ORDEM[a.nivel] - ORDEM[b.nivel] ||
      ORDEM_ITEM.indexOf(a.item) - ORDEM_ITEM.indexOf(b.item) ||
      (a.onde ?? "").localeCompare(b.onde ?? ""),
  );
}

const OK: Record<Exclude<ItemExame, "porteiro">, string> = {
  mapas: "Nenhum mapa de código público",
  sensiveis: "Nenhum arquivo sensível no ar",
  api: "Nenhuma API aberta entre as citadas no JavaScript",
  chaves: "Nenhuma chave aparente no código",
};

/**
 * Roda o exame. Lança ErroDeProva quando o site não prova ser do dono (antes de qualquer outro pedido)
 * e Error com mensagem em português quando o link de dono não serve.
 */
export async function examinar(op: OpcoesExame): Promise<Relatorio> {
  const c = new ClienteExame(op.url, { agente: op.agente, buscar: op.buscar });
  const prova = await conferirProva(c, op.codigo);
  if (prova !== "ok") throw new ErroDeProva(prova);

  const porteiro = await temPorteiro(c);
  if (op.dono) await entrarComoDono(c, op.dono);
  const comoDono = op.dono !== undefined;
  const base = {
    url: op.url.href,
    host: op.url.host,
    quando: (op.agora ?? new Date()).toISOString(),
    porteiro,
    comoDono,
  };
  const achadoPorteiro: Achado = porteiro
    ? { item: "porteiro", nivel: "ok", titulo: "Porteiro ANTI-REA ativo" }
    : { item: "porteiro", nivel: "atencao", titulo: "Sem porteiro na frente do site" };

  // Sem o passe de dono, o porteiro recusaria os scripts e trancaria os arquivos, e cada tentativa
  // viraria aviso no celular do dono. O exame para na porta, como qualquer ferramenta.
  if (porteiro && !comoDono) {
    return { ...base, parouNaPorta: true, semTeto: c.recusados, pedidos: c.pedidos, scripts: 0, achados: [achadoPorteiro] };
  }

  const pagina = await c.pedir(op.url, { accept: HTML });
  const html = pagina && /html/i.test(pagina.tipo) ? pagina.texto : "";
  const urlsDosScripts = pagina ? scriptsDaPagina(html, pagina.url) : [];
  const scripts = (
    await emParalelo(urlsDosScripts, async (url) => {
      const r = await c.pedir(url, { accept: "*/*" });
      return r && r.status === 200 && !/html/i.test(r.tipo) ? { url: r.url, texto: r.texto } : null;
    })
  ).filter((s): s is Script => s !== null);

  const rotas = [...new Set(scripts.flatMap((s) => rotasDeApi(s.texto)).concat(rotasDeApi(html)))].slice(0, 20);
  const [mapas, sensiveis, apis] = await Promise.all([examinarMapas(c, scripts), examinarSensiveis(c), examinarApis(c, rotas)]);
  const chaves = examinarChaves([
    ...(html ? [{ nome: caminhoDe(pagina!.url), texto: html }] : []),
    ...scripts.map((s) => ({ nome: caminhoDe(s.url), texto: s.texto })),
  ]);

  const achados: Achado[] = [...mapas, ...sensiveis, ...apis, ...chaves, achadoPorteiro];
  for (const item of Object.keys(OK) as Array<keyof typeof OK>) {
    if (!achados.some((a) => a.item === item)) achados.push({ item, nivel: "ok", titulo: OK[item] });
  }
  return { ...base, parouNaPorta: false, semTeto: c.recusados, pedidos: c.pedidos, scripts: scripts.length, achados: ordenar(achados) };
}
