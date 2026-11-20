# Perguntas frequentes

**Isso impede 100% a cópia do meu site?**
Não, e nenhuma ferramenta impede. O que o navegador recebe pode ser salvo por uma pessoa paciente.
O ANTI-REA barra as ferramentas automáticas, denuncia a tentativa e engana quem tenta.

**Meu cliente pode cair na página sombra?**
Navegando normal, não. Abrindo o F12, sim, por padrão (`devtoolsIsCaught`). Sua equipe usa o
[link de dono](07-modo-dono.md).

**Abri o F12 numa janela separada e caí na sombra. Por quê?**
F12 numa janela separada, com as pausas desligadas (o botão "Desativar pontos de interrupção" do
painel de fontes), conta como depuração remota: o navegador fica igual a um cliente como o REA, e o
ANTI-REA não tem como separar os dois. O motivo registrado é "depuração remota ativa", e isso vale
mesmo com `devtoolsIsCaught: false`. Com `devtoolsIsCaught: false` a sonda de pausa nem roda e a
página do site não leva a conferência contínua: aí só a tela de verificação confere, e qualquer F12
em janela separada aberto nessa hora conta como depuração remota. F12 encaixado na janela segue o
`devtoolsIsCaught`.
Para você e sua equipe, o caminho é o [link de dono](07-modo-dono.md).

**Por que aparecem duas tabelas no console?**
São do ANTI-REA. Enquanto confere o navegador, ele imprime duas tabelas de 1000 linhas com
`console.table` e mede o tempo: com um cliente de depuração remota ligado, montar essas tabelas fica
dezenas de vezes mais lento. Com `devtoolsIsCaught: true` (o padrão), a conferência se repete a
cada 0,5 s na página do site enquanto a aba está visível, então as tabelas vão se acumulando no
console de quem o deixa aberto. Não é erro do seu site. Só acontece em navegador baseado no Chrome
(Chrome, Edge, Brave, Opera), e nunca com o passe de dono.

**A conferência contínua deixa o site lento?**
Medimos: cada volta custa uns 2,3 ms, duas vezes por segundo, só com a aba visível. Num computador
com a CPU 6 vezes mais lenta (como um celular fraco) dá 0,7% de CPU. A memória da aba (o processo
inteiro, não só o JavaScript) fica uns 2 MB acima da mesma página sem a guarda e para de crescer
depois de uns 3 minutos: o Chrome guarda as mensagens do console até um teto, e as da guarda são
curtas. Em aparelho ainda mais lento a guarda percebe o próprio custo e passa a conferir a cada 1 s
e depois a cada 1,5 s. Os números estão em [docs/_medicoes](_medicoes/2026-11-guarda.md).

**O ANTI-REA sempre pega o REA?**
Nem sempre, e a gente prefere dizer isso. Ele pega o navegador que o próprio REA abre (sem tela), a
busca direta sem passe (leva 403), o pedido do mapa de código (leva a sombra) e, com
`devtoolsIsCaught: true` (o padrão), o REA ligado a uma **aba visível** enquanto passa uma
conferência da guarda: a página vira sombra e o aviso chega. As conferências vêm a cada 0,5 s numa
página parada e, na nossa medição, a no máximo uns 0,6 s numa página que anima a cada quadro; em
aparelho muito lento a guarda recua para 1 s e depois 1,5 s. Com `devtoolsIsCaught: false` a aba
que já passou pela verificação não é mais conferida, e o REA ligado a ela não é pego. A inspeção
curta (a padrão do REA, de meio segundo) numa aba que já passou pela verificação foi pega 20 em 20
vezes na nossa medição; em 2 delas o REA já tinha lido a página antes da conferência e saiu com o
que aquela aba tinha carregado: a página e os scripts compilados. O mapa e o código-fonte original
não saem. Veja os [limites conhecidos](#limites-conhecidos).

**Atrapalha SEO ou anúncios?**
Não. Veja [Robôs oficiais](08-robos-oficiais.md).

**O DuckDuckGo vê o meu site?**
Só a prévia: título, descrição e imagem. O DuckDuckGo não publica um nome de DNS reverso, então não
tem como ser conferido, e aceitar o nome dele deixaria qualquer copiador entrar dizendo ser o
DuckDuckBot. Ele recebe a tela de verificação com a prévia, nunca a sombra, e indexa só essa prévia.

**Deixa o site lento?**
Só a primeira visita tem a verificação de menos de 1 segundo.

**Funciona com WordPress? E com site estático?**
Sim. O porteiro não depende de como o site foi feito.

**Posso usar com Cloudflare ou outra CDN na frente?**
Pode, com `trustProxy: cloudflare`. Toda resposta que só sai com passe leva
`CDN-Cache-Control: no-store`, `Cloudflare-CDN-Cache-Control: no-store` e `Cache-Control: private`,
para a CDN não guardar o JS de um visitante verificado e entregar a qualquer um. Regra de cache que
força tempo na borda ("Cache Everything" com Edge TTL) passa por cima disso: desligue essa regra nos
caminhos do site, ou deixe só imagens e fontes em cache.

**O link de login por e-mail parou de funcionar. Por quê?**
Se o código vem no próprio caminho (`/login/magico/<código>`), a tela de verificação busca a prévia
desse caminho e o código é gasto. Ponha o caminho em `exempt`. Código na query não tem esse
problema.

**E se o ANTI-REA cair?**
O site fica fora do ar, como acontece com qualquer proxy na frente. Use reinício automático
(`restart: unless-stopped` no Docker) e um monitor de uptime.

**Posso usar em site de cliente?**
Pode. Lembre de citar a coleta de IP na política de privacidade do site.

**Guardar IP é permitido?**
É dado pessoal pela LGPD. Pode guardar para segurança, com prazo e transparência: cite na política
de privacidade e configure `log.retention`.

**O ANTI-REA é do mesmo autor do REA?**
Não. É um projeto independente que estudou a lógica do REA para se defender dela.

## Limites conhecidos

O que a versão 0.1 ainda não resolve, dito às claras.

**O cancelamento do passe fica só na memória.** Quando alguém é pego, o passe dele entra numa lista
de cancelados que mora na memória do porteiro. Se o porteiro reiniciar, a lista some e um passe
cancelado volta a valer até vencer. Além disso, a marca de pego, que manda aquele navegador para a
sombra, segura 1 hora. Passada essa hora, o mesmo navegador pode tentar a verificação de novo, e só
cai se for pego outra vez.

**A política de segurança do seu site pode desligar a guarda.** A guarda entra na página como um
script do próprio endereço do site (`/.anti-rea/guarda.js`). Se o seu site manda um cabeçalho
`Content-Security-Policy` em que o `script-src` não tem `'self'`, o navegador não roda a guarda. O
site continua funcionando, mas a aba deixa de ser conferida depois da verificação. Resolva
acrescentando `'self'` ao `script-src`.

**Imagem de prévia gerada na hora, sem extensão, precisa ir em `exempt`.** Robô de prévia de link
(WhatsApp, Telegram, LinkedIn) recebe as imagens, fontes e ícones que ele reconhece pela extensão
do arquivo (`.png`, `.jpg` e afins). Se o `og:image` do seu site aponta para um endereço sem
extensão, como `/api/og?titulo=...`, o robô recebe a tela de verificação no lugar da imagem e a
prévia sai sem foto. Ponha esse caminho em [`exempt`](03-configurar.md).

**Uma inspeção curta do REA numa aba que já passou pode levar a página.** A guarda confere a aba a
cada 0,5 s (até uns 0,6 s numa página muito ocupada, até 1,65 s num aparelho muito lento). O REA
que se liga, olha e se desliga entre duas conferências não é percebido, e o que lê antes da
conferência seguinte ele leva: o que a aba já tinha carregado (a página e os scripts compilados),
nunca o mapa nem o código-fonte original. Na medição, a inspeção padrão do REA (meio segundo) foi
pega 10 em 10 vezes com o `inspect-web-page` e 10 em 10 com o `analyze-web-bundle`, mas em 2 das 10
do `inspect-web-page` ele saiu com a página antes de a aba virar sombra. Com a conferência a cada
1,5 s, de antes, escapava 8 em 10. Conferir mais rápido (a cada 0,25 s) custaria 1,4% de CPU num
aparelho 6 vezes mais lento, acima do teto de 1% que o projeto se impôs. Os números estão em
[docs/_medicoes](_medicoes/2026-11-guarda.md).

**A guarda só confere a aba visível.** Com a aba em segundo plano ou a janela minimizada, a guarda
para, para não gastar o aparelho de quem nem está olhando o site. Quando a aba volta a ficar
visível, ela confere na hora. Um REA ligado a uma aba escondida só pode ser pego quando a aba
aparece de novo.
