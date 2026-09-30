import { describe, expect, it } from 'vitest';
import { inferSchema } from '../infer';

const PEOPLE = ['name', 'full_name', 'first_name', 'last_name', 'applicant_name', 'planner_name', 'teammate_name', 'bookkeeper_name',
  'job_seeker_name', 'project_manager_name', 'team_lead_name', 'statement_holder_name', 'bank_account_holder_name', 'patient_name',
  'customer_name', 'employee_name', 'student_name', 'guardian_name', 'driver_name', 'contact_name'];
const THINGS = ['product_name', 'company_name', 'app_name', 'bank_name', 'team_name', 'plan_name', 'city_name', 'project_name', 'file_name',
  'book_name', 'game_name', 'event_name', 'category_name', 'product_category_name', 'store_name', 'hospital_name', 'course_name',
  'brand_name', 'device_name', 'role_name', 'state_name', 'department_name', 'item_name', 'model_name', 'employer_name', 'college_name'];

describe('personal-name detection', () => {
  const columns = [...PEOPLE, ...THINGS];
  const rows = Array.from({ length: 30 }, (_, i) => Object.fromEntries(columns.map(c => [c, `Alpha Beta ${i}`])));
  const schema = inferSchema({ fileName: 'x.csv', fileSizeBytes: 1, format: 'csv', columns, rows: rows as never, warnings: [] });
  const col = (n: string) => schema.find(c => c.name === n)!;

  it.each(PEOPLE)('%s is protected as personal data', n => {
    expect(col(n).privacyLevel).toBe('high');
    expect(col(n).privacyTransform).not.toBe('preserve');
  });

  it.each(THINGS)('%s is not mistaken for a person', n => {
    expect(col(n).semanticType).not.toBe('Person Name');
  });
});
