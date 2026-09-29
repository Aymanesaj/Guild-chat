package com.fttranscendence.identity.repository;

import com.fttranscendence.identity.model.RefreshTokenEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RefreshTokenRepository extends JpaRepository<RefreshTokenEntity, UUID> {
	Optional<RefreshTokenEntity> findByTokenHash(String tokenHash);

	@Modifying
	@Query("update RefreshTokenEntity r set r.revoked = true where r.userId = :userId and r.revoked = false")
	int revokeAllForUser(@Param("userId") UUID userId);
}
