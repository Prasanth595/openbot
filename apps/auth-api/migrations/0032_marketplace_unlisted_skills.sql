-- An unlisted skill stays out of the Skills catalog and installs only through a listing that pins it.
ALTER TABLE marketplace_skills ADD COLUMN unlisted INTEGER NOT NULL DEFAULT 0 CHECK(unlisted IN (0, 1));
