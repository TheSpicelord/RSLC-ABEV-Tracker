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
-- (227M rows), VA/WI/MI 1-3s each. The state tables added 2026-09-01 (NV, AZ,
-- GA, NJ, TX, IA, OR and the WI/MI refreshes) are all in the low millions of
-- rows and build in seconds; TX is the largest at ~18.6M.

-- National fallback model (RI, NC, and any state without its own exchange file).
-- NC deliberately has no index of its own here: it has no usable state model (see
-- STATE_MODELS in daily_update.py) and rides this one.
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

-- Wisconsin exchange model (Aug 2026 refresh; buckets on Framework)
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_WI'
                 AND object_id = OBJECT_ID('dbo.RSLC_WI_Exchange_20260819'))
    CREATE NONCLUSTERED INDEX IX_dtregid_WI
    ON dbo.RSLC_WI_Exchange_20260819 (dt_regid)
    INCLUDE (Framework, universenumber);

-- Michigan exchange model (R2 refresh; buckets on Framework)
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_MI'
                 AND object_id = OBJECT_ID('dbo.RSLC_MI_R2_Exchange_20260805'))
    CREATE NONCLUSTERED INDEX IX_dtregid_MI
    ON dbo.RSLC_MI_R2_Exchange_20260805 (dt_regid)
    INCLUDE (Framework, universenumber);

-- Nevada governor IE model
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_NV'
                 AND object_id = OBJECT_ID('dbo.NV_GOV_IE_R1_Exchange_20260105'))
    CREATE NONCLUSTERED INDEX IX_dtregid_NV
    ON dbo.NV_GOV_IE_R1_Exchange_20260105 (dt_regid)
    INCLUDE (universenumber);

-- Arizona exchange model
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_AZ'
                 AND object_id = OBJECT_ID('dbo.RGA_AZ_R2_Exchange_20260121'))
    CREATE NONCLUSTERED INDEX IX_dtregid_AZ
    ON dbo.RGA_AZ_R2_Exchange_20260121 (dt_regid)
    INCLUDE (universenumber);

-- Georgia exchange model (9 universes; Dem base 8-9)
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_GA'
                 AND object_id = OBJECT_ID('dbo.RSLC_GA_Exchange_20260721'))
    CREATE NONCLUSTERED INDEX IX_dtregid_GA
    ON dbo.RSLC_GA_Exchange_20260721 (dt_regid)
    INCLUDE (universenumber);

-- New Jersey transfer model (9 universes; bases 1-3 / 7-9)
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_NJ'
                 AND object_id = OBJECT_ID('dbo.RSLC_NJ_Transfer_20250712'))
    CREATE NONCLUSTERED INDEX IX_dtregid_NJ
    ON dbo.RSLC_NJ_Transfer_20250712 (dt_regid)
    INCLUDE (universenumber);

-- Texas support audiences (varchar '1'/'0' flags)
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_TX'
                 AND object_id = OBJECT_ID('dbo.RSLC_TX_Scores_TurnoutSupportAudiences_20260601'))
    CREATE NONCLUSTERED INDEX IX_dtregid_TX
    ON dbo.RSLC_TX_Scores_TurnoutSupportAudiences_20260601 (dt_regid)
    INCLUDE ([RSLC TX Strong Republican Supporters],
             [RSLC TX Soft Republican Supporters],
             [RSLC TX Strong Democrat Supporters],
             [RSLC TX Soft Democrat Supporters]);

-- Iowa scores/audiences
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_IA'
                 AND object_id = OBJECT_ID('dbo.ia_scores_audiences_20260731'))
    CREATE NONCLUSTERED INDEX IX_dtregid_IA
    ON dbo.ia_scores_audiences_20260731 (dt_regid)
    INCLUDE (framework_lahn, framework_sand);

-- Oregon audience flags. Note the uppercase join column in this table.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_OR'
                 AND object_id = OBJECT_ID('dbo.or_audience_flags_20200727'))
    CREATE NONCLUSTERED INDEX IX_dtregid_OR
    ON dbo.or_audience_flags_20200727 (DT_REGID)
    INCLUDE (state_leg_ballot_rep_audience, state_leg_ballot_dem_audience);

-- Pennsylvania exchange model
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_PA'
                 AND object_id = OBJECT_ID('dbo.PA_RSLC_R1_Exchange_20260418'))
    CREATE NONCLUSTERED INDEX IX_dtregid_PA
    ON dbo.PA_RSLC_R1_Exchange_20260418 (dt_regid)
    INCLUDE (UniverseNumber);

-- Alaska DSP model (Sullivan/Peltola 2026 Senate; AK primary + general lean).
-- Note the non-dbo schema (vs).
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_dtregid_AK'
                 AND object_id = OBJECT_ID('vs.ak_scores_audiences_20260721'))
    CREATE NONCLUSTERED INDEX IX_dtregid_AK
    ON vs.ak_scores_audiences_20260721 (dt_regid)
    INCLUDE (framework);
