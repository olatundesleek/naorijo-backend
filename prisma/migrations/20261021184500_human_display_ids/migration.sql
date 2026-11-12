ALTER TABLE "User" ADD COLUMN "displayId" TEXT;
ALTER TABLE "Company" ADD COLUMN "displayId" TEXT;
ALTER TABLE "Product" ADD COLUMN "displayId" TEXT;
ALTER TABLE "Batch" ADD COLUMN "displayId" TEXT;
ALTER TABLE "Item" ADD COLUMN "displayId" TEXT;

WITH numbered AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS row_number FROM "User"
)
UPDATE "User" AS target
SET "displayId" = 'US' || LPAD(numbered.row_number::TEXT, 12, '0')
FROM numbered
WHERE target."id" = numbered."id";

WITH numbered AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS row_number FROM "Company"
)
UPDATE "Company" AS target
SET "displayId" = 'CO' || LPAD(numbered.row_number::TEXT, 12, '0')
FROM numbered
WHERE target."id" = numbered."id";

WITH numbered AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS row_number FROM "Product"
)
UPDATE "Product" AS target
SET "displayId" = 'PI' || LPAD(numbered.row_number::TEXT, 12, '0')
FROM numbered
WHERE target."id" = numbered."id";

WITH numbered AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS row_number FROM "Batch"
)
UPDATE "Batch" AS target
SET "displayId" = 'BA' || LPAD(numbered.row_number::TEXT, 12, '0')
FROM numbered
WHERE target."id" = numbered."id";

WITH numbered AS (
    SELECT "id", ROW_NUMBER() OVER (ORDER BY "id") AS row_number FROM "Item"
)
UPDATE "Item" AS target
SET "displayId" = 'IT' || LPAD(numbered.row_number::TEXT, 12, '0')
FROM numbered
WHERE target."id" = numbered."id";

ALTER TABLE "User" ALTER COLUMN "displayId" SET NOT NULL;
ALTER TABLE "Company" ALTER COLUMN "displayId" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "displayId" SET NOT NULL;
ALTER TABLE "Batch" ALTER COLUMN "displayId" SET NOT NULL;
ALTER TABLE "Item" ALTER COLUMN "displayId" SET NOT NULL;

CREATE UNIQUE INDEX "User_displayId_key" ON "User"("displayId");
CREATE UNIQUE INDEX "Company_displayId_key" ON "Company"("displayId");
CREATE UNIQUE INDEX "Product_displayId_key" ON "Product"("displayId");
CREATE UNIQUE INDEX "Batch_displayId_key" ON "Batch"("displayId");
CREATE UNIQUE INDEX "Item_displayId_key" ON "Item"("displayId");
