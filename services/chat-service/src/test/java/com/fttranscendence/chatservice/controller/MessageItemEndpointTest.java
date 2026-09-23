package com.fttranscendence.chatservice.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import java.util.Optional;

import org.bson.types.ObjectId;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.grpc.OrgClient;
import com.fttranscendence.chatservice.support.MongoTestSupport;

/**
 * GET /messages/{id} through the real filter chain and a real MongoDB:
 * what POST stored is what GET returns, and an outsider cannot tell a
 * message they may not read from one that does not exist.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MessageItemEndpointTest extends MongoTestSupport {

    private static final String ALICE = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String MALLORY = "c3d4e5f6-0000-4000-8000-000000000003";
    /** A room no other test class writes to: they share this database. */
    private static final long ROOM = 800L;

    @Autowired
    private TestRestTemplate rest;

    @MockBean
    private IdentityClient identityClient;

    @MockBean
    private OrgClient orgClient;

    @BeforeEach
    void setUp() {
        when(identityClient.validateToken(anyString())).thenReturn(Optional.empty());
        when(identityClient.validateToken(ALICE + ".token")).thenReturn(Optional.of(ALICE));
        when(identityClient.validateToken(MALLORY + ".token")).thenReturn(Optional.of(MALLORY));
        when(orgClient.isMember(ALICE, ROOM)).thenReturn(true);
        when(orgClient.isMember(MALLORY, ROOM)).thenReturn(false);
    }

    private HttpHeaders auth(String userId) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(userId + ".token");
        return headers;
    }

    private ResponseEntity<String> post(String userId, String content) {
        HttpHeaders headers = auth(userId);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return rest.postForEntity("/rooms/" + ROOM + "/messages",
                new HttpEntity<>("{\"content\":\"" + content + "\"}", headers), String.class);
    }

    private ResponseEntity<String> get(String userId, String messageId) {
        return rest.exchange("/messages/" + messageId, HttpMethod.GET,
                new HttpEntity<>(auth(userId)), String.class);
    }

    private static String idOf(String json) {
        return json.replaceAll(".*\"id\":\"([0-9a-f]{24})\".*", "$1");
    }

    @Test
    @DisplayName("GET returns byte for byte what POST returned")
    void getReturnsWhatPostStored() {
        ResponseEntity<String> created = post(ALICE, "hello from post");
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        ResponseEntity<String> fetched = get(ALICE, idOf(created.getBody()));

        assertThat(fetched.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(fetched.getBody()).isEqualTo(created.getBody());
    }

    @Test
    @DisplayName("a non-member gets the same 404 body as for an id that was never stored")
    void outsiderCannotProbeForMessages() {
        String realId = idOf(post(ALICE, "members only").getBody());
        String unknownId = new ObjectId().toHexString();

        ResponseEntity<String> hidden = get(MALLORY, realId);
        ResponseEntity<String> unknown = get(MALLORY, unknownId);

        assertThat(hidden.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(hidden.getBody()).isEqualTo(unknown.getBody()).doesNotContain("members only");
    }

    @Test
    @DisplayName("a malformed id is a 400 INVALID_MESSAGE_ID")
    void malformedIdIsBadRequest() {
        ResponseEntity<String> response = get(ALICE, "not-an-object-id");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).contains("INVALID_MESSAGE_ID");
    }

    @Test
    @DisplayName("no token is a 401 from the filter, before any lookup")
    void missingTokenIsUnauthorized() {
        ResponseEntity<String> response = rest.getForEntity(
                "/messages/" + new ObjectId().toHexString(), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
