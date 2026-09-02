-- ============================================================================
--  HOUSE LOOT — 0005  ITEM PHOTO STORAGE
-- ============================================================================
--  The reel is mostly images. Without this, `items.image_url` stays NULL and
--  every card renders a placeholder, which is the difference between a case
--  opening and a spreadsheet.
--
--  Uploads go through an admin-gated route handler using the service role, so
--  the browser never writes to storage directly and no anon insert policy is
--  needed. Reads are public: the images are pictures of a sofa, and a signed
--  URL per card would add a round trip to every reel frame for no benefit.
--
--  Guarded by to_regclass so this migration is a no-op on a plain Postgres —
--  `npm run verify:sql` runs against PGlite, which has no `storage` schema.
-- ============================================================================

DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema not present (non-Supabase Postgres) - skipping';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'item-images', 'item-images', TRUE,
    5242880,                                        -- 5 MB; we downscale client-side anyway
    ARRAY['image/jpeg','image/png','image/webp']
  )
  ON CONFLICT (id) DO UPDATE
    SET public             = EXCLUDED.public,
        file_size_limit    = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  -- Public read. Idempotent: policies have no IF NOT EXISTS before PG15 on all
  -- installs, so drop first.
  DROP POLICY IF EXISTS item_images_public_read ON storage.objects;
  CREATE POLICY item_images_public_read
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'item-images');

  -- No INSERT/UPDATE/DELETE policy for anon or authenticated, deliberately.
  -- service_role bypasses RLS, so the admin upload route still works while the
  -- browser cannot write, rename or delete a single object.
  DROP POLICY IF EXISTS item_images_anon_write ON storage.objects;

  RAISE NOTICE 'item-images bucket ready';
END
$storage$;
