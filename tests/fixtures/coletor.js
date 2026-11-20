function (nonce, sondarPausa) {
  var n = navigator, w = window, ua = String(n.userAgent || "");
  var agora = function () { return w.performance && performance.now ? performance.now() : Date.now(); };
  var temChrome = typeof w.chrome === "object" && w.chrome !== null;
  var encolhida = w.outerWidth - w.innerWidth > 160 || w.outerHeight - w.innerHeight > 160;
  var pausa = function () { var t = agora(); debugger; return agora() - t > 50; };
  var pausou = !!sondarPausa && pausa() && pausa();
  var runtime = false;
  try {
    var nativo = /\[native code\]/.test(Function.prototype.toString.call(console.table));
    if ((temChrome || !!n.userAgentData) && nativo) {
      var linhas = [];
      for (var i = 0; i < 1000; i++) linhas.push({ a: i, b: "x" + i, c: i % 7 });
      var t0 = agora(), voltas = 0;
      do { JSON.parse(JSON.stringify(linhas)); voltas++; } while (agora() - t0 < 2 && voltas < 200);
      var base = Math.max((agora() - t0) / voltas, 0.1);
      var tabela = Infinity;
      for (var k = 0; k < 2; k++) { var t1 = agora(); console.table(linhas); tabela = Math.min(tabela, agora() - t1); }
      runtime = tabela > 2 && tabela > 20 * base;
    }
  } catch (x) {}
  return {
    webdriver: n.webdriver === true,
    headlessUA: /HeadlessChrome/.test(ua),
    semPlugins: !n.plugins || n.plugins.length === 0,
    temWindowChrome: temChrome,
    uaChrome: /\bChrome\/\d/.test(ua) && !/Android|Mobile|; wv\)/.test(ua),
    cdp: runtime && !pausou && !encolhida,
    devtoolsAberto: pausou || (runtime && encolhida),
    linguas: n.languages ? n.languages.length : 0,
    nonce: String(nonce || "")
  };
}
