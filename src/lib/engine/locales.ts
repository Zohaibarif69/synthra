// Locale data for generation. faker has no Latin-script Pakistani locale, so PK names,
// cities and phone numbers come from the lists below; everything else falls back to faker's en data.

import { Faker, base, de, en, en_AU, en_CA, en_GB, en_IN, en_US, fr, type LocaleDefinition } from '@faker-js/faker';
import type { Rng } from './random';

const FAKER_LOCALES: Record<string, LocaleDefinition> = {
  US: en_US, GB: en_GB, IN: en_IN, CA: en_CA, AU: en_AU, DE: de, FR: fr, PK: en,
};

export function createFaker(locale: string, seed: number): Faker {
  const primary = FAKER_LOCALES[locale] ?? en;
  const faker = new Faker({ locale: primary === en ? [en, base] : [primary, en, base] });
  faker.seed(seed);
  return faker;
}

export const COUNTRY_NAMES: Record<string, string> = {
  PK: 'Pakistan', US: 'United States', GB: 'United Kingdom', IN: 'India',
  DE: 'Germany', FR: 'France', CA: 'Canada', AU: 'Australia',
};

export const PK_MALE_FIRST = [
  'Muhammad', 'Ahmed', 'Ali', 'Hassan', 'Hussain', 'Usman', 'Bilal', 'Hamza', 'Umar', 'Zain', 'Faisal', 'Imran',
  'Kamran', 'Asad', 'Saad', 'Fahad', 'Waqas', 'Adnan', 'Shahid', 'Tariq', 'Junaid', 'Danish', 'Salman', 'Irfan',
  'Nadeem', 'Farhan', 'Haris', 'Arslan', 'Talha', 'Noman', 'Rizwan', 'Zeeshan', 'Abdullah', 'Ibrahim', 'Yasir', 'Owais',
];
export const PK_FEMALE_FIRST = [
  'Ayesha', 'Fatima', 'Zainab', 'Maryam', 'Hira', 'Sana', 'Amna', 'Mahnoor', 'Iqra', 'Sara', 'Rabia', 'Nimra',
  'Khadija', 'Saima', 'Sadia', 'Bushra', 'Kiran', 'Mehwish', 'Anam', 'Areeba', 'Hafsa', 'Laiba', 'Noor', 'Aliya',
  'Farah', 'Samina', 'Uzma', 'Nadia', 'Rida', 'Alina', 'Zoya', 'Hina', 'Javeria', 'Minahil', 'Eman', 'Aiman',
];
export const PK_LAST = [
  'Khan', 'Ahmed', 'Ali', 'Hussain', 'Malik', 'Butt', 'Chaudhry', 'Qureshi', 'Siddiqui', 'Sheikh', 'Raza', 'Iqbal',
  'Mirza', 'Baig', 'Shah', 'Abbasi', 'Awan', 'Javed', 'Aslam', 'Rehman', 'Farooq', 'Anwar', 'Hashmi', 'Zaidi',
  'Rizvi', 'Jamil', 'Nawaz', 'Saleem', 'Mahmood', 'Akhtar', 'Bhatti', 'Gondal', 'Cheema', 'Bajwa', 'Tariq', 'Yousaf',
];

/** Cities with rough population weights. */
export const PK_CITIES: [string, number][] = [
  ['Karachi', 20], ['Lahore', 13], ['Faisalabad', 4], ['Rawalpindi', 3], ['Islamabad', 3], ['Gujranwala', 2.5],
  ['Peshawar', 2.5], ['Multan', 2], ['Hyderabad', 2], ['Quetta', 1.2], ['Sialkot', 1], ['Bahawalpur', 1],
  ['Sargodha', 0.8], ['Sukkur', 0.6], ['Abbottabad', 0.4], ['Mardan', 0.5], ['Sheikhupura', 0.5], ['Gujrat', 0.4],
];
export const PK_PROVINCES: [string, number][] = [
  ['Punjab', 53], ['Sindh', 23], ['Khyber Pakhtunkhwa', 15], ['Balochistan', 6], ['Islamabad Capital Territory', 1],
  ['Gilgit-Baltistan', 1], ['Azad Kashmir', 1],
];
export const PK_AREAS = [
  'Gulberg', 'DHA Phase 5', 'Clifton', 'Johar Town', 'Model Town', 'Bahria Town', 'F-7', 'G-9', 'Saddar',
  'Satellite Town', 'Gulshan-e-Iqbal', 'North Nazimabad', 'Cantt', 'Garden Town', 'Wapda Town', 'Hayatabad',
];

function digits(rng: Rng, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += rng.int(0, 9);
  return s;
}

export function phoneNumber(rng: Rng, locale: string): string {
  switch (locale) {
    case 'PK': return `+92 3${rng.int(0, 4)}${rng.int(0, 9)} ${digits(rng, 7)}`;
    case 'US':
    case 'CA': return `+1 (${rng.int(2, 9)}${digits(rng, 2)}) ${rng.int(2, 9)}${digits(rng, 2)}-${digits(rng, 4)}`;
    case 'GB': return `+44 7${digits(rng, 3)} ${digits(rng, 6)}`;
    case 'IN': return `+91 ${rng.int(6, 9)}${digits(rng, 4)} ${digits(rng, 5)}`;
    case 'DE': return `+49 15${digits(rng, 1)} ${digits(rng, 8)}`;
    case 'FR': return `+33 ${rng.pick(['6', '7'])} ${digits(rng, 2)} ${digits(rng, 2)} ${digits(rng, 2)} ${digits(rng, 2)}`;
    case 'AU': return `+61 4${digits(rng, 2)} ${digits(rng, 3)} ${digits(rng, 3)}`;
    default: return `+1 ${digits(rng, 3)}-${digits(rng, 3)}-${digits(rng, 4)}`;
  }
}

export function postalCode(rng: Rng, locale: string, faker: Faker): string {
  if (locale === 'PK') return String(rng.int(10000, 97999));
  return faker.location.zipCode();
}

/** Fills '#' with digits and 'A' with letters. */
export function fillPattern(rng: Rng, pattern: string): string {
  let s = '';
  for (const ch of pattern) {
    if (ch === '#') s += rng.int(0, 9);
    else if (ch === 'A') s += String.fromCharCode(65 + rng.int(0, 25));
    else s += ch;
  }
  return s;
}
