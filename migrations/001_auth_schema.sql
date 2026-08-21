-- ─────────────────────────────────────────────────────────────────────────────
-- 001 — Auth.js standard Postgres schema
-- ─────────────────────────────────────────────────────────────────────────────
--
-- These are the four tables the @auth/pg-adapter queries against. Column names
-- and casing are LOAD-BEARING: the adapter issues raw SQL like
--   select * from users where email = $1
--   select * from sessions where "sessionToken" = $1
-- so the quoted camelCase columns must stay quoted-camelCase. Do not rename
-- them without also changing the adapter (which would defeat the point).
--
-- Why each table exists — even the ones we don't use today:
--
--   users
--     One row per person. Populated on the FIRST successful magic-link click
--     (getUserByEmail returns null → adapter calls createUser). Everything
--     downstream — sessions, per-user data — joins to users.id.
--
--   sessions
--     One row per active login. Populated whenever a magic link is consumed and
--     a new session cookie is minted. The row's "sessionToken" is what the
--     cookie contains; expires drives server-side expiry. Because we chose
--     session strategy "database" in auth.ts, every server-side auth() call
--     does `select * from sessions where "sessionToken" = $1` — this table is
--     the authoritative source of truth for whether someone is signed in.
--
--   accounts
--     One row per (user, external-provider) pair. Currently UNUSED because our
--     only provider is email/magic-link (Resend), which doesn't create account
--     rows — the identity lives entirely in `users` + `verification_token`. We
--     still create the table now so adding an OAuth provider later (Google,
--     GitHub) is a pure config change; the adapter would already know where to
--     insert the linkAccount row.
--
--   verification_token
--     Short-lived. Populated when a magic link is REQUESTED (holds the token +
--     the identifier a.k.a. email + expiry). Deleted the moment the link is
--     CLICKED (adapter's useVerificationToken does DELETE ... RETURNING). If a
--     link expires unclicked, the row just sits until the next cleanup — no
--     harm, since we always check `expires`.
--
-- All CREATE statements are IF NOT EXISTS so this file is safe to re-run
-- against a database that already has the schema. Idempotency is the whole
-- reason we don't ship a full migration framework in Stage 1.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL       PRIMARY KEY,
  name          VARCHAR(255),
  email         VARCHAR(255),
  "emailVerified" TIMESTAMPTZ,
  image         TEXT
);

-- Emails are the primary identity for magic-link sign-in, so enforce uniqueness
-- at the DB level. Do it as a separate statement (not inline UNIQUE) so we can
-- guard it with IF NOT EXISTS for re-runnability.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

CREATE TABLE IF NOT EXISTS accounts (
  id                  SERIAL       PRIMARY KEY,
  "userId"            INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                VARCHAR(255) NOT NULL,
  provider            VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  -- BIGINT (not INT) because OAuth providers return seconds-since-epoch and
  -- some also encode future expiries beyond INT range for long-lived tokens.
  expires_at          BIGINT,
  id_token            TEXT,
  scope               TEXT,
  session_state       TEXT,
  token_type          TEXT
);

-- One (provider, providerAccountId) pair uniquely identifies an external
-- identity — enforce it so the adapter's getUserByAccount can rely on it.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_account_key
  ON accounts (provider, "providerAccountId");

CREATE TABLE IF NOT EXISTS sessions (
  id             SERIAL       PRIMARY KEY,
  "userId"       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires        TIMESTAMPTZ  NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL
);

-- The session cookie carries the token; every auth() call looks up the session
-- by it. Must be unique or the lookup is ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_session_token_key
  ON sessions ("sessionToken");

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT        NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  token      TEXT        NOT NULL,
  -- Composite PK matches how the adapter looks these up: identifier + token.
  -- A user can have multiple pending links (e.g. requested one, then a second
  -- because the first didn't arrive); each is its own row.
  PRIMARY KEY (identifier, token)
);
