package com.ft_transcendence.orgservice.service;

import org.springframework.dao.DataIntegrityViolationException;
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
import com.ft_transcendence.orgservice.dto.UpdateRoomRequest;
import com.ft_transcendence.orgservice.client.IdentityGrpcClient;

@Service
public class RoomService {
    private final RoomRepository roomRepository;
    private final RoomMemberRepository roomMemberRepository;
    private final RoleRepository roleRepository;
    private final MemberRoleRepository memberRoleRepository;
    private final IdentityGrpcClient IdentityGrpcClient;
    private final DirectMessageCreationService directMessageCreationService;

    public RoomService(
            RoomRepository roomRepository, 
            RoomMemberRepository roomMemberRepository, 
            RoleRepository roleRepository, 
            MemberRoleRepository memberRoleRepository,
            IdentityGrpcClient IdentityGrpcClient,
            DirectMessageCreationService directMessageCreationService
    ) {
        this.roomRepository = roomRepository;
        this.roomMemberRepository = roomMemberRepository;
        this.roleRepository = roleRepository;
        this.memberRoleRepository = memberRoleRepository;
        this.IdentityGrpcClient = IdentityGrpcClient;
        this.directMessageCreationService = directMessageCreationService;
    }

    public List<RoomResponse> getDirectMessageRoomsByUserId(UUID userId) {
        List<RoomMember> roomMembers = roomMemberRepository.findByUserId(userId);
        return roomMembers.stream()
                .filter(roomMember -> roomMember.getRoom().getType() == RoomType.DM)
                .map(roomMember -> {
                    Room room = roomMember.getRoom();
                    UUID otherUserId = room.getDmUser1().equals(userId) ? room.getDmUser2() : room.getDmUser1();
                    return new RoomResponse(
                            room.getId(),
                            room.getName(),
                            room.getCreatedAt(),
                            room.getType(),
                            room.getUpdatedAt(),
                            otherUserId
                    );
                })
                .toList();
    }

    private boolean isOwner(Long roomId, UUID userId) {
        return memberRoleRepository.existsByRoomMemberRoomIdAndRoomMemberUserIdAndRoleName(
                roomId,
                userId,
                RoleName.OWNER
        );
    }

    public List<RoleName> getRolesByRoomId(Long roomId, UUID userId) {
        if (roomRepository.findById(roomId).isEmpty() || !isUserInRoom(roomId, userId)) {
            throw new NotFoundException("Room not found with id: " + roomId);
        }
        List<Role> roles = roleRepository.findByRoomId(roomId);
        return roles.stream()
                .map(Role::getName)
                .toList();
    }

    @Transactional
    public void markRoomAsRead(Long roomId, UUID userId) {
        RoomMember roomMember = roomMemberRepository
                .findByRoomIdAndUserId(roomId, userId)
                .orElseThrow(() ->
                        new NotFoundException(
                                "User is not a member of this room"
                        )
                );

        roomMember.setLastReadAt(java.time.Instant.now());
        roomMemberRepository.save(roomMember);
    }

    @Transactional
    public void updateMemberRole(Long roomId, UUID targetUserId, RoleName newRoleName, UUID actorId) {
        if (roomRepository.findById(roomId).isEmpty() || !isUserInRoom(roomId, actorId)) {
            throw new NotFoundException("Room not found with id: " + roomId);
        }

        if (!isOwner(roomId, actorId)) {
            throw new ForbiddenException("User does not have permission to update member roles in this room");
        }

        if (newRoleName == RoleName.OWNER) {
            throw new BadRequestException("Cannot assign OWNER role to a member");
        }

        RoomMember targetRoomMember = roomMemberRepository
                .findByRoomIdAndUserId(roomId, targetUserId)
                .orElseThrow(() ->
                        new NotFoundException(
                                "Target user is not a member of this room"
                        )
                );

        Role newRole = roleRepository
                .findByRoomIdAndName(roomId, newRoleName)
                .orElseThrow(() ->
                        new NotFoundException(
                                "Role not found in this room"
                        )
                );

        MemberRole memberRole = memberRoleRepository
                .findByRoomMember(targetRoomMember)
                .orElseThrow(() ->
                        new IllegalStateException(
                                "Target user has no role assigned in this room"
                        )
                );

        if (memberRole.getRole().getName() == RoleName.OWNER) {
            throw new ForbiddenException("Cannot change the role of the OWNER");
        }

        if (memberRole.getRole().getName() == newRoleName) {
            throw new BadRequestException("New role is the same as the current role");
        }

        memberRole.setRole(newRole);
        memberRoleRepository.save(memberRole);
    }

    @Transactional
    public RoomResponse updateRoom(Long roomId, UpdateRoomRequest request, UUID userId) {
        Room room = roomRepository.findById(roomId)
                .orElseThrow(() -> new NotFoundException("Room not found with id: " + roomId));

        if (!isUserInRoom(roomId, userId)) {
            throw new NotFoundException("Room not found with id: " + roomId);
        }

        if (!canManageMembers(roomId, userId) && room.getType() == RoomType.GROUP) {
            throw new ForbiddenException("User does not have permission to update this room");
        }

        if (room.getName() != null && room.getName().equals(request.name())) {
            throw new BadRequestException("New room name is the same as the current name");
        }

        room.setName(request.name());

        return new RoomResponse(
                room.getId(),
                room.getName(),
                room.getCreatedAt(),
                room.getType(),
                room.getUpdatedAt(),
                room.getType() == RoomType.DM ? room.getDmUser1().equals(userId) ? room.getDmUser2() : room.getDmUser1() : null
        );
    }

    public List<MemberResponse> getMembersByRoomId(Long roomId, UUID userId) {
        if (roomRepository.findById(roomId).isEmpty() || !isUserInRoom(roomId, userId)) {
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

    private boolean canDeleteRoom(Long roomId, UUID userId, Room room) {
        
        if (room.getType() == RoomType.DM) {
            return true; // DM rooms can be deleted by any member
        }

        return memberRoleRepository.existsByRoomMemberRoomIdAndRoomMemberUserIdAndRoleName(
                roomId,
                userId,
                RoleName.OWNER
        );
    }

    @Transactional
    public void deleteRoom(Long roomId, UUID userId) {
        Room room = roomRepository.findById(roomId)
                .orElseThrow(() -> new NotFoundException("Room not found with id: " + roomId));

        if (!isUserInRoom(roomId, userId)) {
            throw new NotFoundException("Room not found with id: " + roomId);
        }

        if (!canDeleteRoom(roomId, userId, room)) {
            throw new ForbiddenException("User does not have permission to delete this room");
        }

        List<RoomMember> roomMembers = roomMemberRepository.findByRoomId(roomId);
        for (RoomMember roomMember : roomMembers) {
            memberRoleRepository.deleteAllByRoomMember(roomMember);
        }

        roomMemberRepository.deleteAll(roomMembers);

        roleRepository.deleteAllByRoomId(roomId);

        roomRepository.delete(room);
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

        leaveRoom(roomId, targetUserId);
    }

    @Transactional
    public void leaveRoom(Long roomId, UUID userId) {
        RoomMember roomMember = roomMemberRepository
                .findByRoomIdAndUserId(roomId, userId)
                .orElseThrow(() ->
                        new NotFoundException(
                                "User is not a member of this room"
                        )
                );
        
        boolean removeRoom = false;

        if (memberRoleRepository
                .existsByRoomMemberRoomIdAndRoomMemberUserIdAndRoleName(
                        roomId,
                        userId,
                        RoleName.OWNER
                )) {
                        if (roomMemberRepository.countByRoomId(roomId) > 1) {
                            throw new ForbiddenException("Owner cannot leave the room while there are other members.");
                        }
                        removeRoom = true;
        }
        memberRoleRepository.deleteAllByRoomMember(roomMember);
        roomMemberRepository.delete(roomMember);
        if (removeRoom) {
            deleteRoom(roomId, userId);
        }
    }

    @Transactional
    public void addMember(Long roomId, UUID actorId, UUID targetUserId) {

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

        if (!IdentityGrpcClient.userExists(targetUserId)) {
                throw new NotFoundException("Target user not found with id: " + targetUserId);
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
                .filter(roomMember -> roomMember.getRoom().getType() != RoomType.DM) // Exclude DM rooms
                .map(roomMember -> new RoomResponse(roomMember.getRoom().getId(), 
                            roomMember.getRoom().getName(), roomMember.getRoom().getCreatedAt(),
                            roomMember.getRoom().getType(), roomMember.getRoom().getUpdatedAt(),
                            null))
                .toList();
    }

    public boolean isUserInRoom(Long roomId, UUID userId) {
        return roomMemberRepository.existsByRoomIdAndUserId(roomId, userId);
    }

    /**
     * The user's role in the room, empty if they are not a member.
     * chat-service uses it to let OWNER/ADMIN delete other members' messages.
     */
    @Transactional(readOnly = true)
    public Optional<RoleName> findRoleInRoom(Long roomId, UUID userId) {
        return roomMemberRepository.findByRoomIdAndUserId(roomId, userId)
                .flatMap(memberRoleRepository::findByRoomMember)
                .map(memberRole -> memberRole.getRole().getName());
    }

    public RoomResponse getRoomById(Long roomId, UUID userId) {
        Room room = roomRepository.findById(roomId).orElseThrow(()
        -> new NotFoundException("Room not found with id: " + roomId));
        if (!isUserInRoom(roomId, userId)) {
            throw new ForbiddenException("User does not have permission to access this room");
        }
        return new RoomResponse(room.getId(), room.getName(), room.getCreatedAt(), room.getType(), room.getUpdatedAt(),
                room.getType() == RoomType.DM ? room.getDmUser1().equals(userId) ? room.getDmUser2() : room.getDmUser1() : null);
    }

    public RoomResponse createDirectMessageRoom(UUID creatorId, UUID targetUserId) {
        if (creatorId.equals(targetUserId)) {
            throw new BadRequestException("Cannot create a direct message room with yourself");
        }

        UUID dmUser1;
        UUID dmUser2;

        if (creatorId.compareTo(targetUserId) < 0) {
            dmUser1 = creatorId;
            dmUser2 = targetUserId;
        } else {
            dmUser1 = targetUserId;
            dmUser2 = creatorId;
        }

        Optional<Room> isExistingRoom =
        roomRepository.findByTypeAndDmUser1AndDmUser2(
                RoomType.DM,
                dmUser1,
                dmUser2
        );

        if (isExistingRoom.isPresent()) {
            Room room = isExistingRoom.get();

            return new RoomResponse(
                    room.getId(),
                    room.getName(),
                    room.getCreatedAt(),
                    room.getType(),
                    room.getUpdatedAt(),
                    room.getDmUser1().equals(creatorId) ? room.getDmUser2() : room.getDmUser1()
            );
        }

        if (!IdentityGrpcClient.userExists(targetUserId)) {
            throw new NotFoundException("Target user not found with id: " + targetUserId);
        }

        try 
        {
            return directMessageCreationService.createDirectMessageRoom(
                    dmUser1,
                    dmUser2,
                    creatorId,
                    targetUserId
            );
        }
        catch (DataIntegrityViolationException e)
        {
            Room existingRoom = roomRepository
                    .findByTypeAndDmUser1AndDmUser2(
                            RoomType.DM,
                            dmUser1,
                            dmUser2
                    )
                    .orElseThrow(() -> e);

            return new RoomResponse(
                    existingRoom.getId(),
                    existingRoom.getName(),
                    existingRoom.getCreatedAt(),
                    existingRoom.getType(),
                    existingRoom.getUpdatedAt(),
                    existingRoom.getDmUser1().equals(creatorId) ? existingRoom.getDmUser2() : existingRoom.getDmUser1()
            );
        }
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
            , savedRoom.getType(), savedRoom.getUpdatedAt(), null);
    }
}