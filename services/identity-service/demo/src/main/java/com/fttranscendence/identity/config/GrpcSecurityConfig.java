package com.fttranscendence.identity.config;

import io.grpc.Metadata;
import io.grpc.ServerCall;
import net.devh.boot.grpc.server.security.authentication.GrpcAuthenticationReader;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;

/**
 * Anonymous gRPC authentication reader.
 *
 * The grpc-server-spring-boot-starter requires a GrpcAuthenticationReader bean
 * when Spring Security is on the classpath. Returning null (no authentication
 * found) lets internal RPC endpoints (ValidateToken, GetUser, AreFriends) start
 * and serve anonymously, without the HTTP JWT filter, which lives on the MVC
 * filter chain and never sees gRPC traffic on port 9090.
 *
 * Callers are trusted services inside the cluster network; token validity is
 * still enforced inside the ValidateToken RPC itself.
 */
@Configuration
public class GrpcSecurityConfig {

	@Bean
	public GrpcAuthenticationReader grpcAuthenticationReader() {
		return new GrpcAuthenticationReader() {
			@Override
			public Authentication readAuthentication(ServerCall<?, ?> call, Metadata headers)
					throws AuthenticationException {
				return null;
			}
		};
	}
}