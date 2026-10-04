package com.fttranscendence.identity.grpc;

import com.fttranscendence.identity.exception.ApiRequestException;
import com.fttranscendence.identity.model.UserEntity;
import com.fttranscendence.identity.repository.UserRepository;
import com.fttranscendence.identity.security.JwtService;
import com.fttranscendence.identity.service.FriendService;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import java.util.Optional;
import java.util.UUID;
import net.devh.boot.grpc.server.service.GrpcService;

@GrpcService
public class IdentityGrpcService extends IdentityServiceGrpc.IdentityServiceImplBase {

	private final JwtService jwtService;
	private final UserRepository userRepository;
	private final FriendService friendService;

	public IdentityGrpcService(JwtService jwtService, UserRepository userRepository, FriendService friendService) {
		this.jwtService = jwtService;
		this.userRepository = userRepository;
		this.friendService = friendService;
	}

	@Override
	public void validateToken(ValidateTokenRequest request, StreamObserver<ValidateTokenResponse> responseObserver) {
		ValidateTokenResponse.Builder builder = ValidateTokenResponse.newBuilder().setValid(false);
		Optional<UUID> userId = jwtService.validate(request.getToken());
		if (userId.isPresent()) {
			UserEntity user = userRepository.findById(userId.get()).orElse(null);
			if (user != null) {
				builder.setValid(true)
					.setUserId(user.getId().toString())
					.setUsername(user.getUsername())
					.setEmail(user.getEmail());
			}
		}
		responseObserver.onNext(builder.build());
		responseObserver.onCompleted();
	}

	@Override
	public void getUser(GetUserRequest request, StreamObserver<UserResponse> responseObserver) {
		try {
			UUID id = UUID.fromString(request.getUserId());
			UserEntity user = userRepository.findById(id)
				.orElseThrow(() -> new ApiRequestException(org.springframework.http.HttpStatus.NOT_FOUND, "User not found"));
			responseObserver.onNext(UserResponse.newBuilder()
				.setUserId(user.getId().toString())
				.setUsername(user.getUsername())
				.setDisplayName(user.getDisplayName() == null ? "" : user.getDisplayName())
				.setAvatarUrl(user.getAvatarUrl() == null ? "" : user.getAvatarUrl())
				.build());
			responseObserver.onCompleted();
		} catch (ApiRequestException e) {
			responseObserver.onError(Status.NOT_FOUND.withDescription(e.getMessage()).asRuntimeException());
		} catch (IllegalArgumentException e) {
			responseObserver.onError(Status.INVALID_ARGUMENT.withDescription("Invalid user id").asRuntimeException());
		}
	}

	@Override
	public void areFriends(AreFriendsRequest request, StreamObserver<AreFriendsResponse> responseObserver) {
		try {
			UUID a = UUID.fromString(request.getUserA());
			UUID b = UUID.fromString(request.getUserB());
			boolean friends = friendService.areFriends(a, b);
			responseObserver.onNext(AreFriendsResponse.newBuilder().setAreFriends(friends).build());
			responseObserver.onCompleted();
		} catch (IllegalArgumentException e) {
			responseObserver.onError(Status.INVALID_ARGUMENT.withDescription("Invalid user id").asRuntimeException());
		}
	}
}
