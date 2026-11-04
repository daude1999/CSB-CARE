-- Create Future Rota for one service user: a build made from their profile names them. Additive and nullable.
ALTER TABLE "RotaBuild" ADD COLUMN "serviceUserId" TEXT;
