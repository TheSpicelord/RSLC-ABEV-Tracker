-- Covering indexes on the model tables' join column (dt_regid), so the daily
-- ABEV aggregate seeks instead of scanning. Each INCLUDEs the column(s) that
-- table's bucketing reads (see STATE_MODELS / NATIONAL_BUCKET_SQL in
-- scripts/daily_update.py).
--
-- WHY THIS FILE EXISTS: model tables are static and never updated in place — a
-- refresh arrives as a *brand-new* table. A new table has no index and the
-- pipeline goes slow again, so when you point STATE_MODELS at a new model
-- table, add its index here and re-run this script. Idempotent: existing
-- indexes are left alone. (The AB feed tables are externally owned and are
-- deliberately NOT indexed here.)
--
-- Run against DTODD_RSLC. Build cost observed 2026-08-01: national ~2m30s
-- (227M rows), VA/WI/MI 1-3s each.

-- National fallback model (AK, RI, and any state without its own exchange file)
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_natl_dtregid'
                 AND object_id = OBJECT_ID('dbo.[RSLC DRA June National Audiences and Scores]'))
    CREATE NONCLUSTERED INDEX IX_natl_dtregid
    ON dbo.[RSLC DRA June National Audiences and Scores] (dt_regid)
    INCLUDE ([RSLC Republican Legislative Voters],
             [RSLC Democratic Legislative Voters],
             [RSLC Swing Legislative Voters]);

-- Virginia exchange model
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_VA'
                 AND object_id = OBJECT_ID('dbo.RSLC_VA_R2_Exchange_20250804'))
    CREATE NONCLUSTERED INDEX IX_dtregid_VA
    ON dbo.RSLC_VA_R2_Exchange_20250804 (dt_regid)
    INCLUDE (RepublicanFramework_Flag, DemocratFramework_Flag, PersuasionFramework_Flag);

-- Wisconsin exchange model
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_WI'
                 AND object_id = OBJECT_ID('dbo.RGA_WI_ExchangeData_20260131'))
    CREATE NONCLUSTERED INDEX IX_dtregid_WI
    ON dbo.RGA_WI_ExchangeData_20260131 (dt_regid)
    INCLUDE (universenumber);

-- Michigan US Senate IE model (temporary primary bolt-on)
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_MI'
                 AND object_id = OBJECT_ID('dbo.MI_SEN_IE_R1_Exchange_updated_20260507'))
    CREATE NONCLUSTERED INDEX IX_dtregid_MI
    ON dbo.MI_SEN_IE_R1_Exchange_updated_20260507 (dt_regid)
    INCLUDE (Framework);
