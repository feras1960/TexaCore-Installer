-- ═══════════════════════════════════════════════════
-- AI SQL Agent: Secure read-only query execution
-- ═══════════════════════════════════════════════════

-- Function to execute read-only SQL queries for AI analysis
-- Security: Only SELECT/WITH, no mutations, 5s timeout, 500 row limit
CREATE OR REPLACE FUNCTION public.execute_readonly_query(query_text TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '5000'
AS $$
DECLARE
  result JSON;
  clean_query TEXT;
BEGIN
  -- Security: Normalize and validate
  clean_query := LOWER(TRIM(query_text));
  
  -- Only allow SELECT and WITH (CTE) statements
  IF NOT (clean_query LIKE 'select%' OR clean_query LIKE 'with%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;
  
  -- Block any mutation keywords
  IF clean_query ~ '\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute|copy|pg_)\b' THEN
    RAISE EXCEPTION 'Mutation or system queries are not allowed';
  END IF;
  
  -- Execute with row limit
  EXECUTE 'SELECT COALESCE(json_agg(t), ''[]''::json) FROM (' || query_text || ' LIMIT 500) t' INTO result;
  
  RETURN result;
END;
$$;

-- Grant access to service_role only (Edge Functions use this)
REVOKE ALL ON FUNCTION public.execute_readonly_query(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_readonly_query(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.execute_readonly_query(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.execute_readonly_query(TEXT) TO service_role;

-- Function to get database schema for AI context
CREATE OR REPLACE FUNCTION public.get_schema_info()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(json_build_object(
    'table', t.table_name,
    'columns', (
      SELECT json_agg(json_build_object(
        'name', c.column_name,
        'type', c.data_type,
        'nullable', c.is_nullable
      ) ORDER BY c.ordinal_position)
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t.table_name
    )
  ) ORDER BY t.table_name)
  INTO result
  FROM information_schema.tables t
  WHERE t.table_schema = 'public' 
    AND t.table_type = 'BASE TABLE'
    AND t.table_name NOT LIKE 'pg_%'
    AND t.table_name NOT LIKE '_%;';
  
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_schema_info() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_schema_info() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_schema_info() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_schema_info() TO authenticated;
