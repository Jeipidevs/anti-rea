// Política da guarda (Task 13): intervalo, aba visível, recuo em aparelho lento e sonda de pausa.
// O script gerado roda em node:vm com relógio e agenda falsos; o coletor de verdade é trocado por
// um coletor de teste que registra cada chamada e "gasta" o tempo pedido no relógio falso.
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { COLETOR, COLETOR_SEM_PAUSA } from "../../src/deteccao/navegador/desafio.js";
import { scriptGuarda } from "../../src/deteccao/navegador/guarda.js";

/** Intervalo escolhido pela medição (docs/_medicoes/2026-11-guarda.md). */
const INTERVALO = 1000;
const INTERVALO_MAX = 1500;
const PAUSA = 6000;

type Chamada = { t: number; pausa: boolean; memo: unknown };
type Opcoes = {
  sondarPausa?: boolean;
  /** Tempo gasto por coleta: número fixo ou função da chamada (0, 1, 2...) e de `pausa`. */
  custo?: number | ((n: number, pausa: boolean) => number);
  /** Chamada (0, 1, 2...) em que o coletor devolve cdp. */
  pegarNa?: number;
  visivel?: boolean;
  status?: number;
};

function montarGuarda(o: Opcoes = {}) {
  const sondar = o.sondarPausa !== false;
  const original = scriptGuarda(sondar ? {} : { sondarPausa: false });
  const coletor = sondar ? COLETOR : COLETOR_SEM_PAUSA;
  expect(original).toContain(coletor);
  const script = original.replace(coletor, "function (n, p, m) { return __coletor(n, p, m); }");

  const relogio = { t: 0 };
  let seq = 0;
  const agenda: Array<{ quando: number; id: number; fn: () => void }> = [];
  const cancelados = new Set<number>();
  const ouvintes: Array<() => void> = [];
  const chamadas: Chamada[] = [];
  const avisos: Array<{ url: string; corpo: Record<string, unknown> }> = [];
  const registro = { recargas: 0 };
  const documento = {
    visibilityState: o.visivel === false ? "hidden" : "visible",
    addEventListener: (tipo: string, fn: () => void) => {
      if (tipo === "visibilitychange") ouvintes.push(fn);
    },
  };
  const custoDe = (n: number, pausa: boolean) => (typeof o.custo === "function" ? o.custo(n, pausa) : (o.custo ?? 3));
  const caixa: Record<string, unknown> = {
    performance: { now: () => relogio.t },
    Date: { now: () => relogio.t },
    document: documento,
    setTimeout: (fn: () => void, ms = 0) => {
      agenda.push({ quando: relogio.t + ms, id: ++seq, fn });
      return seq;
    },
    clearTimeout: (id: number) => cancelados.add(id),
    setInterval: (fn: () => void, ms: number) => {
      const id = ++seq;
      const proxima = (quando: number) =>
        agenda.push({ quando, id, fn: () => (proxima(quando + ms), fn()) });
      proxima(relogio.t + ms);
      return id;
    },
    clearInterval: (id: number) => cancelados.add(id),
    requestIdleCallback: (fn: (d: object) => void) => {
      agenda.push({ quando: relogio.t, id: ++seq, fn: () => fn({ didTimeout: false, timeRemaining: () => 50 }) });
      return seq;
    },
    fetch: (url: string, init: { body: string }) => {
      avisos.push({ url, corpo: JSON.parse(init.body) });
      return Promise.resolve({ status: o.status ?? 204 });
    },
    location: {
      reload: () => {
        registro.recargas++;
      },
    },
    __coletor: (_n: string, pausa: boolean, memo: unknown) => {
      const n = chamadas.length;
      chamadas.push({ t: relogio.t, pausa, memo });
      relogio.t += custoDe(n, pausa);
      const pego = o.pegarNa === n;
      return { cdp: pego, devtoolsAberto: false, nonce: "" };
    },
  };
  caixa.window = caixa;
  vm.runInContext(script, vm.createContext(caixa));

  /** Roda a agenda em ordem até o instante `fim` (ms no relógio falso). */
  function rodarAte(fim: number): void {
    for (;;) {
      agenda.sort((a, b) => a.quando - b.quando || a.id - b.id);
      const proxima = agenda[0];
      if (!proxima || proxima.quando > fim) break;
      agenda.shift();
      if (cancelados.has(proxima.id)) continue;
      relogio.t = Math.max(relogio.t, proxima.quando);
      proxima.fn();
    }
    relogio.t = Math.max(relogio.t, fim);
  }

  function mudarVisibilidade(estado: "visible" | "hidden"): void {
    documento.visibilityState = estado;
    for (const fn of ouvintes) fn();
  }

  const intervalos = () => chamadas.slice(1).map((c, i) => c.t - chamadas[i]!.t);
  return { script, chamadas, avisos, registro, relogio, rodarAte, mudarVisibilidade, intervalos };
}

describe("guarda: intervalo", () => {
  it(`com a aba visível vigia na carga e depois a cada ${INTERVALO} ms`, () => {
    const g = montarGuarda({ custo: 3 });
    g.rodarAte(0);
    expect(g.chamadas.map((c) => c.t)).toEqual([0]);
    g.rodarAte(10_100);
    expect(g.chamadas).toHaveLength(11);
    for (const d of g.intervalos()) {
      expect(d).toBeGreaterThanOrEqual(INTERVALO);
      expect(d).toBeLessThanOrEqual(INTERVALO + 3);
    }
  });

  it("passa o mesmo memo em todas as voltas (as linhas da tabela são montadas uma vez)", () => {
    const g = montarGuarda();
    g.rodarAte(5_000);
    expect(g.chamadas.length).toBeGreaterThan(3);
    const memo = g.chamadas[0]!.memo;
    expect(typeof memo).toBe("object");
    expect(memo).not.toBeNull();
    for (const c of g.chamadas) expect(c.memo).toBe(memo);
  });
});

describe("guarda: só com a aba visível", () => {
  it("aba escondida para de vigiar; ao voltar a ficar visível roda na hora e retoma o ritmo", () => {
    const g = montarGuarda();
    g.rodarAte(2_500);
    expect(g.chamadas).toHaveLength(3);
    g.mudarVisibilidade("hidden");
    g.rodarAte(60_000);
    expect(g.chamadas).toHaveLength(3);
    g.mudarVisibilidade("visible");
    expect(g.chamadas).toHaveLength(4);
    expect(g.chamadas[3]!.t).toBe(60_000);
    g.rodarAte(70_100);
    // Uma corrente só: 10 voltas em 10 s, sem voltas dobradas.
    expect(g.chamadas).toHaveLength(14);
    for (const d of g.intervalos().slice(3)) expect(d).toBeGreaterThanOrEqual(INTERVALO);
  });

  it("página aberta escondida (aba em segundo plano) não roda nada até ficar visível", () => {
    const g = montarGuarda({ visivel: false });
    g.rodarAte(30_000);
    expect(g.chamadas).toHaveLength(0);
    g.mudarVisibilidade("visible");
    expect(g.chamadas.map((c) => c.t)).toEqual([30_000]);
  });

  it("piscar visível e escondido não dobra a corrente", () => {
    const g = montarGuarda();
    g.rodarAte(500);
    for (let i = 0; i < 5; i++) {
      g.mudarVisibilidade("hidden");
      g.mudarVisibilidade("visible");
    }
    const depoisDoPisca = g.chamadas.length;
    g.rodarAte(10_600);
    expect(g.chamadas.length - depoisDoPisca).toBe(10);
  });
});

describe("guarda: recuo em aparelho lento", () => {
  it(`custo médio acima de 1% do intervalo dobra o intervalo, até ${INTERVALO_MAX} ms`, () => {
    const g = montarGuarda({ custo: 20 });
    g.rodarAte(60_000);
    const d = g.intervalos();
    // Primeira volta fora da conta; a média sai depois de mais 5 voltas.
    expect(d.slice(0, 5).every((x) => x < INTERVALO + 30)).toBe(true);
    expect(d.slice(6).length).toBeGreaterThan(10);
    for (const x of d.slice(6)) {
      expect(x).toBeGreaterThanOrEqual(INTERVALO_MAX);
      expect(x).toBeLessThanOrEqual(INTERVALO_MAX + 20);
    }
  });

  it("custo abaixo do teto não muda o intervalo", () => {
    const g = montarGuarda({ custo: 8 });
    g.rodarAte(60_000);
    for (const x of g.intervalos()) expect(x).toBeLessThanOrEqual(INTERVALO + 8);
  });

  it("a primeira volta (mais cara, o navegador ainda compila) não conta", () => {
    const g = montarGuarda({ custo: (n) => (n === 0 ? 200 : 3) });
    g.rodarAte(30_000);
    for (const x of g.intervalos()) expect(x).toBeLessThanOrEqual(INTERVALO + 200);
    expect(g.intervalos().slice(1).every((x) => x <= INTERVALO + 3)).toBe(true);
  });

  it("volta com a sonda de pausa não conta no custo", () => {
    // Uma pausa do depurador que não chegou a pegar (uma só, não duas seguidas) não é custo da sonda.
    const g = montarGuarda({ custo: (_n, pausa) => (pausa ? 400 : 3) });
    g.rodarAte(60_000);
    const depoisDeVoltaSemPausa = g.intervalos().filter((_, i) => !g.chamadas[i]!.pausa);
    expect(depoisDeVoltaSemPausa.length).toBeGreaterThan(40);
    for (const x of depoisDeVoltaSemPausa) expect(x).toBeLessThanOrEqual(INTERVALO + 3);
  });
});

describe("guarda: sonda de pausa", () => {
  it(`com sondarPausa (padrão) a pausa roda na carga e depois a cada ${PAUSA / 1000} s`, () => {
    const g = montarGuarda();
    g.rodarAte(31_000);
    const pausas = g.chamadas.filter((c) => c.pausa).map((c) => c.t);
    expect(pausas[0]).toBe(0);
    expect(pausas.length).toBe(6);
    for (let i = 1; i < pausas.length; i++) {
      expect(pausas[i]! - pausas[i - 1]!).toBeGreaterThanOrEqual(PAUSA);
      expect(pausas[i]! - pausas[i - 1]!).toBeLessThan(PAUSA + INTERVALO);
    }
  });

  it("sem sondarPausa a pausa nunca roda e o script não leva o debugger", () => {
    const g = montarGuarda({ sondarPausa: false });
    g.rodarAte(31_000);
    expect(g.chamadas.length).toBeGreaterThan(30);
    expect(g.chamadas.every((c) => c.pausa === false)).toBe(true);
    expect(scriptGuarda({ sondarPausa: false })).not.toMatch(/\bdebugger\b/);
  });
});

describe("guarda: quando pega", () => {
  it("avisa uma vez em /.anti-rea/pego, para de vigiar e recarrega com 204", async () => {
    const g = montarGuarda({ pegarNa: 2 });
    g.rodarAte(2_500);
    expect(g.avisos).toHaveLength(1);
    expect(g.avisos[0]!.url).toBe("/.anti-rea/pego");
    expect(g.avisos[0]!.corpo.cdp).toBe(true);
    g.rodarAte(30_000);
    g.mudarVisibilidade("hidden");
    g.mudarVisibilidade("visible");
    expect(g.chamadas).toHaveLength(3);
    expect(g.avisos).toHaveLength(1);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(g.registro.recargas).toBe(1);
  });

  it("sem 204 (passe não revogado) não recarrega", async () => {
    const g = montarGuarda({ pegarNa: 0, status: 200 });
    g.rodarAte(0);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(g.avisos).toHaveLength(1);
    expect(g.registro.recargas).toBe(0);
  });
});
