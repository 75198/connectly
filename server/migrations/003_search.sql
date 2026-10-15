CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX users_search_trgm ON users USING gin ((lower(username) || ' ' || lower(display_name)) gin_trgm_ops);
CREATE INDEX posts_body_trgm ON posts USING gin (lower(body) gin_trgm_ops);
