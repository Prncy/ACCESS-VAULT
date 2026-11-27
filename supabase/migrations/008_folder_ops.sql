-- 008_folder_ops.sql
-- Folder rename and recursive deletion for Access Vault.
-- Run after 007_audit_logging.sql. Safe to re-run.
--
-- Delete is two steps because Storage objects must be removed while file rows
-- still exist:
--   1. get_folder_files(folder) -> list files in the folder tree; the app removes
--      their encrypted chunks from the private "chunks" Storage bucket.
--   2. delete_folder(folder) -> revokes shares, removes key grants, then deletes
--      the folder tree. Database cascades remove descendant folders, files and
--      chunk metadata. DELETE audit entries are written by triggers from 007.
--
-- Rename: rename_folder(folder, encrypted name). The app encrypts the new name
-- with the folder's own key before calling this function.
--
-- IMPORTANT: Storage bytes are deleted by the app through the Supabase Storage
-- API, not by this SQL migration.

-- 1. List files inside a folder tree (owner only) ----------------------------

CREATE OR REPLACE FUNCTION public.get_folder_files(p_folder_id uuid)
RETURNS TABLE (file_id uuid, chunk_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.folders
    WHERE folder_id = p_folder_id
      AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  RETURN QUERY
  WITH RECURSIVE tree AS (
    SELECT fo.folder_id
    FROM public.folders fo
    WHERE fo.folder_id = p_folder_id

    UNION ALL

    SELECT child.folder_id
    FROM public.folders child
    JOIN tree parent_tree
      ON child.parent_id = parent_tree.folder_id
  )
  SELECT f.file_id, f.chunk_count
  FROM public.files f
  WHERE f.folder_id IN (SELECT tree.folder_id FROM tree);
END
$fn$;

REVOKE ALL ON FUNCTION public.get_folder_files(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_folder_files(uuid) TO authenticated;


-- 2. Delete a folder and everything under it -------------------------------

CREATE OR REPLACE FUNCTION public.delete_folder(p_folder_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_parent uuid;
  v_tree uuid[];
  v_files uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  SELECT parent_id
  INTO v_parent
  FROM public.folders
  WHERE folder_id = p_folder_id
    AND owner_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'cannot_delete_root';
  END IF;

  WITH RECURSIVE tree AS (
    SELECT fo.folder_id
    FROM public.folders fo
    WHERE fo.folder_id = p_folder_id

    UNION ALL

    SELECT child.folder_id
    FROM public.folders child
    JOIN tree parent_tree
      ON child.parent_id = parent_tree.folder_id
  )
  SELECT array_agg(tree.folder_id)
  INTO v_tree
  FROM tree;

  SELECT COALESCE(array_agg(f.file_id), '{}')
  INTO v_files
  FROM public.files f
  WHERE f.folder_id = ANY (v_tree);

  -- Mark active shares as revoked first. Migration 007 records REVOKE events
  -- when revoked_at changes from NULL to a timestamp.
  UPDATE public.shares
  SET revoked_at = now()
  WHERE revoked_at IS NULL
    AND (
      (resource_type = 'folder' AND resource_id = ANY (v_tree))
      OR
      (resource_type = 'file' AND resource_id = ANY (v_files))
    );

  -- Remove wrapped keys and share rows after revocation has been audited.
  DELETE FROM public.key_envelopes
  WHERE
    (resource_type = 'folder' AND resource_id = ANY (v_tree))
    OR
    (resource_type = 'file' AND resource_id = ANY (v_files));

  DELETE FROM public.shares
  WHERE
    (resource_type = 'folder' AND resource_id = ANY (v_tree))
    OR
    (resource_type = 'file' AND resource_id = ANY (v_files));

  -- Cascades to descendant folders, files and file_chunks according to the
  -- existing foreign-key rules. The 007 triggers write DELETE audit entries.
  DELETE FROM public.folders
  WHERE folder_id = p_folder_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_folder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_folder(uuid) TO authenticated;


-- 3. Rename a folder --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rename_folder(
  p_folder_id uuid,
  p_name_enc text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_parent uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in';
  END IF;

  IF p_name_enc IS NULL
     OR length(p_name_enc) = 0
     OR length(p_name_enc) > 2000 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;

  SELECT parent_id
  INTO v_parent
  FROM public.folders
  WHERE folder_id = p_folder_id
    AND owner_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'cannot_rename_root';
  END IF;

  UPDATE public.folders
  SET name_enc = p_name_enc,
      updated_at = now()
  WHERE folder_id = p_folder_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.rename_folder(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_folder(uuid, text) TO authenticated;
