function (nonce, sondarPausa, memo) {
  var n = navigator, w = window, ua = String(n.userAgent || "");
  var agora = function () { return w.performance && performance.now ? performance.now() : Date.now(); };
  var temChrome = typeof w.chrome === "object" && w.chrome !== null;
  var encolhida = w.outerWidth - w.innerWidth > 160 || w.outerHeight - w.innerHeight > 160;
  var pausa = function () { var t = agora(); debugger; return agora() - t > 50; };
  var pausou = !!sondarPausa && pausa() && pausa();
  var celular = /Android|Mobile|; wv\)/.test(ua) || n.maxTouchPoints > 0;
  try {
    var d = n.userAgentData;
    if (d) celular = celular || d.mobile === true || d.platform === "Android" ||
      (d.brands || []).some(function (b) { return /Android WebView/.test(b.brand); });
  } catch (x) {}
  var runtime = false;
  try {
    var nativo = /\[native code\]/.test(Function.prototype.toString.call(console.table));
    if ((temChrome || !!n.userAgentData) && nativo) {
      var linhas = memo && memo.linhas, tabela = memo && memo.tabela;
      if (!linhas || !tabela) {
        linhas = [];
        tabela = {};
        for (var i = 0; i < 1000; i++) { linhas.push({ a: i, b: "x" + i, c: i % 7 }); tabela[i] = linhas[i]; }
        if (memo) { memo.linhas = linhas; memo.tabela = tabela; }
      }
      var medir = function () {
        JSON.parse(JSON.stringify(linhas));
        var t0 = agora(), voltas = 0, base = Infinity;
        do { var tv = agora(); JSON.parse(JSON.stringify(linhas)); base = Math.min(base, agora() - tv); voltas++; } while (agora() - t0 < 2 && voltas < 200);
        base = Math.max(base, 0.1);
        var custo = Infinity;
        for (var k = 0; k < 2; k++) { var t1 = agora(); console.table(tabela); custo = Math.min(custo, agora() - t1); }
        return custo > 2 && custo > 20 * base;
      };
      runtime = medir() && medir();
    }
  } catch (x) {}
  return {
    webdriver: n.webdriver === true,
    headlessUA: /HeadlessChrome/.test(ua),
    semPlugins: !n.plugins || n.plugins.length === 0,
    temWindowChrome: temChrome,
    uaChrome: /\bChrome\/\d/.test(ua) && !celular,
    cdp: runtime && !pausou && !encolhida,
    devtoolsAberto: pausou || (runtime && encolhida),
    linguas: n.languages ? n.languages.length : 0,
    nonce: String(nonce || "")
  };
}
