export const LOCALES = [
  { value: 'PK', label: 'Pakistan' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'IN', label: 'India' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
];

export const CURRENCIES = [
  { value: 'PKR', label: 'PKR — Pakistani Rupee' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'INR', label: 'INR — Indian Rupee' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
];

export const ROW_PRESETS = [
  { label: '1K', value: 1000 },
  { label: '10K', value: 10000 },
  { label: '100K', value: 100000 },
  { label: '1M', value: 1000000 },
];

export const DATA_TYPES = ['string', 'integer', 'float', 'boolean', 'date', 'datetime', 'email', 'uuid'] as const;

export const SEMANTIC_TYPES = [
  'Identifier',
  'Person Name',
  'Email',
  'Phone',
  'Address',
  'City',
  'Country',
  'Currency',
  'Age',
  'Date',
  'URL',
  'Company',
  'Category',
  'Description',
  'Status',
  'Quantity',
  'Other',
] as const;

export const STEPS = [
  { id: 1, label: 'Input', description: 'Select data type' },
  { id: 2, label: 'Schema', description: 'Define schema' },
  { id: 3, label: 'Configure', description: 'Set parameters' },
  { id: 4, label: 'Generate', description: 'Run generation' },
  { id: 5, label: 'Validate', description: 'Check results' },
  { id: 6, label: 'Export', description: 'Download data' },
];
