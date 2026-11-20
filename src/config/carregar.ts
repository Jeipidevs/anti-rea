import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { duracaoMs } from "./duracao.js";

const duracao = (padrao: string) =>
  z
    .string()
    .default(padrao)
    .refine(
      (v) => {
        try {
          duracaoMs(v);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'duração inválida (use algo como "30s", "5m", "1h" ou "7d")' },
    )
    .transform(duracaoMs);

const urlHttp = z.string().refine(
  (v) => {
    try {
      const { protocol } = new URL(v);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "precisa ser uma URL http: ou https:, por exemplo http://localhost:3000" },
);

const esquema = z
  .object({
    upstream: urlHttp,
    domains: z.array(z.string().min(1)).min(1, "informe ao menos um domínio"),
    trustProxy: z.union([z.boolean(), z.literal("cloudflare")]).default(false),
    check: z
      .object({
        firstVisit: z.boolean().default(true),
        devtoolsIsCaught: z.boolean().default(true),
        passDuration: duracao("7d"),
      })
      .strict()
      .default({ firstVisit: true, devtoolsIsCaught: true, passDuration: 7 * 86_400_000 }),
    exempt: z.array(z.string()).default([]),
    shadow: z
      .object({
        language: z.enum(["pt-BR", "en"]).default("pt-BR"),
        title: z.string().optional(),
        message: z.string().optional(),
        footer: z.string().optional(),
        showIp: z.boolean().default(true),
        accentColor: z.string().optional(),
        logo: z.string().optional(),
        template: z.string().optional(),
      })
      .strict()
      .default({ language: "pt-BR", showIp: true }),
    alerts: z
      .object({
        channels: z.array(z.enum(["whatsapp", "telegram", "webhook"])).default([]),
        groupByIp: duracao("1h"),
        scans: z.enum(["panel", "dailySummary", "alert"]).default("panel"),
      })
      .strict()
      .default({ channels: [], groupByIp: 3_600_000, scans: "panel" }),
    log: z
      .object({ retention: duracao("30d") })
      .strict()
      .default({ retention: 30 * 86_400_000 }),
  })
  .strict()
  .transform(({ check, alerts, log, ...resto }) => ({
    ...resto,
    check: {
      firstVisit: check.firstVisit,
      devtoolsIsCaught: check.devtoolsIsCaught,
      passDurationMs: check.passDuration,
    },
    alerts: {
      channels: alerts.channels,
      groupByIpMs: alerts.groupByIp,
      scans: alerts.scans,
    },
    log: { retentionMs: log.retention },
  }));

export type Config = z.output<typeof esquema>;

/** Valida um objeto já lido do YAML. Lança Error com a lista de campos errados. */
export function validarConfig(obj: unknown): Config {
  const r = esquema.safeParse(obj);
  if (r.success) return r.data;
  const linhas = r.error.issues.map((i) => {
    const campo = i.path.length > 0 ? i.path.join(".") : "configuração";
    const detalhe =
      i.code === "invalid_type" && i.input === undefined ? "campo obrigatório" : i.message;
    return `  - ${campo}: ${detalhe}`;
  });
  throw new Error(`Configuração inválida:\n${linhas.join("\n")}`);
}

/** Lê o arquivo YAML, valida e aplica os padrões. */
export function carregarConfig(caminho: string): Config {
  let texto: string;
  try {
    texto = readFileSync(caminho, "utf8");
  } catch {
    throw new Error(`Não consegui ler o arquivo de configuração: ${caminho}`);
  }
  let obj: unknown;
  try {
    obj = parse(texto);
  } catch (e) {
    throw new Error(`O arquivo ${caminho} não é um YAML válido: ${(e as Error).message}`);
  }
  return validarConfig(obj);
}
