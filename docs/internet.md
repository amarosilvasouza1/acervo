# Conectar o APK ao PC por outra rede

O PC continua hospedando a biblioteca. O modo de internet gerenciado encaminha somente TCP para a porta HTTPS do Acervo. Quando há Tailscale Funnel disponível no PC, ele é tentado primeiro. Se esse serviço não confirmar uma conexão pública, o Acervo usa um cliente Bore integrado, sem instalar outro programa. O telefone usa o APK 1.5.2 ou posterior, sem outro aplicativo de rede. O PC precisa permanecer ligado e conectado.

O encaminhador transporta o TLS original. O APK confere a chave pública do PC e o PC exige a identidade do celular autorizado. Não são usados `--https`, `--tls-terminated-tcp` nem um proxy HTTP para esse modo. A documentação distingue [TCP bruto e TCP com encerramento de TLS](https://tailscale.com/docs/reference/tailscale-cli/funnel); o [Bore](https://github.com/ekzhang/bore) também encaminha TCP. O cliente integrado usa o controle fixo `bore.pub:7835`, limita mensagens e conexões e só abre a porta HTTPS configurada em `127.0.0.1`. Um intermediário ainda observa informações de conexão, como horários e volume de tráfego; as chaves privadas e o conteúdo das músicas não são enviados a ele.

## Ativar

1. Inicie o Acervo no PC e abra **Dispositivos → Conectar pela internet → Ativar conexão pela internet**. Também existe `iniciar-internet.cmd`, que inicia o servidor local quando necessário.
2. Se o PC já tem Tailscale instalado, conectado e autorizado a usar Funnel, ele pode ser aproveitado. O app não cria contas nem altera a política da conta automaticamente. Se esse caminho falhar, o cliente Bore integrado solicita uma porta pública para o mesmo transporte criptografado.
3. O Funnel usa uma porta livre entre 443, 8443 e 10000, preservando serviços existentes. O Bore usa uma porta atribuída pelo serviço. O endereço selecionado fica em `data/connect-network.json`; o convite do QR não é salvo.
4. Espere o estado **Conexão pela internet verificada**. O teste consulta DNS público, evita o endereço privado da tailnet, compara a identidade TLS do PC e confirma que a biblioteca recusa um cliente sem a chave do celular.
5. Gere o QR e selecione **Internet**. Se o celular já está vinculado, use **Atualizar endereço no celular vinculado**. Escaneie com o leitor do APK; o telefone mantém sua identidade mesmo quando o endereço muda de LAN para internet.

Um convite novo tem 32 bytes aleatórios (256 bits), expira em cinco minutos e só pode ser usado uma vez. Solicitar outro invalida o anterior imediatamente, inclusive quando uma imagem antiga ainda está sendo gerada. O QR contém somente o convite temporário e a identidade pública do PC. Não compartilhe o convite antes de parear.

## Quando aparece “configurado” sem “verificado”

Use somente uma instância do Acervo por pasta de dados. A versão 1.5.2 bloqueia a abertura duplicada e mostra a porta da instância ativa. Em versões anteriores, duas instâncias podiam compartilhar a identidade do PC, mas tinham convites separados: um QR gerado em uma janela não era aceito pelo servidor atendido pelo endereço público.

Ao atualizar do APK 1.5.0, instale o 1.5.2 por cima e escaneie um novo QR. O novo convite autoriza a migração da chave incompatível com o TLS do Android; a chave antiga é preservada. Se o PC já listar um celular vinculado com a chave antiga, remova esse vínculo no PC antes de gerar o novo convite. Não é necessário apagar músicas do celular.

O encaminhamento pode estar aceito pelo serviço enquanto o nome ainda não resolve no DNS público. Nesse caso o Acervo mantém o acesso como **não verificado**; isso não confirma que um celular fora da rede consegue entrar. Use **Verificar e ativar conexão** novamente depois da publicação. Se o DNS continuar retornando `NXDOMAIN`, a publicação do nome precisa ser resolvida no provedor; o QR sozinho não corrige essa etapa.

O encaminhamento e seu registro são preservados após reinícios, mas cada processo novo do Acervo começa sem afirmar que o acesso externo foi verificado. Uma nova verificação compara novamente a identidade do PC. O servidor recusa outro telefone enquanto o vínculo atual existir.

No Bore, o PC restabelece automaticamente o cliente autorizado ao iniciar o Acervo e tenta recuperar a mesma porta em quedas da conexão. A verificação da identidade é repetida antes de mostrar o estado online. A porta não é uma reserva permanente do serviço: se estiver ocupada após uma parada prolongada, o app não troca o endereço silenciosamente. Nesse caso, desative e ative novamente para obter outra porta e escaneie um novo QR no mesmo celular. O serviço público é compartilhado e sua disponibilidade não é garantida pelo Acervo.

## Desativar

Use **Dispositivos → Desativar encaminhamento** ou `parar-internet.cmd` enquanto o Acervo está rodando. Somente o encaminhamento registrado por este Acervo é removido. No Bore, isso fecha o cliente e suas conexões de dados. No Funnel, o app não executa `tailscale funnel reset`, não encerra serviços de outras portas e não desliga o servidor local. Se a porta tiver sido alterada por outro serviço, ele recusa removê-la.

## Outro encaminhador ou endereço público próprio

Com o encaminhamento gerenciado desligado, o proprietário pode salvar uma origem HTTPS pública em **Dispositivos**. A alternativa `ACERVO_PUBLIC_ENDPOINT` continua disponível e bloqueia edição pelo app quando definida. O endereço deve alcançar a porta HTTPS do próprio Acervo por TCP, preservando a conexão TLS e a identidade do telefone. Salvar um endereço manual não cria um túnel nem configura o roteador.

Uma rede que bloqueie o encaminhador, a porta usada ou a própria internet pode impedir a conexão. O modo independente do APK continua pesquisando e tocando pela própria conexão do celular quando o PC está indisponível.

No Acervo 1.5.4, o cliente Bore permite até 32 canais simultâneos e uma fila limitada de 32 pedidos por até quatro segundos. O APK reutiliza conexões HTTPS completas e o contexto TLS do PC pareado para reduzir negociações repetidas ao abrir capas e dados. A latência e a disponibilidade do intermediário público ainda influenciam o tempo de resposta.
