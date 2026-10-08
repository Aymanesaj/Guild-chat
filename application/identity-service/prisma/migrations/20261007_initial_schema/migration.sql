CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "username" VARCHAR(32) NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" VARCHAR(100),
  "display_name" VARCHAR(80) NOT NULL,
  "bio" VARCHAR(280),
  "avatar_url" TEXT,
  "auth_provider" TEXT NOT NULL DEFAULT 'LOCAL',
  "oauth_provider_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refresh_tokens" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked" BOOLEAN NOT NULL DEFAULT false,
  "replaced_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- pair_key is added and backfilled by the following migration.
CREATE TABLE "friendships" (
  "id" UUID NOT NULL,
  "requester_id" UUID NOT NULL,
  "addressee_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uk_users_username" ON "users"("username");
CREATE UNIQUE INDEX "uk_users_email" ON "users"("email");
CREATE UNIQUE INDEX "uk_users_oauth" ON "users"("auth_provider", "oauth_provider_id");
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_key" ON "refresh_tokens"("replaced_by");
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens"("user_id");
CREATE INDEX "idx_friendships_requester_status" ON "friendships"("requester_id", "status");
CREATE INDEX "idx_friendships_addressee_status" ON "friendships"("addressee_id", "status");

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_fkey"
  FOREIGN KEY ("replaced_by") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_fkey"
  FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_fkey"
  FOREIGN KEY ("addressee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
