-- 006_hardening.sql
-- Findings from the 2026-11-05 Supabase health check. Idempotent; safe to re-run.

-- 1. Every signed-in user could read every row of public.users (including
--    salt and wrapped_private_key). The app only reads the caller's own row
--    (supabaseAuthApi.login filters by user_id) and uses RPCs for lookups.
DROP POLICY IF EXISTS "Enable read access for all users" ON public.users;

-- 2. Policies should not apply to anon / "public" roles.
--    (Optional tidy: restrict own-row policies to authenticated.)
ALTER POLICY "Users can view own profile"   ON public.users TO authenticated;
ALTER POLICY "Users can update own profile" ON public.users TO authenticated;

-- 3. Tables: anon needs nothing; authenticated must not write audit_logs directly.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated;

-- 4. RLS helper functions are not needed by anon.
--    (get_auth_params stays callable by anon: login needs it before sign-in.)
REVOKE EXECUTE ON FUNCTION public.has_active_share(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.owns_resource(uuid, text)   FROM anon, public;

-- 5. file_chunks has three identical unique indexes; keep one.
DROP INDEX IF EXISTS public.file_chunks_file_chunk_unique;
DROP INDEX IF EXISTS public.file_chunks_unique_index;
-- (file_chunks_file_id_chunk_index_key backs a constraint, so it stays.)

-- 6. Cheap performance wins: indexes on unindexed foreign keys.
CREATE INDEX IF NOT EXISTS idx_files_owner_id        ON public.files (owner_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id     ON public.folders (parent_id);
CREATE INDEX IF NOT EXISTS idx_envelopes_recipient   ON public.key_envelopes (recipient_id);
CREATE INDEX IF NOT EXISTS idx_shares_shared_by      ON public.shares (shared_by);
CREATE INDEX IF NOT EXISTS idx_shares_shared_with    ON public.shares (shared_with);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON public.audit_logs (user_id);
