-- 007_audit_logging.sql
-- Audit logging for Access Vault. Entries hold ids only, never names or content.
-- The database writes most events itself (triggers), so users cannot forge them.
-- Safe to re-run.

-- 1. Table rules --------------------------------------------------------------
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action IN ('REGISTER','LOGIN','CREATE_FOLDER','UPLOAD','DOWNLOAD','DELETE','SHARE','REVOKE','CHANGE_ROLE'));
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_details_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_details_check CHECK (
  details IS NULL OR jsonb_typeof(details) = 'object');

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_time     ON public.audit_logs (user_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_time ON public.audit_logs (resource_id, "timestamp" DESC);

-- Clients can only read (SELECT stays granted; no insert, update or delete).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated, anon;

-- 2. Internal writer (not callable from the app) ---------------------------------
CREATE OR REPLACE FUNCTION public.write_audit(
  p_user uuid, p_action text, p_type text, p_id uuid, p_details jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  -- Skip if the user no longer exists (for example during account deletion).
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE user_id = p_user) THEN
    RETURN;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, resource_type, resource_id, details)
  VALUES (p_user, p_action, p_type, p_id, p_details);
EXCEPTION WHEN OTHERS THEN
  -- An audit failure must never block the real action.
  RAISE WARNING 'audit write failed: %', SQLERRM;
END
$fn$;
REVOKE ALL ON FUNCTION public.write_audit(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 3. Triggers: events the database can see by itself -------------------------------
CREATE OR REPLACE FUNCTION public.trg_audit_users() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM public.write_audit(NEW.user_id, 'REGISTER', NULL, NULL, NULL);
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION public.trg_audit_shares() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_audit(NEW.shared_by, 'SHARE', NEW.resource_type, NEW.resource_id,
      jsonb_build_object('share_id', NEW.share_id, 'recipient_id', NEW.shared_with,
                         'level', NEW.level, 'expires_at', NEW.expires_at));
  ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    PERFORM public.write_audit(NEW.shared_by, 'REVOKE', NEW.resource_type, NEW.resource_id,
      jsonb_build_object('share_id', NEW.share_id, 'recipient_id', NEW.shared_with));
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION public.trg_audit_files() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.write_audit(OLD.owner_id, 'DELETE', 'file', OLD.file_id,
      jsonb_build_object('folder_id', OLD.folder_id));
  ELSE
    PERFORM public.write_audit(NEW.owner_id, 'UPLOAD', 'file', NEW.file_id,
      jsonb_build_object('folder_id', NEW.folder_id, 'size', NEW.size, 'chunk_count', NEW.chunk_count));
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION public.trg_audit_folders() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.write_audit(OLD.owner_id, 'DELETE', 'folder', OLD.folder_id,
      jsonb_build_object('parent_id', OLD.parent_id));
  ELSIF NEW.parent_id IS NOT NULL THEN   -- the vault root is part of REGISTER
    PERFORM public.write_audit(NEW.owner_id, 'CREATE_FOLDER', 'folder', NEW.folder_id,
      jsonb_build_object('parent_id', NEW.parent_id));
  END IF;
  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION public.trg_audit_users(), public.trg_audit_shares(),
  public.trg_audit_files(), public.trg_audit_folders() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_users          ON public.users;
DROP TRIGGER IF EXISTS audit_shares         ON public.shares;
DROP TRIGGER IF EXISTS audit_files_upload   ON public.files;
DROP TRIGGER IF EXISTS audit_files_delete   ON public.files;
DROP TRIGGER IF EXISTS audit_folders_create ON public.folders;
DROP TRIGGER IF EXISTS audit_folders_delete ON public.folders;

CREATE TRIGGER audit_users AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_users();
CREATE TRIGGER audit_shares AFTER INSERT OR UPDATE OF revoked_at ON public.shares
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_shares();
CREATE TRIGGER audit_files_upload AFTER UPDATE OF status ON public.files
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM 'complete' AND NEW.status = 'complete')
  EXECUTE FUNCTION public.trg_audit_files();
CREATE TRIGGER audit_files_delete AFTER DELETE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_files();
CREATE TRIGGER audit_folders_create AFTER INSERT ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_folders();
CREATE TRIGGER audit_folders_delete AFTER DELETE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_folders();

-- 4. log_event: for events only the browser can see (LOGIN, DOWNLOAD) ---------------
CREATE OR REPLACE FUNCTION public.log_event(
  p_action text, p_resource_id uuid DEFAULT NULL, p_resource_type text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_folder uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  IF p_action = 'LOGIN' THEN
    PERFORM public.write_audit(v_uid, 'LOGIN', NULL, NULL, NULL);

  ELSIF p_action = 'DOWNLOAD' THEN
    IF p_resource_type IS DISTINCT FROM 'file' OR p_resource_id IS NULL THEN
      RAISE EXCEPTION 'invalid_resource';
    END IF;
    SELECT f.folder_id INTO v_folder
    FROM public.files f
    WHERE f.file_id = p_resource_id AND f.status = 'complete'
      AND (f.owner_id = v_uid OR public.has_folder_access(f.folder_id));
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    PERFORM public.write_audit(v_uid, 'DOWNLOAD', 'file', p_resource_id,
      jsonb_build_object('folder_id', v_folder));

  ELSE
    RAISE EXCEPTION 'action_not_allowed';
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.log_event(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_event(text, uuid, text) TO authenticated;

-- 5. get_audit_log: what the Activity screen reads ----------------------------------
-- Returns entries the caller may see: their own actions, and anything done to
-- resources they own. Adds the actor's and recipient's display names.
CREATE OR REPLACE FUNCTION public.get_audit_log(
  p_limit integer DEFAULT 50, p_before timestamptz DEFAULT NULL, p_resource_id uuid DEFAULT NULL)
RETURNS TABLE (
  log_id uuid, occurred_at timestamptz, action text,
  actor_id uuid, actor_name text, is_me boolean,
  resource_id uuid, resource_type text, recipient_name text, details jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  RETURN QUERY
  SELECT a.log_id, a."timestamp", a.action,
         a.user_id, COALESCE(u.name, 'Unknown'), (a.user_id = auth.uid()),
         a.resource_id, a.resource_type, r.name, a.details
  FROM public.audit_logs a
  LEFT JOIN public.users u ON u.user_id = a.user_id
  LEFT JOIN public.users r ON r.user_id = NULLIF(a.details->>'recipient_id', '')::uuid
  WHERE (a.user_id = auth.uid()
         OR (a.resource_id IS NOT NULL AND public.owns_resource(a.resource_id, a.resource_type)))
    AND (p_before IS NULL OR a."timestamp" < p_before)
    AND (p_resource_id IS NULL OR a.resource_id = p_resource_id)
  ORDER BY a."timestamp" DESC, a.log_id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END
$fn$;
REVOKE ALL ON FUNCTION public.get_audit_log(integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_audit_log(integer, timestamptz, uuid) TO authenticated;
