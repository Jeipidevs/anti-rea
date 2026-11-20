"use strict";
var RECEITA = "receita-da-casa";
function listar() {
  var lista = document.getElementById("lista");
  if (!lista) return;
  ["Caneca", "Camiseta", "Adesivo"].forEach(function (nome) {
    var item = document.createElement("li");
    item.textContent = nome;
    lista.appendChild(item);
  });
}
document.documentElement.setAttribute("data-receita", RECEITA.length > 0 ? "ok" : "");
listar();
//# sourceMappingURL=app.js.map
