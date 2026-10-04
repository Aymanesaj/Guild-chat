package com.fttranscendence.identity.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
	name = "friendships",
	uniqueConstraints = {
		@UniqueConstraint(name = "uk_friendships_pair", columnNames = {"requester_id", "addressee_id"})
	},
	indexes = {
		@Index(name = "idx_friendships_requester", columnList = "requester_id"),
		@Index(name = "idx_friendships_addressee", columnList = "addressee_id")
	}
)
public class FriendshipEntity {
	@Id
	@GeneratedValue(strategy = GenerationType.UUID)
	private UUID id;

	@Column(name = "requester_id", nullable = false)
	private UUID requesterId;

	@Column(name = "addressee_id", nullable = false)
	private UUID addresseeId;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 16)
	private FriendshipStatus status = FriendshipStatus.PENDING;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt;

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt;

	@PrePersist
	void prePersist() {
		Instant now = Instant.now();
		createdAt = now;
		updatedAt = now;
	}

	@PreUpdate
	void preUpdate() {
		updatedAt = Instant.now();
	}

	public UUID getId() {
		return id;
	}

	public UUID getRequesterId() {
		return requesterId;
	}

	public void setRequesterId(UUID requesterId) {
		this.requesterId = requesterId;
	}

	public UUID getAddresseeId() {
		return addresseeId;
	}

	public void setAddresseeId(UUID addresseeId) {
		this.addresseeId = addresseeId;
	}

	public FriendshipStatus getStatus() {
		return status;
	}

	public void setStatus(FriendshipStatus status) {
		this.status = status;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}
}
