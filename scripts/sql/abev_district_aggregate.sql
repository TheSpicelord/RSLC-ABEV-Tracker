-- ABEV district-level aggregation template.
--
-- This is a TEMPLATE to be finalized once we confirm the real column names in
-- dbo.General_Absentees_2026 and the model tables. Placeholders marked <...>.
--
-- Design goals:
--   * All aggregation happens server-side; only ~7k summary rows come back.
--   * No individual-level data ever leaves the SQL server.
--   * State model score is used when available, else national model (COALESCE).
--
-- Expected output columns:
--   state_fips, chamber ('house'|'senate'), district_id,
--   stat ('requested'|'sent'|'returned'|'ev'),
--   bucket ('rep'|'dem'|'toss'), n
--
-- Bucket thresholds (adjust as needed):
--   score >= 65  -> 'rep'
--   score <= 35  -> 'dem'
--   otherwise    -> 'toss'   (includes voters with no model score)

WITH scored AS (
    SELECT
        a.<voter_key>                                   AS voter_key,
        a.<state_fips_col>                              AS state_fips,
        a.<hd_col>                                      AS hd,       -- state house district
        a.<sd_col>                                      AS sd,       -- state senate district
        a.<request_date_col>                            AS requested_date,
        a.<sent_date_col>                               AS sent_date,
        a.<return_date_col>                             AS returned_date,
        a.<early_vote_date_col>                         AS ev_date,
        COALESCE(sm.<state_score_col>, nm.<natl_score_col>) AS gop_score
    FROM dbo.General_Absentees_2026 a
    LEFT JOIN <state_model_table> sm ON sm.<voter_key> = a.<voter_key>
    LEFT JOIN <national_model_table> nm ON nm.<voter_key> = a.<voter_key>
),
bucketed AS (
    SELECT
        *,
        CASE
            WHEN gop_score >= 65 THEN 'rep'
            WHEN gop_score <= 35 THEN 'dem'
            ELSE 'toss'
        END AS bucket
    FROM scored
),
events AS (
    SELECT state_fips, hd, sd, bucket, 'requested' AS stat FROM bucketed WHERE requested_date IS NOT NULL
    UNION ALL
    SELECT state_fips, hd, sd, bucket, 'sent'      FROM bucketed WHERE sent_date IS NOT NULL
    UNION ALL
    SELECT state_fips, hd, sd, bucket, 'returned'  FROM bucketed WHERE returned_date IS NOT NULL
    UNION ALL
    SELECT state_fips, hd, sd, bucket, 'ev'        FROM bucketed WHERE ev_date IS NOT NULL
)
SELECT state_fips, 'house' AS chamber, hd AS district_id, stat, bucket, COUNT(*) AS n
FROM events
WHERE hd IS NOT NULL
GROUP BY state_fips, hd, stat, bucket

UNION ALL

SELECT state_fips, 'senate' AS chamber, sd AS district_id, stat, bucket, COUNT(*) AS n
FROM events
WHERE sd IS NOT NULL
GROUP BY state_fips, sd, stat, bucket

UNION ALL

-- Statewide totals (district can be NULL/unmatched, so these are authoritative)
SELECT state_fips, 'statewide' AS chamber, NULL AS district_id, stat, bucket, COUNT(*) AS n
FROM events
GROUP BY state_fips, stat, bucket;
