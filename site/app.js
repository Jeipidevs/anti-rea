// ANTI-REA: comportamento da página. Sem biblioteca; respeita quem prefere menos movimento.
(() => {
  const raiz = document.documentElement;
  raiz.classList.add("js");
  const calmo = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Luz que segue o mouse.
  if (!calmo) {
    let quadro = 0;
    addEventListener("pointermove", (e) => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        raiz.style.setProperty("--mx", `${e.clientX}px`);
        raiz.style.setProperty("--my", `${e.clientY}px`);
      });
    }, { passive: true });
  }

  // Revelar ao rolar, com atraso em cascata dentro do mesmo grupo.
  const revelar = [...document.querySelectorAll(".revelar")];
  const grupos = new Map();
  for (const el of revelar) {
    const pai = el.parentElement;
    const i = grupos.get(pai) ?? 0;
    grupos.set(pai, i + 1);
    el.style.setProperty("--atraso", `${Math.min(i, 5) * 70}ms`);
  }
  const aoVer = (alvos, fazer, margem = "0px 0px -10% 0px") => {
    if (!("IntersectionObserver" in window)) return alvos.forEach(fazer);
    const io = new IntersectionObserver((entradas) => {
      for (const e of entradas) if (e.isIntersecting) { fazer(e.target); io.unobserve(e.target); }
    }, { rootMargin: margem });
    alvos.forEach((a) => io.observe(a));
  };
  aoVer(revelar, (el) => el.classList.add("visivel"));
  aoVer([...document.querySelectorAll(".passos")], (el) => el.classList.add("desenhar"));

  // Números que contam.
  aoVer([...document.querySelectorAll("[data-numero]")], (el) => {
    const fim = Number(el.dataset.numero);
    const prefixo = el.dataset.prefixo ?? "";
    if (calmo || fim === 0) { el.textContent = prefixo + fim; return; }
    const t0 = performance.now(), dur = 1200;
    const passo = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = prefixo + Math.round(fim * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });

  // Copiar comando.
  const aviso = document.querySelector(".aviso-copiado");
  let tempoAviso = 0;
  for (const b of document.querySelectorAll("[data-copiar]")) {
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copiar);
        b.textContent = "Copiado";
        b.classList.add("feito");
        aviso.textContent = "Comando copiado.";
      } catch {
        aviso.textContent = "Não deu para copiar: selecione o comando e copie à mão.";
      }
      aviso.classList.add("mostrar");
      clearTimeout(tempoAviso);
      tempoAviso = setTimeout(() => {
        aviso.classList.remove("mostrar");
        b.textContent = "Copiar";
        b.classList.remove("feito");
      }, 1800);
    });
  }

  // Vitrine: abas com troca de tela.
  const enderecos = {
    sombra: "seusite.com.br/.env",
    painel: "seusite.com.br/.anti-rea/painel",
    exame: "exame-seusite.com.br-2026-11-22.html",
    celular: "seusite.com.br/wp-login.php",
  };
  const abas = [...document.querySelectorAll(".abas [role=tab]")];
  const escolher = (aba) => {
    for (const a of abas) a.setAttribute("aria-selected", String(a === aba));
    for (const img of document.querySelectorAll(".vitrine-img")) img.classList.toggle("ativa", img.dataset.tela === aba.dataset.tela);
    document.querySelector(".vitrine-endereco").textContent = enderecos[aba.dataset.tela];
  };
  abas.forEach((aba, i) => {
    aba.addEventListener("click", () => escolher(aba));
    aba.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const outra = abas[(i + (e.key === "ArrowRight" ? 1 : abas.length - 1)) % abas.length];
      outra.focus();
      escolher(outra);
    });
  });

  // Inclinação leve das janelas sob o mouse (só com mouse de verdade).
  if (!calmo && matchMedia("(hover: hover) and (pointer: fine)").matches) {
    for (const j of document.querySelectorAll(".inclinar")) {
      j.addEventListener("pointermove", (e) => {
        const r = j.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        j.style.transform = `perspective(1400px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg)`;
      });
      j.addEventListener("pointerleave", () => { j.style.transform = ""; });
    }
  }

  // Terminais que digitam quando aparecem.
  const terminais = [...document.querySelectorAll("[data-digitar]")];
  if (!calmo) {
    terminais.forEach((t) => t.classList.add("digitando"));
    aoVer(terminais, async (t) => {
      for (const linha of t.querySelectorAll("[data-linha]")) {
        const comando = linha.classList.contains("t-cmd");
        if (comando) {
          const texto = linha.textContent;
          linha.textContent = "";
          linha.classList.add("vista");
          for (const ch of texto) {
            linha.textContent += ch;
            await new Promise((r) => setTimeout(r, 22));
          }
          await new Promise((r) => setTimeout(r, 260));
        } else {
          linha.classList.add("vista");
          await new Promise((r) => setTimeout(r, 140));
        }
      }
    }, "0px 0px -20% 0px");
  }

  // Cena: pedidos chegando ao porteiro.
  const cena = document.querySelector(".cena");
  const camada = cena?.querySelector(".pedidos");
  if (!cena || !camada) return;
  const porteiro = cena.querySelector(".porteiro");
  const alerta = cena.querySelector(".alerta");
  const quem = cena.querySelector(".alerta-quem");
  const contagem = { site: cena.querySelector('[data-cont="site"]'), sombra: cena.querySelector('[data-cont="sombra"]') };
  const total = { site: 0, sombra: 0 };
  const visitantes = [
    { nome: "Chrome · pessoa", gente: true },
    { nome: "curl/8.7", gente: false },
    { nome: "Safari · pessoa", gente: true },
    { nome: "HTTrack", gente: false },
    { nome: "Googlebot ✓", gente: true },
    { nome: "F12 aberto", gente: false },
    { nome: "Firefox · pessoa", gente: true },
    { nome: "sqlmap", gente: false },
    { nome: "meta-externalagent ✓", gente: true },
    { nome: "HeadlessChrome", gente: false },
    { nome: "wget", gente: false },
    { nome: "Edge · pessoa", gente: true },
  ];
  let indice = 0;
  let tempoAlerta = 0;

  function lancar() {
    const v = visitantes[indice++ % visitantes.length];
    const el = document.createElement("span");
    el.className = `pedido ${v.gente ? "gente" : "robo"}`;
    el.textContent = v.nome;
    camada.appendChild(el);
    const W = cena.clientWidth, H = cena.clientHeight;
    const w = el.offsetWidth, h = el.offsetHeight;
    const cx = W / 2 - w / 2, cy = H / 2 - h / 2;
    const fimX = W - w - W * 0.06;
    const fimY = v.gente ? H * 0.2 - h / 2 : H * 0.8 - h / 2;
    const meioX = cx + W * 0.16;
    const anim = el.animate(
      [
        { transform: `translate(${-w}px, ${cy}px)`, opacity: 0 },
        { transform: `translate(${W * 0.08}px, ${cy}px)`, opacity: 1, offset: 0.12 },
        { transform: `translate(${cx - W * 0.12}px, ${cy}px) scale(1)`, opacity: 1, offset: 0.42 },
        { transform: `translate(${cx}px, ${cy}px) scale(0.85)`, opacity: 0.4, offset: 0.5 },
        { transform: `translate(${meioX}px, ${(cy + fimY) / 2}px) scale(1)`, opacity: 1, offset: 0.66 },
        { transform: `translate(${fimX}px, ${fimY}px) scale(0.9)`, opacity: 0, offset: 1 },
      ],
      { duration: 4200, easing: "cubic-bezier(0.45, 0, 0.25, 1)" },
    );
    setTimeout(() => {
      if (v.gente) return;
      porteiro.classList.add("pegou");
      setTimeout(() => porteiro.classList.remove("pegou"), 260);
      quem.textContent = v.nome;
      alerta.classList.add("mostrar");
      clearTimeout(tempoAlerta);
      tempoAlerta = setTimeout(() => alerta.classList.remove("mostrar"), 1600);
    }, 2100);
    anim.onfinish = () => {
      el.remove();
      const lado = v.gente ? "site" : "sombra";
      total[lado]++;
      contagem[lado].textContent = total[lado];
    };
  }

  if (calmo) {
    contagem.site.textContent = "6";
    contagem.sombra.textContent = "6";
    return;
  }
  let relogio = 0;
  let naTela = false;
  const ligar = () => { if (!relogio) { lancar(); relogio = setInterval(lancar, 1100); } };
  const desligar = () => { clearInterval(relogio); relogio = 0; };
  const conferir = () => (naTela && !document.hidden ? ligar() : desligar());
  new IntersectionObserver(([e]) => { naTela = e.isIntersecting; conferir(); }).observe(cena);
  document.addEventListener("visibilitychange", conferir);
})();
