function (nonce) {
  var n = navigator, w = window, ua = String(n.userAgent || "");
  var getter = false;
  try {
    var e = new Error("anti-rea");
    Object.defineProperty(e, "stack", { configurable: true, get: function () { getter = true; return ""; } });
    console.debug(e);
  } catch (x) {}
  var encolhida = w.outerWidth - w.innerWidth > 160 || w.outerHeight - w.innerHeight > 160;
  return {
    webdriver: n.webdriver === true,
    headlessUA: /HeadlessChrome/.test(ua),
    semPlugins: !n.plugins || n.plugins.length === 0,
    temWindowChrome: typeof w.chrome === "object" && w.chrome !== null,
    uaChrome: /\bChrome\/\d/.test(ua) && !/Android|Mobile|; wv\)/.test(ua),
    cdp: getter && !encolhida,
    devtoolsAberto: getter && encolhida,
    linguas: n.languages ? n.languages.length : 0,
    nonce: String(nonce || "")
  };
}
