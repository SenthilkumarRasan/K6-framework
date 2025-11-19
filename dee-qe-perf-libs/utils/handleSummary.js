import { htmlReport } from '../utils/bundle.js';

export function handleSummary(data) {
  return {
    'results/summary.html': htmlReport(data),
  };
}