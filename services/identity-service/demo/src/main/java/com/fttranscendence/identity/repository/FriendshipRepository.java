package com.fttranscendence.identity.repository;

import com.fttranscendence.identity.model.FriendshipEntity;
import com.fttranscendence.identity.model.FriendshipStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FriendshipRepository extends JpaRepository<FriendshipEntity, UUID> {
	Optional<FriendshipEntity> findByRequesterIdAndAddresseeId(UUID requesterId, UUID addresseeId);

	@Query("""
		select f from FriendshipEntity f
		where (f.requesterId = :userA and f.addresseeId = :userB)
		   or (f.requesterId = :userB and f.addresseeId = :userA)
		""")
	Optional<FriendshipEntity> findBetween(@Param("userA") UUID userA, @Param("userB") UUID userB);

	@Query("""
		select f from FriendshipEntity f
		where (f.requesterId = :userId or f.addresseeId = :userId)
		  and f.status = :status
		""")
	List<FriendshipEntity> findAllForUserWithStatus(
		@Param("userId") UUID userId,
		@Param("status") FriendshipStatus status
	);

	@Query("""
		select f from FriendshipEntity f
		where (f.requesterId = :userId or f.addresseeId = :userId)
		  and f.status = com.fttranscendence.identity.model.FriendshipStatus.ACCEPTED
		""")
	List<FriendshipEntity> findAllAcceptedForUser(@Param("userId") UUID userId);
}
