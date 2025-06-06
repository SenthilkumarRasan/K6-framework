import { SharedArray } from 'k6/data';
import execution from 'k6/execution';

/**
 * Simple CSV parser for basic CSV files (no quoted fields).
 */
function simpleCsvParse(csv) {
    const lines = csv.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = values[i] || '';
        });
        return obj;
    });
}

/**
 * Parses CSV string content into an array of objects.
 * The first line of the CSV string is used as headers for the object keys.
 * @param {string} csvString - The raw CSV data as a string.
 * @returns {Array<Object>} An array of objects representing the CSV rows.
 */
export function parseCsvWithHeaders(csvString) {
  if (!csvString || typeof csvString !== 'string') {
    console.error('[CSV PARSER] Input is not a valid string.');
    return [];
  }

  const lines = csvString.trim().split('\n');
  if (lines.length < 2) {
    console.error('[CSV PARSER] CSV must have at least two lines (headers + one data row).');
    return []; // Need at least a header and one data row
  }

  const headers = lines[0].split(',').map(header => header.trim());
  const result = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    // Basic CSV value splitting, may not handle complex cases like commas within quotes perfectly.
    // For more robust parsing, a dedicated CSV library (like papaparse if available in k6 modules) would be better.
    const values = line.split(',').map(value => value.trim());
    
    // If a line has fewer values than headers, pad with empty strings
    // If it has more, extra values are ignored by this simple zip
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = values[index] !== undefined ? values[index] : '';
    });
    result.push(obj);
  }

  return result;
}

export function createCsvIterator(csvData, options = {}) {
    const {
        selectionMode = 'sequential',
        resetOnIterationEnd = true
    } = options;

    if (!csvData || csvData.length === 0) {
        console.error('No valid data found in CSV. Make sure the CSV file exists and contains valid data.');
        return {
            next: () => null,
            getByIndex: () => null,
            count: () => 0,
            reset: () => {}
        };
    }

    const vuPositions = new Map(); // Keep VU positions for per-VU modes

    return {
        next() {
            if (selectionMode === 'random') {
                const randomIndex = Math.floor(Math.random() * csvData.length);
                return csvData[randomIndex];
            } else if (selectionMode === 'global_sequential') {
                // Use global iteration count to determine the index
                // execution.scenario.iterationInTest is the global iteration count
                const globalIteration = execution.scenario.iterationInTest;
                const index = globalIteration % csvData.length;
                
                console.log(`VU: ${execution.vu.idInTest}, Global Iteration: ${globalIteration}, Accessing CSV Index: ${index}`);
                
                const item = csvData[index];
                return item;
            } else { // per-VU sequential
                const vuId = execution.vu.idInTest;
                if (!vuPositions.has(vuId)) {
                    vuPositions.set(vuId, 0);
                }

                let position = vuPositions.get(vuId);
                if (position >= csvData.length) {
                    position = resetOnIterationEnd ? 0 : csvData.length - 1;
                    vuPositions.set(vuId, position);
                }

                const item = csvData[position];
                position++;
                vuPositions.set(vuId, position);

                return item;
            }
        },
        getByIndex(index) {
            if (index < 0 || index >= csvData.length) {
                console.error(`Index out of bounds: ${index}. CSV data has ${csvData.length} rows.`);
                return null;
            }
            return csvData[index];
        },
        count() {
            return csvData.length;
        },
        reset() {
            if (selectionMode !== 'global_sequential') {
                const vuId = execution.vu.idInTest;
                vuPositions.set(vuId, 0);
            }
            // No need to reset for global_sequential as it uses the global iteration count
        }
    };
}