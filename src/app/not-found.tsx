import { Dashboard } from '@/views/Dashboard';

// Unknown routes fall back to the dashboard, matching the old `path="*"` route.
export default function NotFound() {
  return <Dashboard />;
}
