'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitStatements, targetsSchema } = require('../scripts/lib/sql-split');

test('splits on top-level semicolons only', () => {
  const sql = `SELECT 1; -- a ; in a comment
SELECT 'a;b'; /* block ; */ SELECT "x;y" FROM t;
CREATE FUNCTION f() RETURNS int AS $f$ BEGIN RETURN 1; END; $f$ LANGUAGE plpgsql;
DO $$ BEGIN PERFORM 1; END $$;
SELECT E'it\\'s;fine';`;
  const parts = splitStatements(sql);
  assert.equal(parts.length, 6);
  assert.match(parts[2], /SELECT "x;y" FROM t;$/);
  assert.match(parts[3], /\$f\$ BEGIN RETURN 1; END; \$f\$/);
  assert.match(parts[5], /E'it\\'s;fine'/);
});

test('keeps a trailing statement without a semicolon', () => {
  assert.deepEqual(splitStatements('SELECT 1; SELECT 2').map((s) => s.trim()), ['SELECT 1;', 'SELECT 2']);
});

test('nested block comments and doubled quotes', () => {
  assert.equal(splitStatements("SELECT /* a /* b ; */ ; */ 'x''y;z';").length, 1);
});

test('targetsSchema looks at the object being created/changed, not at what it mentions', () => {
  const auth = (s) => targetsSchema(s, 'auth');
  assert.ok(auth('CREATE TABLE auth.users (id uuid)'));
  assert.ok(auth('ALTER TABLE ONLY auth.users ADD CONSTRAINT x PRIMARY KEY (id)'));
  assert.ok(auth('CREATE OR REPLACE FUNCTION auth.uid()'));
  assert.ok(auth('GRANT USAGE ON SCHEMA auth TO anon'));
  assert.ok(auth('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT SELECT ON TABLES TO postgres'));
  assert.ok(auth('-- note\nCREATE INDEX i ON auth.users (email)'));
  // storage statements that merely REFERENCE auth stay
  assert.ok(!auth('ALTER TABLE ONLY storage.objects ADD CONSTRAINT o FOREIGN KEY (owner) REFERENCES auth.users(id)'));
  assert.ok(!auth('CREATE POLICY p ON storage.objects FOR SELECT USING (auth.uid() IS NOT NULL)'));
  assert.ok(!auth('CREATE TABLE storage.buckets (id text)'));
  assert.ok(!auth("INSERT INTO storage.buckets (id) VALUES ('auth.x')"));
  assert.ok(!auth('SET search_path = public'));
});
