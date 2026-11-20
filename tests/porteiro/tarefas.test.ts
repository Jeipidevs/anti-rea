import { afterEach, describe, expect, it, vi } from "vitest";
import { agendarTarefas, msAteAHora } from "../../src/porteiro/tarefas.js";

const MIN = 60_000;
const HORA = 60 * MIN;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function falsos() {
  const chamadas = { apagar: [] as Date[], descarregar: 0, resumo: 0 };
  return {
    chamadas,
    registro: {
      apagarVencidos: (d: Date) => {
        chamadas.apagar.push(d);
        return 0;
      },
    },
    avisos: {
      descarregar: async () => {
        chamadas.descarregar++;
      },
      enviarResumo: async () => {
        chamadas.resumo++;
      },
    },
  };
}

describe("msAteAHora", () => {
  it("conta até a próxima hora cheia pedida, no fuso do sistema", () => {
    expect(msAteAHora(new Date(2026, 10, 20, 7, 0, 0).getTime(), 8)).toBe(HORA);
    expect(msAteAHora(new Date(2026, 10, 20, 8, 0, 0).getTime(), 8)).toBe(24 * HORA);
    expect(msAteAHora(new Date(2026, 10, 20, 9, 30, 0).getTime(), 8)).toBe(22 * HORA + 30 * MIN);
  });
});

describe("agendarTarefas", () => {
  it("apaga vencidos na subida e a cada 6 h; descarrega avisos a cada 60 s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20, 10, 0, 0));
    const f = falsos();
    const parar = agendarTarefas({ scans: "panel", registro: f.registro, avisos: f.avisos, agora: () => Date.now() });
    expect(f.chamadas.apagar).toHaveLength(1);
    expect(f.chamadas.apagar[0]!.getTime()).toBe(new Date(2026, 10, 20, 10, 0, 0).getTime());
    vi.advanceTimersByTime(59_999);
    expect(f.chamadas.descarregar).toBe(0);
    vi.advanceTimersByTime(1);
    expect(f.chamadas.descarregar).toBe(1);
    vi.advanceTimersByTime(6 * HORA);
    expect(f.chamadas.apagar).toHaveLength(2);
    expect(f.chamadas.descarregar).toBe(1 + 6 * 60);
    expect(f.chamadas.resumo).toBe(0);
    parar();
    vi.advanceTimersByTime(24 * HORA);
    expect(f.chamadas.apagar).toHaveLength(2);
    expect(f.chamadas.descarregar).toBe(1 + 6 * 60);
  });

  it('com scans "dailySummary", manda o resumo às 08:00 de cada dia', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20, 7, 59, 0));
    const f = falsos();
    const parar = agendarTarefas({ scans: "dailySummary", registro: f.registro, avisos: f.avisos, agora: () => Date.now() });
    vi.advanceTimersByTime(MIN - 1);
    expect(f.chamadas.resumo).toBe(0);
    vi.advanceTimersByTime(1);
    expect(f.chamadas.resumo).toBe(1);
    vi.advanceTimersByTime(24 * HORA - 1);
    expect(f.chamadas.resumo).toBe(1);
    vi.advanceTimersByTime(1);
    expect(f.chamadas.resumo).toBe(2);
    parar();
    vi.advanceTimersByTime(48 * HORA);
    expect(f.chamadas.resumo).toBe(2);
  });

  it("sem dailySummary não manda resumo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20, 7, 59, 0));
    const f = falsos();
    const parar = agendarTarefas({ scans: "alert", registro: f.registro, avisos: f.avisos, agora: () => Date.now() });
    vi.advanceTimersByTime(48 * HORA);
    expect(f.chamadas.resumo).toBe(0);
    parar();
  });

  it("falha de uma tarefa não derruba o agendamento", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20, 7, 59, 0));
    const linhas: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((t: string | Uint8Array) => {
      linhas.push(String(t));
      return true;
    });
    let resumos = 0;
    const parar = agendarTarefas({
      scans: "dailySummary",
      registro: {
        apagarVencidos: () => {
          throw new Error("disco");
        },
      },
      avisos: {
        descarregar: async () => Promise.reject(new Error("rede")),
        enviarResumo: async () => {
          resumos++;
          throw new Error("rede");
        },
      },
      agora: () => Date.now(),
    });
    vi.advanceTimersByTime(MIN + 24 * HORA);
    expect(resumos).toBe(2);
    parar();
    await vi.waitFor(() => expect(linhas.some((l) => l.includes("resumo do dia falhou: rede"))).toBe(true));
    expect(linhas.some((l) => l.includes("limpeza do registro falhou: disco"))).toBe(true);
  });
});
