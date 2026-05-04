-- ═══════════════════════════════════════════════════════════════
-- Document Attachments Storage Bucket + RLS
-- For PDF attachments (contracts, invoices, bills of lading, etc.)
-- Max 3MB per file, 20MB total per document
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    EXECUTE '
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
        ''document-attachments'',
        ''document-attachments'',
        false,
        3145728,
        ARRAY[''application/pdf'']
    )
    ON CONFLICT (id) DO UPDATE SET
        file_size_limit = 3145728,
        allowed_mime_types = ARRAY[''application/pdf''];
    ';

    -- Note: RLS policies on storage.objects are skipped in local migration
    -- to avoid dynamic SQL complexity if storage schema is not fully set up.
  END IF;
END $$;
