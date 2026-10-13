-- A skill version can install other approved skill versions with it, as `[{skillId, versionId}]`.
-- Only the curated catalog publication writes it.
ALTER TABLE marketplace_skill_versions ADD COLUMN includes_json TEXT NOT NULL DEFAULT '[]';
