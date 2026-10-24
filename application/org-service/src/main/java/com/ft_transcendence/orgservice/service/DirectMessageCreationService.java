package com.ft_transcendence.orgservice.service;

import com.ft_transcendence.orgservice.dto.RoomResponse;
import com.ft_transcendence.orgservice.exception.NotFoundException;
import com.ft_transcendence.orgservice.model.MemberRole;
import com.ft_transcendence.orgservice.model.RoleName;
import com.ft_transcendence.orgservice.model.Room;
import com.ft_transcendence.orgservice.model.RoomMember;
import com.ft_transcendence.orgservice.model.RoomType;
import com.ft_transcendence.orgservice.model.Role;
import com.ft_transcendence.orgservice.repository.MemberRoleRepository;
import com.ft_transcendence.orgservice.repository.RoleRepository;
import com.ft_transcendence.orgservice.repository.RoomMemberRepository;
import com.ft_transcendence.orgservice.repository.RoomRepository;
import jakarta.transaction.Transactional;
import java.util.UUID;
import java.util.Set;
import org.springframework.context.ApplicationEventPublisher;
import com.ft_transcendence.orgservice.messaging.RoomChange;
import org.springframework.stereotype.Service;

@Service
public class DirectMessageCreationService {

    private final ApplicationEventPublisher events;
    RoleRepository roleRepository;
    RoomRepository roomRepository;
    RoomMemberRepository roomMemberRepository;
    MemberRoleRepository memberRoleRepository;

    public DirectMessageCreationService(RoleRepository roleRepository, RoomRepository roomRepository,
                                        RoomMemberRepository roomMemberRepository, MemberRoleRepository memberRoleRepository,
                                        ApplicationEventPublisher events) {
        this.events = events;
        this.roleRepository = roleRepository;
        this.roomRepository = roomRepository;
        this.roomMemberRepository = roomMemberRepository;
        this.memberRoleRepository = memberRoleRepository;
    }

    // Separate transaction from get-or-create, including its uniqueness-race recovery.
    @Transactional
    public void reopenDirectMessage(Long roomId, UUID userId) {
        roomRepository.findByIdForUpdate(roomId)
                .orElseThrow(() -> new NotFoundException("Room not found"));
        RoomMember member = roomMemberRepository.findByRoomIdAndUserId(roomId, userId)
                .orElseThrow(() -> new NotFoundException("User is not a member of this room"));
        if (member.getHiddenAt() != null) {
            member.setHiddenAt(null);
            roomMemberRepository.save(member);
            events.publishEvent(new RoomChangedEvent(roomId, RoomChange.ROOM_ADDED, Set.of(userId)));
        }
    }

    @Transactional
    public RoomResponse createDirectMessageRoom(UUID dmUser1, UUID dmUser2, UUID creatorId, UUID targetUserId
    ) {
            Room room = new Room();
            room.setType(RoomType.DM);
            room.setDmUser1(dmUser1);
            room.setDmUser2(dmUser2);
            Room savedRoom = roomRepository.saveAndFlush(room);

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
            // Register while the actual creation transaction is active; rollback drops it.
            events.publishEvent(new RoomChangedEvent(savedRoom.getId(),
                    RoomChange.ROOM_ADDED,
                    Set.of(creatorId, targetUserId)));
            return new RoomResponse(savedRoom.getId(), savedRoom.getName(), savedRoom.getDescription(),
            savedRoom.getCreatedAt(), savedRoom.getType(), savedRoom.getUpdatedAt(), 
            savedRoom.getDmUser1().equals(creatorId) ? savedRoom.getDmUser2() : savedRoom.getDmUser1());
    }
}