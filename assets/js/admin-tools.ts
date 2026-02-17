/**
 * Admin Tools - Email and Phone Verification
 *
 * Provides bulk validation interface for email and phone numbers.
 * Uses the donate-tools worker API for server-side MX record validation.
 * Protected by Cloudflare Access - only accessible to @baytides.org email holders.
 */

import { parseEmailList } from './email-verifier';
import { parsePhoneList } from './phone-verifier';

const API_ENDPOINT = 'https://donate-tools.baytides.org';

// API response types
interface ApiEmailResult {
  email: string;
  isValid: boolean;
  isDisposable: boolean;
  errors: string[];
  warnings: string[];
  suggestion?: string;
  hasMxRecord?: boolean;
}

interface ApiPhoneResult {
  phone: string;
  isValid: boolean;
  normalized?: string;
  errors: string[];
  warnings: string[];
}

interface ApiResponse {
  emails?: ApiEmailResult[];
  phones?: ApiPhoneResult[];
  summary: {
    totalEmails?: number;
    validEmails?: number;
    invalidEmails?: number;
    disposableEmails?: number;
    totalPhones?: number;
    validPhones?: number;
    invalidPhones?: number;
  };
}

// Store results for export
let emailResults: ApiResponse | null = null;
let phoneResults: ApiResponse | null = null;

// Safe element creation helpers
function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes?: Record<string, string>,
  children?: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'className') {
        el.className = value;
      } else {
        el.setAttribute(key, value);
      }
    }
  }
  if (children) {
    for (const child of children) {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else {
        el.appendChild(child);
      }
    }
  }
  return el;
}

function createText(text: string): Text {
  return document.createTextNode(text);
}

// Tab switching
function initTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tool-tab');
  const panels = document.querySelectorAll<HTMLElement>('.tool-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      const targetId = tab.getAttribute('aria-controls');
      panels.forEach((panel) => {
        panel.classList.remove('active');
        if (panel.id === targetId) {
          panel.classList.add('active');
        }
      });
    });
  });
}

// Create empty state element
function createEmptyState(iconPath: string, message: string): HTMLElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', iconPath);
  svg.appendChild(path);

  const p = createElement('p', {}, [message]);
  return createElement('div', { className: 'empty-state' }, [svg, p]);
}

// Create loading state
function createLoadingState(message: string): HTMLElement {
  const spinner = createElement('div', { className: 'loading-spinner' });
  const p = createElement('p', {}, [message]);
  return createElement('div', { className: 'loading-state' }, [spinner, p]);
}

// Create stat card
function createStatCard(value: number, label: string, type?: string): HTMLElement {
  const valueEl = createElement('div', { className: 'stat-value' }, [value.toString()]);
  const labelEl = createElement('div', { className: 'stat-label' }, [label]);
  const className = type ? `stat-card ${type}` : 'stat-card';
  return createElement('div', { className }, [valueEl, labelEl]);
}

// Create status badge
function createStatusBadge(status: string): HTMLElement {
  return createElement('span', { className: `status-badge ${status}` }, [status.toUpperCase()]);
}

// API call to verify contacts
async function verifyContacts(emails?: string[], phones?: string[]): Promise<ApiResponse> {
  const response = await fetch(`${API_ENDPOINT}/verify-contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ emails, phones }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

// Email validation UI
function initEmailValidation(): void {
  const input = document.getElementById('email-input') as HTMLTextAreaElement;
  const validateBtn = document.getElementById('validate-emails') as HTMLButtonElement;
  const clearBtn = document.getElementById('clear-emails') as HTMLButtonElement;
  const exportBtn = document.getElementById('export-emails-csv') as HTMLButtonElement;
  const resultsContainer = document.getElementById('email-results') as HTMLElement;

  if (!input || !validateBtn || !clearBtn || !exportBtn || !resultsContainer) return;

  const emailIconPath =
    'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z';

  validateBtn.addEventListener('click', async () => {
    const emails = parseEmailList(input.value);

    if (emails.length === 0) {
      resultsContainer.replaceChildren(
        createEmptyState(
          emailIconPath,
          'No email addresses found. Please enter at least one email address.'
        )
      );
      exportBtn.disabled = true;
      return;
    }

    // Show loading state
    validateBtn.disabled = true;
    validateBtn.textContent = 'Validating...';
    resultsContainer.replaceChildren(
      createLoadingState(
        `Validating ${emails.length} email${emails.length > 1 ? 's' : ''} (checking MX records)...`
      )
    );

    try {
      emailResults = await verifyContacts(emails, undefined);
      renderEmailResults(emailResults, resultsContainer);
      exportBtn.disabled = false;
    } catch (error) {
      resultsContainer.replaceChildren(
        createEmptyState(
          emailIconPath,
          `Error: ${error instanceof Error ? error.message : 'Failed to validate emails'}`
        )
      );
      exportBtn.disabled = true;
    } finally {
      validateBtn.disabled = false;
      validateBtn.textContent = 'Validate Emails';
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    emailResults = null;
    exportBtn.disabled = true;
    resultsContainer.replaceChildren(
      createEmptyState(
        emailIconPath,
        'Enter email addresses above and click "Validate Emails" to check them.'
      )
    );
  });

  exportBtn.addEventListener('click', () => {
    if (!emailResults?.emails) return;
    const csv = exportEmailResultsToCSV(emailResults.emails);
    downloadCSV(csv, 'email-validation-results.csv');
  });
}

function renderEmailResults(results: ApiResponse, container: HTMLElement): void {
  if (!results.emails) {
    container.replaceChildren(createElement('p', {}, ['No results']));
    return;
  }

  const noMxRecord = results.emails.filter((r) => r.hasMxRecord === false).length;

  // Create summary
  const summary = createElement('div', { className: 'results-summary' }, [
    createStatCard(results.summary.totalEmails || 0, 'Total'),
    createStatCard(results.summary.validEmails || 0, 'Valid', 'valid'),
    createStatCard(results.summary.invalidEmails || 0, 'Invalid', 'invalid'),
    createStatCard(noMxRecord, 'No MX Record', 'warning'),
    createStatCard(results.summary.disposableEmails || 0, 'Disposable', 'disposable'),
  ]);

  // Create table
  const headerRow = createElement('tr', {}, [
    createElement('th', {}, ['Email']),
    createElement('th', {}, ['Status']),
    createElement('th', {}, ['MX Record']),
    createElement('th', {}, ['Issues']),
    createElement('th', {}, ['Suggestion']),
  ]);
  const thead = createElement('thead', {}, [headerRow]);

  const tbody = createElement('tbody');
  for (const result of results.emails) {
    tbody.appendChild(createEmailRow(result));
  }

  const table = createElement('table', { className: 'results-table' }, [thead, tbody]);
  const tableContainer = createElement('div', { className: 'results-table-container' }, [table]);

  container.replaceChildren(summary, tableContainer);
}

function createEmailRow(result: ApiEmailResult): HTMLElement {
  // Email cell
  const emailCode = createElement('code', {}, [result.email]);
  const emailCell = createElement('td', {}, [emailCode]);

  // Status cell
  let statusBadge: HTMLElement;
  if (!result.isValid) {
    statusBadge = createStatusBadge(result.isDisposable ? 'disposable' : 'invalid');
  } else if (result.warnings.length > 0) {
    statusBadge = createStatusBadge('warning');
  } else {
    statusBadge = createStatusBadge('valid');
  }
  const statusCell = createElement('td', {}, [statusBadge]);

  // MX Record cell
  const mxCell = createElement('td');
  if (result.hasMxRecord === true) {
    mxCell.appendChild(createElement('span', { className: 'status-badge valid' }, ['YES']));
  } else if (result.hasMxRecord === false) {
    mxCell.appendChild(createElement('span', { className: 'status-badge invalid' }, ['NO']));
  } else {
    mxCell.appendChild(createText('-'));
  }

  // Issues cell
  const issuesCell = createElement('td');
  if (result.errors.length > 0 || result.warnings.length > 0) {
    const ul = createElement('ul', {
      className: result.errors.length > 0 ? 'error-list' : 'warning-list',
    });
    for (const error of result.errors) {
      ul.appendChild(createElement('li', {}, [error]));
    }
    for (const warning of result.warnings) {
      ul.appendChild(createElement('li', {}, [warning]));
    }
    issuesCell.appendChild(ul);
  } else {
    issuesCell.appendChild(createText('-'));
  }

  // Suggestion cell
  const suggestionCell = createElement('td');
  if (result.suggestion) {
    const suggestionLink = createElement(
      'span',
      {
        className: 'suggestion-link',
        title: 'Click to copy',
      },
      [result.suggestion]
    );
    suggestionLink.addEventListener('click', () => {
      navigator.clipboard.writeText(result.suggestion!);
      suggestionLink.textContent = 'Copied!';
      setTimeout(() => {
        suggestionLink.textContent = result.suggestion!;
      }, 1500);
    });
    suggestionCell.appendChild(suggestionLink);
  } else {
    suggestionCell.appendChild(createText('-'));
  }

  return createElement('tr', {}, [emailCell, statusCell, mxCell, issuesCell, suggestionCell]);
}

// Phone validation UI
function initPhoneValidation(): void {
  const input = document.getElementById('phone-input') as HTMLTextAreaElement;
  const validateBtn = document.getElementById('validate-phones') as HTMLButtonElement;
  const clearBtn = document.getElementById('clear-phones') as HTMLButtonElement;
  const exportBtn = document.getElementById('export-phones-csv') as HTMLButtonElement;
  const resultsContainer = document.getElementById('phone-results') as HTMLElement;

  if (!input || !validateBtn || !clearBtn || !exportBtn || !resultsContainer) return;

  const phoneIconPath =
    'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z';

  validateBtn.addEventListener('click', async () => {
    const phones = parsePhoneList(input.value);

    if (phones.length === 0) {
      resultsContainer.replaceChildren(
        createEmptyState(
          phoneIconPath,
          'No phone numbers found. Please enter at least one phone number.'
        )
      );
      exportBtn.disabled = true;
      return;
    }

    // Show loading state
    validateBtn.disabled = true;
    validateBtn.textContent = 'Validating...';
    resultsContainer.replaceChildren(
      createLoadingState(
        `Validating ${phones.length} phone number${phones.length > 1 ? 's' : ''}...`
      )
    );

    try {
      phoneResults = await verifyContacts(undefined, phones);
      renderPhoneResults(phoneResults, resultsContainer);
      exportBtn.disabled = false;
    } catch (error) {
      resultsContainer.replaceChildren(
        createEmptyState(
          phoneIconPath,
          `Error: ${error instanceof Error ? error.message : 'Failed to validate phones'}`
        )
      );
      exportBtn.disabled = true;
    } finally {
      validateBtn.disabled = false;
      validateBtn.textContent = 'Validate Phones';
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    phoneResults = null;
    exportBtn.disabled = true;
    resultsContainer.replaceChildren(
      createEmptyState(
        phoneIconPath,
        'Enter phone numbers above and click "Validate Phones" to check them.'
      )
    );
  });

  exportBtn.addEventListener('click', () => {
    if (!phoneResults?.phones) return;
    const csv = exportPhoneResultsToCSV(phoneResults.phones);
    downloadCSV(csv, 'phone-validation-results.csv');
  });
}

function renderPhoneResults(results: ApiResponse, container: HTMLElement): void {
  if (!results.phones) {
    container.replaceChildren(createElement('p', {}, ['No results']));
    return;
  }

  const withWarnings = results.phones.filter((r) => r.warnings.length > 0 && r.isValid).length;

  // Create summary
  const summary = createElement('div', { className: 'results-summary' }, [
    createStatCard(results.summary.totalPhones || 0, 'Total'),
    createStatCard(results.summary.validPhones || 0, 'Valid', 'valid'),
    createStatCard(results.summary.invalidPhones || 0, 'Invalid', 'invalid'),
    createStatCard(withWarnings, 'International', 'warning'),
  ]);

  // Create table
  const headerRow = createElement('tr', {}, [
    createElement('th', {}, ['Original']),
    createElement('th', {}, ['Status']),
    createElement('th', {}, ['Normalized (E.164)']),
    createElement('th', {}, ['Issues']),
  ]);
  const thead = createElement('thead', {}, [headerRow]);

  const tbody = createElement('tbody');
  for (const result of results.phones) {
    tbody.appendChild(createPhoneRow(result));
  }

  const table = createElement('table', { className: 'results-table' }, [thead, tbody]);
  const tableContainer = createElement('div', { className: 'results-table-container' }, [table]);

  container.replaceChildren(summary, tableContainer);
}

function createPhoneRow(result: ApiPhoneResult): HTMLElement {
  // Original cell
  const phoneCode = createElement('code', {}, [result.phone]);
  const phoneCell = createElement('td', {}, [phoneCode]);

  // Status cell
  let statusBadge: HTMLElement;
  if (!result.isValid) {
    statusBadge = createStatusBadge('invalid');
  } else if (result.warnings.length > 0) {
    statusBadge = createStatusBadge('warning');
  } else {
    statusBadge = createStatusBadge('valid');
  }
  const statusCell = createElement('td', {}, [statusBadge]);

  // Normalized cell
  const normalizedCell = createElement('td');
  if (result.normalized) {
    normalizedCell.appendChild(createElement('code', {}, [result.normalized]));
  } else {
    normalizedCell.appendChild(createText('-'));
  }

  // Issues cell
  const issuesCell = createElement('td');
  if (result.errors.length > 0 || result.warnings.length > 0) {
    const ul = createElement('ul', {
      className: result.errors.length > 0 ? 'error-list' : 'warning-list',
    });
    for (const error of result.errors) {
      ul.appendChild(createElement('li', {}, [error]));
    }
    for (const warning of result.warnings) {
      ul.appendChild(createElement('li', {}, [warning]));
    }
    issuesCell.appendChild(ul);
  } else {
    issuesCell.appendChild(createText('-'));
  }

  return createElement('tr', {}, [phoneCell, statusCell, normalizedCell, issuesCell]);
}

// CSV export functions
function exportEmailResultsToCSV(results: ApiEmailResult[]): string {
  const headers = ['Email', 'Valid', 'MX Record', 'Disposable', 'Errors', 'Warnings', 'Suggestion'];
  const rows = results.map((r) => [
    r.email,
    r.isValid ? 'Yes' : 'No',
    r.hasMxRecord === true ? 'Yes' : r.hasMxRecord === false ? 'No' : 'Unknown',
    r.isDisposable ? 'Yes' : 'No',
    r.errors.join('; '),
    r.warnings.join('; '),
    r.suggestion || '',
  ]);

  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function exportPhoneResultsToCSV(results: ApiPhoneResult[]): string {
  const headers = ['Original', 'Valid', 'Normalized (E.164)', 'Errors', 'Warnings'];
  const rows = results.map((r) => [
    r.phone,
    r.isValid ? 'Yes' : 'No',
    r.normalized || '',
    r.errors.join('; '),
    r.warnings.join('; '),
  ]);

  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

// Utility function for CSV download
function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initEmailValidation();
  initPhoneValidation();
});
