-- TSUGU Core vNext / G0-01
-- v21/v22 physical D1 provenance diagnosis: READ ONLY.
-- Allowed statements in this file are SELECT and read-only PRAGMA only.
-- Do not add UPDATE/INSERT/DELETE/ALTER/CREATE/DROP/VACUUM/REINDEX or write PRAGMA.
-- Execute separately against each authorized physical D1 and label the captured output v21 or v22.

-- A. database/schema identity (provider physical database ID must be captured outside SQL from authorized metadata)
PRAGMA database_list;
PRAGMA foreign_keys;
SELECT type, name, tbl_name
FROM sqlite_master
WHERE type IN ('table','index')
ORDER BY type, name;

-- B. expected current schema shape
PRAGMA table_info('projects');
PRAGMA table_info('revisions');
PRAGMA table_info('original_files');
PRAGMA table_info('deletion_jobs');
PRAGMA table_info('proposals');
PRAGMA table_info('evidences');
PRAGMA table_info('evidence_versions');
PRAGMA table_info('evidence_uploads');

-- C. verify absence/presence of project foreign keys on Evidence tables
PRAGMA foreign_key_list('evidences');
PRAGMA foreign_key_list('evidence_versions');
PRAGMA foreign_key_list('evidence_uploads');

-- D. table counts
SELECT 'projects' AS table_name, COUNT(*) AS row_count FROM projects
UNION ALL SELECT 'revisions', COUNT(*) FROM revisions
UNION ALL SELECT 'original_files', COUNT(*) FROM original_files
UNION ALL SELECT 'deletion_jobs', COUNT(*) FROM deletion_jobs
UNION ALL SELECT 'proposals', COUNT(*) FROM proposals
UNION ALL SELECT 'evidences', COUNT(*) FROM evidences
UNION ALL SELECT 'evidence_versions', COUNT(*) FROM evidence_versions
UNION ALL SELECT 'evidence_uploads', COUNT(*) FROM evidence_uploads;

-- E. owner lineage counts without publishing complete owner values
SELECT 'projects' AS table_name, COUNT(DISTINCT owner) AS distinct_owner_count FROM projects
UNION ALL SELECT 'revisions', COUNT(DISTINCT owner) FROM revisions
UNION ALL SELECT 'original_files', COUNT(DISTINCT owner) FROM original_files
UNION ALL SELECT 'proposals', COUNT(DISTINCT owner) FROM proposals
UNION ALL SELECT 'evidences', COUNT(DISTINCT owner) FROM evidences
UNION ALL SELECT 'evidence_versions', COUNT(DISTINCT owner) FROM evidence_versions
UNION ALL SELECT 'evidence_uploads', COUNT(DISTINCT owner) FROM evidence_uploads;

-- F. owner distribution. Prefix is diagnostic only; never publish the complete owner value.
SELECT 'projects' AS table_name,
       CASE WHEN owner LIKE 'email:%' THEN substr(owner,1,18)||'…' ELSE substr(owner,1,12)||'…' END AS owner_prefix,
       COUNT(*) AS row_count
FROM projects GROUP BY owner
UNION ALL
SELECT 'revisions', CASE WHEN owner LIKE 'email:%' THEN substr(owner,1,18)||'…' ELSE substr(owner,1,12)||'…' END, COUNT(*)
FROM revisions GROUP BY owner
UNION ALL
SELECT 'evidences', CASE WHEN owner LIKE 'email:%' THEN substr(owner,1,18)||'…' ELSE substr(owner,1,12)||'…' END, COUNT(*)
FROM evidences GROUP BY owner
UNION ALL
SELECT 'evidence_versions', CASE WHEN owner LIKE 'email:%' THEN substr(owner,1,18)||'…' ELSE substr(owner,1,12)||'…' END, COUNT(*)
FROM evidence_versions GROUP BY owner
UNION ALL
SELECT 'evidence_uploads', CASE WHEN owner LIKE 'email:%' THEN substr(owner,1,18)||'…' ELSE substr(owner,1,12)||'…' END, COUNT(*)
FROM evidence_uploads GROUP BY owner
ORDER BY table_name, owner_prefix;

-- G. project/revision integrity
SELECT COUNT(*) AS revisions_without_project
FROM revisions r LEFT JOIN projects p ON p.id=r.project_id
WHERE p.id IS NULL;

SELECT r.project_id, COUNT(*) AS revision_rows
FROM revisions r LEFT JOIN projects p ON p.id=r.project_id
WHERE p.id IS NULL
GROUP BY r.project_id
ORDER BY r.project_id;

-- H. Evidence orphan diagnosis
SELECT COUNT(*) AS evidences_without_project
FROM evidences e LEFT JOIN projects p ON p.id=e.project_id
WHERE p.id IS NULL;

SELECT e.project_id,
       COUNT(*) AS evidence_rows,
       COUNT(DISTINCT e.owner) AS evidence_owner_lineages
FROM evidences e LEFT JOIN projects p ON p.id=e.project_id
WHERE p.id IS NULL
GROUP BY e.project_id
ORDER BY e.project_id;

SELECT COUNT(*) AS versions_without_evidence
FROM evidence_versions v LEFT JOIN evidences e ON e.id=v.evidence_id
WHERE e.id IS NULL;

SELECT COUNT(*) AS uploads_without_evidence
FROM evidence_uploads u LEFT JOIN evidences e ON e.id=u.evidence_id
WHERE e.id IS NULL;

-- I. Cross-table owner mismatch for rows whose parent exists
SELECT COUNT(*) AS evidence_parent_owner_mismatch
FROM evidences e JOIN projects p ON p.id=e.project_id
WHERE e.owner<>p.owner;

SELECT COUNT(*) AS version_evidence_owner_mismatch
FROM evidence_versions v JOIN evidences e ON e.id=v.evidence_id
WHERE v.owner<>e.owner OR v.project_id<>e.project_id;

SELECT COUNT(*) AS upload_evidence_owner_mismatch
FROM evidence_uploads u JOIN evidences e ON e.id=u.evidence_id
WHERE u.owner<>e.owner OR u.project_id<>e.project_id;

-- J. Evidence R2 readback input inventory. object_key is storage routing data; handle output as restricted evidence.
-- Capture it only in the authorized diagnostic record, not in public PR prose if unnecessary.
SELECT v.project_id,
       v.id AS version_id,
       v.evidence_id,
       v.version_no,
       v.byte_size,
       v.sha256,
       v.storage_state,
       v.object_key
FROM evidence_versions v
ORDER BY v.project_id, v.evidence_id, v.version_no;

-- K. Project inventory without body or complete owner
SELECT id,
       name,
       revision,
       updated_at,
       CASE WHEN owner LIKE 'email:%' THEN substr(owner,1,18)||'…' ELSE substr(owner,1,12)||'…' END AS owner_prefix
FROM projects
ORDER BY updated_at DESC, id;
