# Database guide — PGlite + Drizzle

The app has a database: PGlite (real Postgres, running in-process) with Drizzle as the query layer. It is installed and set up — do NOT reinstall or re-scaffold it.

## Layout
- `server/db/schema.ts` — the tables, defined with `drizzle-orm/pg-core`.
- `server/db/client.ts` — opens the database and exports `db` and an idempotent `initDb()`.
- `server/db/validation.ts` — zod schemas derived from the tables with `drizzle-zod`.
- Data is stored in `./data/pgdata`, which is gitignored.

## Adding a table — three places, every time
1. Define it in `server/db/schema.ts`.
2. Add a matching `CREATE TABLE IF NOT EXISTS …` to `initDb()` in `server/db/client.ts`. A fresh copy of the app creates its tables from `initDb()`, so a table that is missing there does not exist.
3. Add its insert/select schemas to `server/db/validation.ts`.

`initDb()` only creates tables that are missing. To change a column on a table that already exists, add an `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` line to `initDb()` as well.

## Rules
- `server/index.ts` must `await initDb()` before it handles a request.
- Use Postgres through PGlite. Do NOT use sqlite or `bun:sqlite` — the published app runs on Postgres, and a different dialect means rewriting the schema later.
- One connection is correct here: only this server talks to the database.
- Keep the table SQL in `initDb()` as plain statements inside one `client.exec(`…`)` call, with no `${…}` in them, and keep `server/db/client.ts` exporting only `db` and `initDb`. Publishing swaps that one file for the real database by reading those statements, and refuses to publish if it cannot.
- Open the database only through `db` from `server/db/client.ts`. Never import `@electric-sql/pglite` anywhere else.
- Never store a file's contents in a table. Call `enable_storage` and keep the file's `key` in the row.
- The frontend never touches the database. It calls `/api/*` routes, through React Query.
- Validate request bodies on write routes: `zValidator('json', insertThingSchema)` from `@hono/zod-validator`.

## Drizzle cheat-sheet (pg-core)
- Define: `export const todos = pgTable('todos', { id: serial('id').primaryKey(), title: text('title').notNull(), completed: boolean('completed').notNull().default(false) })`
- Select: `await db.select().from(todos).where(eq(todos.id, id))`
- Insert (return the row): `const [row] = await db.insert(todos).values(data).returning()`
- Update: `await db.update(todos).set(data).where(eq(todos.id, id)).returning()`
- Delete: `await db.delete(todos).where(eq(todos.id, id)).returning()`
- Import `eq` / `and` / `desc` from `drizzle-orm`.
- Schemas: `createInsertSchema(todos)` / `createSelectSchema(todos)` from `drizzle-zod`, so each shape is defined once.

## A route, end to end

```ts
app.post('/api/todos', zValidator('json', insertTodoSchema), async (c) => {
  const data = c.req.valid('json')
  const [row] = await db.insert(todos).values(data).returning()
  return c.json(row, 201)
})
```

The scaffold ships an example `items` table. Replace it with the app's real tables — in all three places.
