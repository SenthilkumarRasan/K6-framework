import { htmlReport } from '../utils/bundle.js';

export function handleSummary(data) {
  return {
    'summary.html': htmlReport(data),
  };
}