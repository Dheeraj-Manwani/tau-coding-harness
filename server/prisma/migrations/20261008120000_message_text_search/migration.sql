-- Searching a project's conversation (search_history).
--
-- A message is stored as JSON, and the JSON form of a sentence is not the
-- sentence: a quote is \", a line break is \n, so a phrase that had either in it
-- could not be found. tau_message_text() turns the stored form back into the
-- text that was written, and a trigram index on it makes a substring search
-- fast on a project with tens of thousands of messages. Tool results are left
-- out of the index: they are most of the bytes and are never searched.
--
-- Not modelled in schema.prisma, because Prisma cannot describe an expression
-- index. `prisma migrate deploy` applies it; `prisma migrate dev` may offer to
-- drop it, and must be refused.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- An escaped backslash (\\) is set aside as \x01 first, so that the \n and \"
-- that follow a real backslash are not read as escapes, and put back last.
CREATE OR REPLACE FUNCTION tau_message_text(c jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT replace(
    replace(
      replace(
        replace(
          replace(c::text, E'\\\\', E'\x01'),
          E'\\n', E'\n'),
        E'\\t', E'\t'),
      E'\\"', '"'),
    E'\x01', E'\\')
$$;

CREATE INDEX IF NOT EXISTS "Message_text_trgm_idx"
  ON "Message" USING gin (tau_message_text("content") gin_trgm_ops)
  WHERE "type" <> 'TOOL_RES';
