/*
  Warnings:

  - The `role` column on the `user` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "user" DROP COLUMN "role",
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'user';

-- DropEnum
DROP TYPE "ROLE";
