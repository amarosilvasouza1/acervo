package br.com.acervo.app;

import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.security.InvalidKeyException;
import javax.net.ssl.SSLHandshakeException;

public final class TransportFailureTest {
    private static int checks;
    private static void check(Throwable failure, String expected) {
        String message = TransportFailure.message(failure);
        if (!message.startsWith(expected + ": ") || message.contains("secret-fixture")) throw new AssertionError(message);
        checks++;
    }
    public static void main(String[] args) {
        check(new UnknownHostException("secret-fixture"), "AC-DNS");
        check(new IOException("secret-fixture", new SocketTimeoutException("secret-fixture")), "AC-TEMPO");
        check(new ConnectException("secret-fixture"), "AC-REDE");
        SSLHandshakeException handshake = new SSLHandshakeException("secret-fixture");
        check(handshake, "AC-TLS");
        handshake.initCause(new InvalidKeyException("secret-fixture"));
        check(handshake, "AC-CHAVE");
        check(new IOException("secret-fixture"), "AC-CONEXAO");
        IOException cyclic = new IOException("secret-fixture");
        IOException wrapped = new IOException("secret-fixture", cyclic);
        cyclic.initCause(wrapped);
        check(cyclic, "AC-CONEXAO");
        System.out.println("Transport failures: " + checks + " checks passed without disclosing exception messages.");
    }
}
