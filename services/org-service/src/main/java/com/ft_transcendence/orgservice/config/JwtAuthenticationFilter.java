package com.ft_transcendence.orgservice.config;

import java.nio.charset.StandardCharsets;

import javax.crypto.SecretKey;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import io.jsonwebtoken.security.Keys;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import jakarta.servlet.http.HttpServletResponse;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.JwtException;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    public static final String USER_ID_ATTRIBUTE = "userId";

    private final SecretKey signingKey;

    public JwtAuthenticationFilter(@Value("${jwt.secret}") String jwtSecret)
    {
        this.signingKey = Keys.hmacShaKeyFor(
                jwtSecret.getBytes(StandardCharsets.UTF_8)
        );
    }
    
    @Override
    protected void doFilterInternal(
                HttpServletRequest request,
                HttpServletResponse response,
                FilterChain filterChain
    ) throws ServletException, IOException {

        String token = extractToken(request);
        if (token == null) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\": \"Missing or invalid Authorization header\"}");
            return;
        }
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(signingKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                            claims.getSubject(),
                            null,
                            java.util.List.of()
                    );

            SecurityContextHolder.getContext().setAuthentication(authentication);
            filterChain.doFilter(request, response);

        } catch (JwtException e) {

            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\": \"Invalid JWT token\"}");
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getRequestURI().startsWith("/healthz");
    }

    private String extractToken(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");
        if (bearerToken != null && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }
        return null;
    }
}