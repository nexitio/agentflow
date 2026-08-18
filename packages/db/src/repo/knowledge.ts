/**
 * Knowledge base repository — vector search over knowledge_chunks (Phase 4).
 *
 * Documents are chunked and embedded at ingestion; at runtime the agent
 * embeds the query and retrieves the nearest chunks. Retrieved content is
 * untrusted (invariant §4.5) — the agent runtime labels it as data.
 */

import { asc, cosineDistance, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../schema";

export interface InsertKnowledgeChunk {
  workspaceId: string;
  sourceId: string;
  title: string;
  content: string;
  /** Must match the column dimension (1536) and the operator's embedding model. */
  embedding: number[];
  metadata?: Record<string, unknown>;
}

/** Insert (or replace) chunks for one source within one workspace. */
export async function upsertChunks(
  db: PostgresJsDatabase<typeof schema>,
  chunks: InsertKnowledgeChunk[],
): Promise<void> {
  const first = chunks[0];
  if (first === undefined) {
    return;
  }
  // Re-ingesting a document replaces its old chunks wholesale.
  await db
    .delete(schema.knowledgeChunks)
    .where(
      sql`${schema.knowledgeChunks.workspaceId} = ${first.workspaceId} and ${schema.knowledgeChunks.sourceId} = ${first.sourceId}`,
    );
  await db.insert(schema.knowledgeChunks).values(
    chunks.map((chunk) => ({
      workspaceId: chunk.workspaceId,
      sourceId: chunk.sourceId,
      title: chunk.title,
      content: chunk.content,
      embedding: chunk.embedding,
      metadata: chunk.metadata ?? {},
    })),
  );
}

export async function deleteSource(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  sourceId: string,
): Promise<void> {
  await db
    .delete(schema.knowledgeChunks)
    .where(
      sql`${schema.knowledgeChunks.workspaceId} = ${workspaceId} and ${schema.knowledgeChunks.sourceId} = ${sourceId}`,
    );
}

export interface RetrievedChunk {
  id: string;
  sourceId: string;
  title: string;
  content: string;
  /** Cosine distance — lower is more similar. */
  distance: number;
}

/**
 * Nearest-neighbor search by cosine distance. The HNSW index makes this fast
 * even with a large knowledge base on the operator's VPS.
 */
export async function searchChunks(
  db: PostgresJsDatabase<typeof schema>,
  workspaceId: string,
  queryEmbedding: number[],
  limit = 5,
): Promise<RetrievedChunk[]> {
  const distance = sql<number>`${cosineDistance(schema.knowledgeChunks.embedding, queryEmbedding)}`;
  const rows = await db
    .select({
      id: schema.knowledgeChunks.id,
      sourceId: schema.knowledgeChunks.sourceId,
      title: schema.knowledgeChunks.title,
      content: schema.knowledgeChunks.content,
      distance,
    })
    .from(schema.knowledgeChunks)
    .where(eq(schema.knowledgeChunks.workspaceId, workspaceId))
    .orderBy(asc(distance))
    .limit(limit);
  return rows.map((row) => ({ ...row, distance: Number(row.distance) }));
}
