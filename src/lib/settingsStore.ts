// User preferences, persisted in localStorage and used as defaults by the Workspace.

import type { PrivacyTransform } from './types';
import { createLocalStore } from './localStore';

export interface AppSettings {
  language: string;
  timezone: string;
  defaultLocale: string;
  defaultCurrency: string;
  defaultRowCount: number;
  /** Percent. */
  defaultNullRate: number;
  defaultOutlierRate: number;
  /** Default transform for detected high-privacy columns. */
  defaultPIIBehavior: Extract<PrivacyTransform, 'synthetic' | 'mask' | 'hash'>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  timezone: 'Asia/Karachi',
  defaultLocale: 'PK',
  defaultCurrency: 'PKR',
  defaultRowCount: 10000,
  defaultNullRate: 5,
  defaultOutlierRate: 2,
  defaultPIIBehavior: 'synthetic',
};

export const settingsStore = createLocalStore<AppSettings>('synthra:settings:v1', DEFAULT_SETTINGS);

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...settingsStore.get() };
}
