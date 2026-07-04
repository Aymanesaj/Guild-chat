package com.fttranscendence.identity.repository;

import com.fttranscendence.identity.model.AuthProvider;
import com.fttranscendence.identity.model.UserEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<UserEntity, UUID> {
	boolean existsByUsernameIgnoreCase(String username);

	boolean existsByEmailIgnoreCase(String email);

	Optional<UserEntity> findByEmailIgnoreCase(String email);

	Optional<UserEntity> findByUsernameIgnoreCase(String username);

	Optional<UserEntity> findByAuthProviderAndOauthProviderId(AuthProvider authProvider, String oauthProviderId);
}
