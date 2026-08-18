import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/** The drizzle client over our schema — the type node runtimes and repos share. */
export type Db = PostgresJsDatabase<typeof schema>;

export interface DbClient {
  client: postgres.Sql;
  db: Db;
}

export function createDbClient(databaseUrl: string): DbClient {
  const client = postgres(databaseUrl, {
    max: 10,
    // postgres-js + drizzle: prepare=false avoids pgbouncer-incompatible
    // named prepared statements (drizzle recommends it with postgres.js).
    prepare: false,
  });
  const db = drizzle(client, { schema });
  return { client, db };
}
