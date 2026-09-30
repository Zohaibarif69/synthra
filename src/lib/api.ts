// Upload and analysis entry points. Everything runs in the browser; there is no backend.

import type { SchemaAnalysis, UploadResult } from './types';
import { parseFile } from './engine/parse';
import { inferSchema, summarizeSchema } from './engine/infer';
import { profileDataset } from './engine/profile';
import { getDataset, putDataset } from './engine/store';

/** Parses the file in the browser and keeps it in memory. Throws ParseError with a user-facing message. */
export async function uploadDataset(file: File, onProgress?: (fraction: number) => void): Promise<UploadResult> {
  const dataset = await parseFile(file, onProgress);
  const fileId = putDataset(dataset);
  return {
    fileId,
    fileName: file.name,
    fileSizeMb: file.size / (1024 * 1024),
    rowCount: dataset.rows.length,
    columnCount: dataset.columns.length,
    warnings: dataset.warnings,
  };
}

/** Infers the schema and learns a profile from a previously uploaded file. */
export async function analyzeSchema(fileId: string): Promise<SchemaAnalysis> {
  const dataset = getDataset(fileId);
  if (!dataset) throw new Error('The uploaded file is no longer available. Please upload it again.');
  // Yield so the "analyzing" state can paint before the synchronous work starts.
  await new Promise(r => setTimeout(r, 0));
  const columns = inferSchema(dataset);
  const profile = profileDataset(dataset, columns);
  return { columns, profile, ...summarizeSchema(columns, profile) };
}
