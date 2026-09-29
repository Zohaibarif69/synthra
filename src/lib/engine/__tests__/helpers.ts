import type { Cell, ColumnSchema, GenerationConfig } from '../../types';

export const config = (over: Partial<GenerationConfig> = {}): GenerationConfig & { seed: number } => ({
  rowCount: 500,
  seed: 42,
  nullRate: 0.1,
  outlierRate: 0.02,
  locale: 'PK',
  currency: 'PKR',
  edgeCases: { missingValues: true, numericOutliers: true, rareCategories: true, boundaryValues: true, longText: false, duplicateLike: true },
  ...over,
} as GenerationConfig & { seed: number });

export const idCol = (name: string, unique = true): ColumnSchema => ({
  name, type: 'integer', semanticType: 'Identifier', nullable: false, unique, privacyLevel: 'low',
});

/** A manual schema like the one the schema builder starts with, plus a few typed columns. */
export const customerSchema = (): ColumnSchema[] => [
  idCol('id'),
  { name: 'name', type: 'string', semanticType: 'Person Name', nullable: true, unique: false, privacyLevel: 'high', privacyTransform: 'synthetic' },
  { name: 'email', type: 'email', semanticType: 'Email', nullable: true, unique: true, privacyLevel: 'high', privacyTransform: 'synthetic' },
  { name: 'city', type: 'string', semanticType: 'City', nullable: true, privacyLevel: 'medium' },
  { name: 'age', type: 'integer', semanticType: 'Age', nullable: true, privacyLevel: 'medium' },
  { name: 'joined', type: 'date', semanticType: 'Date', nullable: true },
];

export const column = (schema: ColumnSchema[], data: Cell[][], name: string): Cell[] => {
  const i = schema.findIndex(c => c.name === name);
  if (i < 0) throw new Error(`no column ${name}`);
  return data[i];
};
