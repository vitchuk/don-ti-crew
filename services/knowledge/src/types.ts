export type FileType = 'readme' | 'docs' | 'specs' | 'adr' | 'code' | 'config'

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>
}

export interface Chunk {
  filePath: string
  fileType: FileType
  headingPath?: string
  content: string
}

export interface IndexerOptions {
  repoRoot?: string
  dbPath?: string
  embedder: Embedder
  force?: boolean
}

export interface IndexSummary {
  filesTotal: number
  filesIndexed: number
  filesSkipped: number
  filesDeleted: number
  chunksUpserted: number
  dimension: number
  dimensionChanged?: boolean
}

export interface SearchHit {
  file: string
  heading?: string
  excerpt: string
  score: number
}

export interface SearchResponse {
  results: SearchHit[]
  total: number
}

export interface QueryOptions {
  k?: number
  type?: FileType
  dbPath?: string
  embedder?: Embedder
}
