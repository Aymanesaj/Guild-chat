package com.ft_transcendence.orgservice.grpc;

import io.grpc.stub.StreamObserver;
import org.springframework.stereotype.Service;
import com.ft_transcendence.orgservice.service.RoomService;
import com.fttranscendence.org.grpc.CheckMembershipRequest;
import com.fttranscendence.org.grpc.CheckMembershipResponse;
import com.fttranscendence.org.grpc.GetRoomRequest;
import com.fttranscendence.org.grpc.ListRoomMembersRequest;
import com.fttranscendence.org.grpc.ListRoomMembersResponse;
import com.fttranscendence.org.grpc.ListUserRoomsRequest;
import com.fttranscendence.org.grpc.ListUserRoomsResponse;
import com.fttranscendence.org.grpc.MemberResponse;
import com.fttranscendence.org.grpc.OrgServiceGrpc;
import com.fttranscendence.org.grpc.CreateRoomRequest;
import com.fttranscendence.org.grpc.RoomResponse;
import java.util.UUID;
import java.util.List;

@Service
public class OrgGrpcService extends OrgServiceGrpc.OrgServiceImplBase {

    private final RoomService roomService;

    public OrgGrpcService(RoomService roomService) {
        this.roomService = roomService;
    }

    @Override
    public void checkMembership(
            CheckMembershipRequest request,
            StreamObserver<CheckMembershipResponse> responseObserver) {

        Long roomId = Long.parseLong(request.getRoomId());
        UUID userId = UUID.fromString(request.getUserId());

        boolean isMember = roomService.isUserInRoom(roomId, userId);

        CheckMembershipResponse.Builder response =
                CheckMembershipResponse.newBuilder()
                        .setIsMember(isMember);

        // role stays "" (the proto default) for a non-member
        if (isMember) {
            roomService.findRoleInRoom(roomId, userId)
                    .ifPresent(role -> response.setRole(role.name()));
        }

        responseObserver.onNext(response.build());
        responseObserver.onCompleted();
    }

    @Override
    public void getRoom(
            GetRoomRequest request,
            StreamObserver<RoomResponse> responseObserver) {

        Long roomId = Long.parseLong(request.getRoomId());
        UUID userId = UUID.fromString(request.getUserId());

        com.ft_transcendence.orgservice.dto.RoomResponse room =
                roomService.getRoomById(roomId, userId);

        RoomResponse.Builder response = RoomResponse.newBuilder()
                .setId(room.id().toString())
                .setName(room.name())
                .setCreatedAt(room.createdAt().toString())
                .setType(room.type().name())
                .setUpdatedAt(room.updatedAt().toString());
        if (room.description() != null) {
            response.setDescription(room.description());
        }

        responseObserver.onNext(response.build());
        responseObserver.onCompleted();
    }

    @Override
    public void listUserRooms(
            ListUserRoomsRequest request,
            StreamObserver<ListUserRoomsResponse> responseObserver) {

        UUID userId = UUID.fromString(request.getUserId());

        List<com.ft_transcendence.orgservice.dto.RoomResponse> rooms =
                roomService.getRoomsByUserId(userId);

        ListUserRoomsResponse.Builder response =
                ListUserRoomsResponse.newBuilder();

        for (var room : rooms) {
            RoomResponse.Builder roomResponse = RoomResponse.newBuilder()
                    .setId(room.id().toString())
                    .setName(room.name())
                    .setCreatedAt(room.createdAt().toString())
                    .setType(room.type().name())
                    .setUpdatedAt(room.updatedAt().toString());
            if (room.description() != null) {
                roomResponse.setDescription(room.description());
            }
            response.addRooms(roomResponse.build());
        }

        responseObserver.onNext(response.build());
        responseObserver.onCompleted();
    }

    @Override
    public void listRoomMembers(
            ListRoomMembersRequest request,
            StreamObserver<ListRoomMembersResponse> responseObserver) {

        Long roomId = Long.parseLong(request.getRoomId());
        UUID userId = UUID.fromString(request.getUserId());

        List<com.ft_transcendence.orgservice.dto.MemberResponse> members =
                roomService.getMembersByRoomId(roomId, userId);

        ListRoomMembersResponse.Builder response =
                ListRoomMembersResponse.newBuilder();

        for (var member : members) {
            response.addMembers(
                    MemberResponse.newBuilder()
                            .setUserId(member.userId().toString())
                            .setRole(member.role().name())
                            .build()
            );
        }

        responseObserver.onNext(response.build());
        responseObserver.onCompleted();
    }

    @Override
    public void createRoom(
            CreateRoomRequest request,
            StreamObserver<RoomResponse> responseObserver) {

        UUID creatorId = UUID.fromString(request.getCreatorId());

        com.ft_transcendence.orgservice.dto.CreateRoomRequest roomRequest =
                new com.ft_transcendence.orgservice.dto.CreateRoomRequest(
                        request.getName(),
                        request.hasDescription() ? request.getDescription() : null
                );

        com.ft_transcendence.orgservice.dto.RoomResponse room =
                roomService.createRoom(roomRequest, creatorId);

        RoomResponse.Builder response = RoomResponse.newBuilder()
                .setId(room.id().toString())
                .setName(room.name())
                .setCreatedAt(room.createdAt().toString())
                .setType(room.type().name())
                .setUpdatedAt(room.updatedAt().toString());
        if (room.description() != null) {
            response.setDescription(room.description());
        }

        responseObserver.onNext(response.build());
        responseObserver.onCompleted();
    }
}