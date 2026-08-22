package com.ft_transcendence.orgservice.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.ft_transcendence.orgservice.repository.RoomRepository;
import com.ft_transcendence.orgservice.dto.CreateRoomRequest;
import com.ft_transcendence.orgservice.dto.RoomResponse;
import com.ft_transcendence.orgservice.model.RoomType;
import com.ft_transcendence.orgservice.model.Room;
import com.ft_transcendence.orgservice.exception.BadRequestException;
import com.ft_transcendence.orgservice.repository.RoomMemberRepository;
import com.ft_transcendence.orgservice.repository.RoleRepository;
import com.ft_transcendence.orgservice.repository.MemberRoleRepository;
import com.ft_transcendence.orgservice.model.Role;
import com.ft_transcendence.orgservice.model.RoleName;
import com.ft_transcendence.orgservice.model.RoomMember;
import com.ft_transcendence.orgservice.model.MemberRole;
import com.ft_transcendence.orgservice.exception.NotFoundException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import com.ft_transcendence.orgservice.exception.ForbiddenException;
import com.ft_transcendence.orgservice.dto.MemberResponse;

@Service
public class RoomService {
    private final RoomRepository roomRepository;
    private final RoomMemberRepository roomMemberRepository;
    private final RoleRepository roleRepository;
    private final MemberRoleRepository memberRoleRepository;

    public RoomService(
            RoomRepository roomRepository, 
            RoomMemberRepository roomMemberRepository, 
            RoleRepository roleRepository, 
            MemberRoleRepository memberRoleRepository
    ) {
        this.roomRepository = roomRepository;
        this.roomMemberRepository = roomMemberRepository;
        this.roleRepository = roleRepository;
        this.memberRoleRepository = memberRoleRepository;
    }

    public List<MemberResponse> getMembersByRoomId(Long roomId, UUID userId) {
        if (!isUserInRoom(roomId, userId) || roomRepository.findById(roomId).isEmpty()) {
            // 404 Not Found is more appropriate than 403 Forbidden in this case, as the user should not be able to determine whether the room exists or not if they are not a member. However, since the requirement specifies to return 403 Forbidden, we will follow that.
            throw new NotFoundException("Room not found with id: " + roomId);
        }
        List<RoomMember> roomMembers = roomMemberRepository.findByRoomId(roomId);
        List<MemberRole> memberRoles = memberRoleRepository.findByRoomMemberRoomId(roomId);
        return roomMembers.stream()
        .map(roomMember -> {

            RoleName role = memberRoles.stream()
                    .filter(memberRole ->
                            memberRole.getRoomMember().getId()
                                    .equals(roomMember.getId())
                    )
                    .map(memberRole -> memberRole.getRole().getName())
                    .findFirst()
                    .orElseThrow(() ->
                            new IllegalStateException(
                                    "Member has no role assigned"
                            )
                    );

            return new MemberResponse(
                    roomMember.getUserId(),
                    role
            );
        })
        .toList();
    }

    @Transactional
    public void removeMember(Long roomId, UUID actorId, UUID targetUserId) {
        
        roomRepository.findById(roomId)
                .orElseThrow(() ->
                        new NotFoundException("Room not found with id: " + roomId)
                );

        if (!isUserInRoom(roomId, actorId)) {
            throw new NotFoundException("Room not found with id: " + roomId);
        }

        if (!canManageMembers(roomId, actorId)) {
            throw new ForbiddenException(
                    "User does not have permission to remove members from this room"
            );
        }

        RoomMember targetRoomMember = roomMemberRepository
                .findByRoomIdAndUserId(roomId, targetUserId)
                .orElseThrow(() ->
                        new NotFoundException(
                                "Target user is not a member of this room"
                        )
                );

        if (memberRoleRepository
                .existsByRoomMemberRoomIdAndRoomMemberUserIdAndRoleName(
                        roomId,
                        targetUserId,
                        RoleName.OWNER
                )) {
            throw new ForbiddenException("Cannot remove the owner of the room");
        }
        memberRoleRepository.deleteAllByRoomMember(targetRoomMember);
        roomMemberRepository.delete(targetRoomMember);
    }

    @Transactional
    public void addMember(Long roomId, UUID actorId, UUID targetUserId) {
        
        // check if target user with that id exists in identity service
        // ... later, for now we assume the user exists

        Room room = roomRepository.findById(roomId)
                .orElseThrow(() ->
                        new NotFoundException("Room not found with id: " + roomId)
                );

        if (!isUserInRoom(roomId, actorId)) {
            throw new NotFoundException("Room not found with id: " + roomId);
        }

        if (!canManageMembers(roomId, actorId)) {
            throw new ForbiddenException(
                    "User does not have permission to add members to this room"
            );
        }

        if (isUserInRoom(roomId, targetUserId)) {
            throw new BadRequestException(
                    "Target user is already a member of this room"
            );
        }

        Role memberRole = roleRepository
                .findByRoomIdAndName(roomId, RoleName.MEMBER)
                .orElseThrow(() ->
                        new IllegalStateException(
                                "MEMBER role not found for room: " + roomId
                        )
                );

        RoomMember roomMember = new RoomMember();
        roomMember.setRoom(room);
        roomMember.setUserId(targetUserId);
        roomMemberRepository.save(roomMember);

        MemberRole memberRoleAssignment = new MemberRole();
        memberRoleAssignment.setRoomMember(roomMember);
        memberRoleAssignment.setRole(memberRole);
        memberRoleRepository.save(memberRoleAssignment);
    }

    private boolean canManageMembers(Long roomId, UUID userId) {
        return memberRoleRepository.existsByRoomMemberRoomIdAndRoomMemberUserIdAndRoleNameIn(
                roomId,
                userId,
                List.of(RoleName.ADMIN, RoleName.OWNER)
        );
    }

    public List<RoomResponse> getRoomsByUserId(UUID userId) {
        List<RoomMember> roomMembers = roomMemberRepository.findByUserId(userId);
        return roomMembers.stream()
                .map(roomMember -> new RoomResponse(roomMember.getRoom().getId(), roomMember.getRoom().getName(), roomMember.getRoom().getCreatedAt(), roomMember.getRoom().getType(), roomMember.getRoom().getUpdatedAt()))
                .toList();
    }

    public boolean isUserInRoom(Long roomId, UUID userId) {
        return roomMemberRepository.existsByRoomIdAndUserId(roomId, userId);
    }

    public RoomResponse getRoomById(Long roomId, UUID userId) {
        Room room = roomRepository.findById(roomId).orElseThrow(()
        -> new NotFoundException("Room not found with id: " + roomId));
        if (!isUserInRoom(roomId, userId)) {
            throw new ForbiddenException("User does not have permission to access this room");
        }
        return new RoomResponse(room.getId(), room.getName(), room.getCreatedAt(), room.getType(), room.getUpdatedAt());
    }

    @Transactional
    public RoomResponse createDirectMessageRoom(UUID creatorId, UUID targetUserId) {
        if (creatorId.equals(targetUserId)) {
            throw new BadRequestException("Cannot create a direct message room with yourself");
        }

        Optional<Room> existingRoom =
        roomRepository.findDirectMessageRoomBetweenUsers(
                creatorId,
                targetUserId
        );

        if (existingRoom.isPresent()) {
            Room room = existingRoom.get();

            return new RoomResponse(
                    room.getId(),
                    room.getName(),
                    room.getCreatedAt(),
                    room.getType(),
                    room.getUpdatedAt()
            );
        }

        Room room = new Room();
        room.setType(RoomType.DM);
        Room savedRoom = roomRepository.save(room);

        Role memberRole = new Role();
        memberRole.setRoom(savedRoom);
        memberRole.setName(RoleName.MEMBER);
        roleRepository.save(memberRole);

        RoomMember creatorRoomMember = new RoomMember();
        creatorRoomMember.setRoom(savedRoom);
        creatorRoomMember.setUserId(creatorId);
        RoomMember savedCreatorRoomMember = roomMemberRepository.save(creatorRoomMember);

        RoomMember targetRoomMember = new RoomMember();
        targetRoomMember.setRoom(savedRoom);
        targetRoomMember.setUserId(targetUserId);
        RoomMember savedTargetRoomMember = roomMemberRepository.save(targetRoomMember);

        // Assign the MEMBER role to the creator of the room
        MemberRole creatorRoleAssignment = new MemberRole();
        creatorRoleAssignment.setRoomMember(savedCreatorRoomMember);
        creatorRoleAssignment.setRole(memberRole);
        memberRoleRepository.save(creatorRoleAssignment);

        // Assign the MEMBER role to the target user
        MemberRole targetRoleAssignment = new MemberRole();
        targetRoleAssignment.setRoomMember(savedTargetRoomMember);
        targetRoleAssignment.setRole(memberRole);
        memberRoleRepository.save(targetRoleAssignment);

        return new RoomResponse(savedRoom.getId(), savedRoom.getName(), savedRoom.getCreatedAt(), savedRoom.getType(), savedRoom.getUpdatedAt());
    }

    @Transactional
    public RoomResponse createRoom(CreateRoomRequest request, UUID creatorId) {
        Room room = new Room();
        room.setName(request.name());
        room.setType(RoomType.GROUP);
        Room savedRoom = roomRepository.save(room);
        
        // Create default roles for the room
        // Create ADMIN role
        Role adminRole = new Role();
        adminRole.setRoom(savedRoom);
        adminRole.setName(RoleName.ADMIN);
        roleRepository.save(adminRole);
        // Create OWNER role
        Role ownerRole = new Role();
        ownerRole.setRoom(savedRoom);
        ownerRole.setName(RoleName.OWNER);
        roleRepository.save(ownerRole);
        // Create MEMBER role
        Role memberRole = new Role();
        memberRole.setRoom(savedRoom);
        memberRole.setName(RoleName.MEMBER);
        roleRepository.save(memberRole);

        // Create default room member for the creator of the room
        RoomMember roomMember = new RoomMember();
        roomMember.setRoom(savedRoom);
        roomMember.setUserId(creatorId);
        RoomMember savedRoomMember = roomMemberRepository.save(roomMember);

        // Assign the OWNER role to the creator of the room
        MemberRole memberRoleAssignment = new MemberRole();
        memberRoleAssignment.setRoomMember(savedRoomMember);
        memberRoleAssignment.setRole(ownerRole);
        memberRoleRepository.save(memberRoleAssignment);

        return new RoomResponse(savedRoom.getId(), savedRoom.getName(), savedRoom.getCreatedAt()
            , savedRoom.getType(), savedRoom.getUpdatedAt());
    }
}