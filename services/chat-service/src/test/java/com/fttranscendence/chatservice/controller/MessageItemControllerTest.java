package com.fttranscendence.chatservice.controller;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.fttranscendence.chatservice.auth.AuthenticationFilter;
import com.fttranscendence.chatservice.exception.ApiException;
import com.fttranscendence.chatservice.grpc.IdentityClient;
import com.fttranscendence.chatservice.model.Message;
import com.fttranscendence.chatservice.service.MessageService;

/**
 * The HTTP surface of /messages/{id}: routing, status codes, JSON shape and
 * error envelope. The service is mocked; its rules are in MessageServiceTest.
 */
@WebMvcTest(MessageItemController.class)
@AutoConfigureMockMvc(addFilters = false) // the filter has its own test; this slice is the controller
class MessageItemControllerTest {

    private static final long ROOM = 42L;
    private static final String USER = "a215c5f8-d810-4518-ad4c-8d551eb6dfc4";
    private static final String MESSAGE_ID = "6a75d60a586b1c7be1750ad3";

    /** A @WebMvcTest slice runs no filters, so the attribute AuthenticationFilter sets is set by hand. */
    private static MockHttpServletRequestBuilder authenticatedGet(String path) {
        return get(path).requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER);
    }

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private MessageService messageService;

    /** @WebMvcTest includes Filter beans, so AuthenticationFilter's dependency must exist. */
    @MockBean
    private IdentityClient identityClient;

    private Message message(String content) {
        return Message.create(ROOM, USER, null, content, "text",
                Instant.parse("2026-09-20T12:56:51.179Z"));
    }

    @Test
    @DisplayName("returns the message in snake_case, the same shape as history")
    void returnsMessageInSnakeCase() throws Exception {
        when(messageService.get(USER, MESSAGE_ID)).thenReturn(message("hello"));

        mockMvc.perform(authenticatedGet("/messages/" + MESSAGE_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("hello"))
                .andExpect(jsonPath("$.room_id").value(42))
                .andExpect(jsonPath("$.sender_id").value(USER))
                .andExpect(jsonPath("$.content_type").value("text"))
                .andExpect(jsonPath("$.created_at").value("2026-09-20T12:56:51.179Z"))
                .andExpect(jsonPath("$.deleted").value(false))
                .andExpect(jsonPath("$.roomId").doesNotExist())
                .andExpect(jsonPath("$.deleted_at").doesNotExist());
    }

    @Test
    @DisplayName("passes the path id and the authenticated user to the service")
    void passesPathIdAndUser() throws Exception {
        when(messageService.get(USER, MESSAGE_ID)).thenReturn(message("hello"));

        mockMvc.perform(authenticatedGet("/messages/" + MESSAGE_ID))
                .andExpect(status().isOk());

        verify(messageService).get(USER, MESSAGE_ID);
    }

    @Test
    @DisplayName("a deleted message is 200 with deleted=true and no content")
    void deletedMessageHidesContent() throws Exception {
        Message deleted = message("secret");
        deleted.markDeleted(Instant.parse("2026-09-20T13:00:00Z"));
        when(messageService.get(USER, MESSAGE_ID)).thenReturn(deleted);

        mockMvc.perform(authenticatedGet("/messages/" + MESSAGE_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(true))
                .andExpect(jsonPath("$.content").doesNotExist());
    }

    @Test
    @DisplayName("MESSAGE_NOT_FOUND comes back as 404 in the spec envelope")
    void notFoundUsesEnvelope() throws Exception {
        when(messageService.get(USER, MESSAGE_ID)).thenThrow(
                ApiException.notFound("MESSAGE_NOT_FOUND", "Message does not exist"));

        mockMvc.perform(authenticatedGet("/messages/" + MESSAGE_ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MESSAGE_NOT_FOUND"))
                .andExpect(jsonPath("$.error.message").value("Message does not exist"));
    }

    @Test
    @DisplayName("INVALID_MESSAGE_ID comes back as 400 in the spec envelope")
    void invalidIdUsesEnvelope() throws Exception {
        when(messageService.get(USER, "junk")).thenThrow(
                ApiException.badRequest("INVALID_MESSAGE_ID", "'id' is not a valid message id"));

        mockMvc.perform(authenticatedGet("/messages/junk"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("INVALID_MESSAGE_ID"));
    }

    @Test
    @DisplayName("org-service down is a 503 ORG_UNAVAILABLE")
    void orgOutageIsServiceUnavailable() throws Exception {
        when(messageService.get(USER, MESSAGE_ID)).thenThrow(new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE, "ORG_UNAVAILABLE", "org-service is unavailable"));

        mockMvc.perform(authenticatedGet("/messages/" + MESSAGE_ID))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error.code").value("ORG_UNAVAILABLE"));
    }

    @Test
    @DisplayName("no authenticated user attribute: fails closed, the service is never called")
    void requiresTheAuthenticatedUserAttribute() throws Exception {
        mockMvc.perform(get("/messages/" + MESSAGE_ID))
                .andExpect(status().is5xxServerError());

        verifyNoInteractions(messageService);
    }

    // ---------------------------------------------------- PATCH /messages/:id

    private static MockHttpServletRequestBuilder authenticatedPatch(String path, String json) {
        return patch(path)
                .requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json);
    }

    private Message edited(String content) {
        Message message = message("original");
        message.applyEdit(content, Instant.parse("2026-09-20T13:00:00Z"));
        return message;
    }

    @Test
    @DisplayName("PATCH returns 200 with the edited message and its edited_at")
    void editReturnsEditedMessage() throws Exception {
        when(messageService.edit(USER, MESSAGE_ID, "fixed")).thenReturn(edited("fixed"));

        mockMvc.perform(authenticatedPatch("/messages/" + MESSAGE_ID, "{\"content\":\"fixed\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("fixed"))
                .andExpect(jsonPath("$.edited_at").value("2026-09-20T13:00:00Z"))
                .andExpect(jsonPath("$.created_at").value("2026-09-20T12:56:51.179Z"))
                .andExpect(jsonPath("$.room_id").value(42));
    }

    @Test
    @DisplayName("PATCH passes the path id, the authenticated user and the new content to the service")
    void editPassesArgumentsThrough() throws Exception {
        when(messageService.edit(USER, MESSAGE_ID, "fixed")).thenReturn(edited("fixed"));

        mockMvc.perform(authenticatedPatch("/messages/" + MESSAGE_ID, "{\"content\":\"fixed\"}"))
                .andExpect(status().isOk());

        verify(messageService).edit(USER, MESSAGE_ID, "fixed");
    }

    @Test
    @DisplayName("PATCH ignores sender_id / room_id in the body: only content can change")
    void editIgnoresOtherBodyFields() throws Exception {
        when(messageService.edit(USER, MESSAGE_ID, "fixed")).thenReturn(edited("fixed"));

        mockMvc.perform(authenticatedPatch("/messages/" + MESSAGE_ID,
                        "{\"content\":\"fixed\",\"sender_id\":\"someone-else\",\"room_id\":7}"))
                .andExpect(status().isOk());

        verify(messageService).edit(USER, MESSAGE_ID, "fixed");
    }

    @Test
    @DisplayName("PATCH with blank content is a 400 VALIDATION_ERROR and never reaches the service")
    void editBlankContentIsRejected() throws Exception {
        mockMvc.perform(authenticatedPatch("/messages/" + MESSAGE_ID, "{\"content\":\"   \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.error.details.content").exists());

        verifyNoInteractions(messageService);
    }

    @Test
    @DisplayName("PATCH without content is a 400 VALIDATION_ERROR")
    void editMissingContentIsRejected() throws Exception {
        mockMvc.perform(authenticatedPatch("/messages/" + MESSAGE_ID, "{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));

        verifyNoInteractions(messageService);
    }

    @Test
    @DisplayName("PATCH content over 4000 characters is rejected; exactly 4000 is accepted")
    void editContentLengthBoundary() throws Exception {
        String atLimit = "x".repeat(4000);
        when(messageService.edit(USER, MESSAGE_ID, atLimit)).thenReturn(edited(atLimit));

        mockMvc.perform(authenticatedPatch("/messages/" + MESSAGE_ID, "{\"content\":\"" + atLimit + "x\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_ERROR"));
        mockMvc.perform(authenticatedPatch("/messages/" + MESSAGE_ID, "{\"content\":\"" + atLimit + "\"}"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("PATCH rejections keep the envelope: NOT_SENDER and EDIT_WINDOW_EXPIRED are 403")
    void editRejectionsUseEnvelope() throws Exception {
        when(messageService.edit(eq(USER), eq(MESSAGE_ID), any())).thenThrow(
                ApiException.forbidden("EDIT_WINDOW_EXPIRED", "Edit window has expired"));

        mockMvc.perform(authenticatedPatch("/messages/" + MESSAGE_ID, "{\"content\":\"late\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("EDIT_WINDOW_EXPIRED"));
    }

    @Test
    @DisplayName("PATCH with malformed JSON is a 400, not a 500")
    void editMalformedJsonIsBadRequest() throws Exception {
        mockMvc.perform(authenticatedPatch("/messages/" + MESSAGE_ID, "{\"content\":"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").exists());

        verifyNoInteractions(messageService);
    }

    @Test
    @DisplayName("an unsupported method on /messages/:id is a 405, not a 500")
    void unsupportedMethodIsMethodNotAllowed() throws Exception {
        mockMvc.perform(put("/messages/" + MESSAGE_ID)
                        .requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"x\"}"))
                .andExpect(status().isMethodNotAllowed());

        verifyNoInteractions(messageService);
    }

    // --------------------------------------------------------------- DELETE

    private static MockHttpServletRequestBuilder authenticatedDelete(String path) {
        return delete(path).requestAttr(AuthenticationFilter.USER_ID_ATTRIBUTE, USER);
    }

    @Test
    @DisplayName("DELETE is a 204 with no body, and the caller comes from the request attribute")
    void deleteReturnsNoContent() throws Exception {
        mockMvc.perform(authenticatedDelete("/messages/" + MESSAGE_ID))
                .andExpect(status().isNoContent())
                .andExpect(content().string(""));

        verify(messageService).delete(USER, MESSAGE_ID);
    }

    @Test
    @DisplayName("DELETE rejections keep the envelope: 403 NOT_ALLOWED, 404 MESSAGE_NOT_FOUND")
    void deleteRejectionsUseEnvelope() throws Exception {
        doThrow(ApiException.forbidden("NOT_ALLOWED", "no"))
                .when(messageService).delete(USER, MESSAGE_ID);
        mockMvc.perform(authenticatedDelete("/messages/" + MESSAGE_ID))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("NOT_ALLOWED"));

        doThrow(ApiException.notFound("MESSAGE_NOT_FOUND", "no"))
                .when(messageService).delete(USER, MESSAGE_ID);
        mockMvc.perform(authenticatedDelete("/messages/" + MESSAGE_ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MESSAGE_NOT_FOUND"));
    }
}
