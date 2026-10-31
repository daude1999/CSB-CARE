-- Employer on-cost assumption for rota cost estimates (additive, default 0).
ALTER TABLE "FinanceSettings" ADD COLUMN "estimateOnCostPercent" INTEGER NOT NULL DEFAULT 0;
