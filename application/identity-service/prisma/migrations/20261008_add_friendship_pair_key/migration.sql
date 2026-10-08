BEGIN;


ALTER TABLE friendships
ADD COLUMN IF NOT EXISTS pair_key VARCHAR(73);



UPDATE friendships
SET pair_key =
    LEAST(
        LOWER(requester_id::text),
        LOWER(addressee_id::text)
    )
    || ':' ||
    GREATEST(
        LOWER(requester_id::text),
        LOWER(addressee_id::text)
    )
WHERE pair_key IS NULL;


DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM friendships
        GROUP BY pair_key
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate friendship pairs exist. Resolve them before enforcing pair_key uniqueness.';
    END IF;
END
$$;

ALTER TABLE friendships
ALTER COLUMN pair_key SET NOT NULL;

ALTER TABLE friendships
DROP CONSTRAINT IF EXISTS uk_friendships_pair;

ALTER TABLE friendships
ADD CONSTRAINT uk_friendships_pair
UNIQUE (pair_key);


COMMIT;