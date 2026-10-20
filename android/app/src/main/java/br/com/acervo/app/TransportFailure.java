package br.com.acervo.app;

import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.security.GeneralSecurityException;
import java.security.InvalidKeyException;
import javax.net.ssl.SSLException;

public final class TransportFailure {
    private TransportFailure() { }

    public static String message(Throwable failure) {
        Throwable cause = failure;
        boolean tls = false;
        for (int depth = 0; cause != null && depth < 12; depth++, cause = cause.getCause()) {
            if (cause instanceof InvalidKeyException) return "AC-CHAVE: O Android não conseguiu usar a identidade deste celular. Atualize o APK e escaneie um novo QR no PC.";
            if (cause instanceof UnknownHostException) return "AC-DNS: O celular não encontrou o endereço do PC. Confira a internet e a conexão pela internet no Acervo do PC.";
            if (cause instanceof SocketTimeoutException) return "AC-TEMPO: O PC demorou a responder. Confira se está ligado e se a conexão pela internet aparece como verificada.";
            if (cause instanceof ConnectException || cause instanceof NoRouteToHostException) return "AC-REDE: O endereço do PC está indisponível nesta rede. Verifique a conexão pela internet no PC e gere um novo QR.";
            if (cause instanceof SSLException || cause instanceof GeneralSecurityException) tls = true;
        }
        return tls
                ? "AC-TLS: Não foi possível autenticar os aparelhos. Confira a data do celular e do PC, atualize o APK e escaneie um novo QR."
                : "AC-CONEXAO: A conexão segura foi interrompida. Confira a conexão pela internet no PC e tente novamente.";
    }
}
