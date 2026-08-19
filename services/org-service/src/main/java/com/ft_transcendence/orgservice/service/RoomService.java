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

    @Transactional
    public RoomResponse createRoom(CreateRoomRequest request) {
        if ((request.name() == null || request.name().isBlank())
             && request.type() == RoomType.GROUP) {
            throw new BadRequestException("GROUP rooms must have a non-blank name");
        }
        Room room = new Room();
        room.setName(request.name());
        room.setType(request.type());
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
        roomMember.setUserId(request.creatorId());
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