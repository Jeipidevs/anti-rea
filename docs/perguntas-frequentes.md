# Perguntas frequentes

**Isso impede 100% a cópia do meu site?**
Não, e nenhuma ferramenta impede. O que o navegador recebe pode ser salvo por uma pessoa paciente.
O ANTI-REA barra as ferramentas automáticas, denuncia a tentativa e engana quem tenta.

**Meu cliente pode cair na página sombra?**
Navegando normal, não. Abrindo o F12, sim, por padrão (`devtoolsIsCaught`). Sua equipe usa o
[link de dono](07-modo-dono.md).

**Atrapalha SEO ou anúncios?**
Não. Veja [Robôs oficiais](08-robos-oficiais.md).

**Deixa o site lento?**
Só a primeira visita tem a verificação de menos de 1 segundo.

**Funciona com WordPress? E com site estático?**
Sim. O porteiro não depende de como o site foi feito.

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
