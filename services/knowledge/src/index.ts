export { index } from './indexer.js'
export { query, truncateExcerpt, EXCERPT_LIMIT } from './query.js'
export { chunkMarkdown, chunkCode, MARKDOWN_CHUNK_LIMIT, CODE_CHUNK_LIMIT } from './chunker.js'
export { classifyFile, collectFiles, type SourceFile } from './walk.js'
export {
  FakeEmbedder,
  createOllamaEmbedder,
  DEFAULT_OLLAMA_BASE_URL,
  EMBED_MODEL,
  EMBED_MODEL_ENV,
  EMBED_BATCH_SIZE,
  FAKE_EMBEDDER_DIMENSION,
  type OllamaEmbedderOptions,
} from './embeddings.js'
export {
  KnowledgeError,
  ERROR_MESSAGES,
  NOT_INDEXED_MESSAGE,
  OLLAMA_UNAVAILABLE_MESSAGE,
  MODEL_NOT_FOUND_MESSAGE,
  modelNotFoundMessage,
  DB_INCOMPATIBLE_MESSAGE,
  EMBED_FAILED_MESSAGE,
  WALK_FAILED_MESSAGE,
  type KnowledgeErrorCode,
} from './errors.js'
export { repoRoot, findRepoRoot } from './repoRoot.js'
export {
  DEFAULT_DB_PATH,
  openDatabase,
  tableExists,
  ensureSchema,
  existingFiles,
  readStoredDimension,
  searchChunks,
  createSql,
} from './db.js'
export { DEFAULT_K, FILE_TYPES } from './constants.js'
export type {
  FileType,
  Embedder,
  Chunk,
  IndexerOptions,
  IndexSummary,
  SearchHit,
  SearchResponse,
  QueryOptions,
} from './types.js'
export { runCli, main, type CliIo } from './cli.js'
