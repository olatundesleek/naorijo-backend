ALTER TABLE "User"
ADD COLUMN "firstName" TEXT,
ADD COLUMN "middleName" TEXT,
ADD COLUMN "lastName" TEXT;

WITH split_names AS (
    SELECT
        "id",
        regexp_split_to_array(trim("name"), '\s+') AS parts
    FROM "User"
)
UPDATE "User" AS users
SET
    "firstName" = split_names.parts[1],
    "middleName" = CASE
        WHEN cardinality(split_names.parts) > 2
        THEN array_to_string(split_names.parts[2:cardinality(split_names.parts) - 1], ' ')
        ELSE NULL
    END,
    "lastName" = CASE
        WHEN cardinality(split_names.parts) > 1
        THEN split_names.parts[cardinality(split_names.parts)]
        ELSE split_names.parts[1]
    END
FROM split_names
WHERE users."id" = split_names."id";

ALTER TABLE "User"
ALTER COLUMN "firstName" SET NOT NULL,
ALTER COLUMN "lastName" SET NOT NULL,
DROP COLUMN "name";
