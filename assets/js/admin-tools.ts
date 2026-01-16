/**
 * Admin Tools - Email and Phone Verification
 *
 * Provides bulk validation interface for email and phone numbers.
 * Protected by Cloudflare Access - only accessible to @baytides.org email holders.
 */

import {
  validateEmails,
  parseEmailList,
  exportToCSV as exportEmailsToCSV,
  type EmailValidationResult,
  type BulkValidationResult,
} from './email-verifier';

import {
  validatePhones,
  parsePhoneList,
  exportToCSV as exportPhonesToCSV,
  type PhoneValidationResult,
  type BulkPhoneValidationResult,
} from './phone-verifier';

// Store results for export
let emailResults: BulkValidationResult | null = null;
let phoneResults: BulkPhoneValidationResult | null = null;

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

  validateBtn.addEventListener('click', () => {
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

    emailResults = validateEmails(emails);
    renderEmailResults(emailResults, resultsContainer);
    exportBtn.disabled = false;
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
    if (!emailResults) return;
    downloadCSV(exportEmailsToCSV(emailResults), 'email-validation-results.csv');
  });
}

function renderEmailResults(results: BulkValidationResult, container: HTMLElement): void {
  const withWarnings = results.results.filter((r) => r.warnings.length > 0 && r.isValid).length;

  // Create summary
  const summary = createElement('div', { className: 'results-summary' }, [
    createStatCard(results.total, 'Total'),
    createStatCard(results.valid, 'Valid', 'valid'),
    createStatCard(results.invalid, 'Invalid', 'invalid'),
    createStatCard(withWarnings, 'Warnings', 'warning'),
    createStatCard(results.disposable, 'Disposable', 'disposable'),
  ]);

  // Create table
  const headerRow = createElement('tr', {}, [
    createElement('th', {}, ['Email']),
    createElement('th', {}, ['Status']),
    createElement('th', {}, ['Issues']),
    createElement('th', {}, ['Suggestion']),
  ]);
  const thead = createElement('thead', {}, [headerRow]);

  const tbody = createElement('tbody');
  for (const result of results.results) {
    tbody.appendChild(createEmailRow(result));
  }

  const table = createElement('table', { className: 'results-table' }, [thead, tbody]);
  const tableContainer = createElement('div', { className: 'results-table-container' }, [table]);

  container.replaceChildren(summary, tableContainer);
}

function createEmailRow(result: EmailValidationResult): HTMLElement {
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

  return createElement('tr', {}, [emailCell, statusCell, issuesCell, suggestionCell]);
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

  validateBtn.addEventListener('click', () => {
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

    phoneResults = validatePhones(phones);
    renderPhoneResults(phoneResults, resultsContainer);
    exportBtn.disabled = false;
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
    if (!phoneResults) return;
    downloadCSV(exportPhonesToCSV(phoneResults), 'phone-validation-results.csv');
  });
}

function renderPhoneResults(results: BulkPhoneValidationResult, container: HTMLElement): void {
  const withWarnings = results.results.filter((r) => r.warnings.length > 0 && r.isValid).length;

  // Create summary
  const summary = createElement('div', { className: 'results-summary' }, [
    createStatCard(results.total, 'Total'),
    createStatCard(results.valid, 'Valid', 'valid'),
    createStatCard(results.invalid, 'Invalid', 'invalid'),
    createStatCard(withWarnings, 'International', 'warning'),
  ]);

  // Create table
  const headerRow = createElement('tr', {}, [
    createElement('th', {}, ['Original']),
    createElement('th', {}, ['Status']),
    createElement('th', {}, ['Normalized (E.164)']),
    createElement('th', {}, ['Country']),
    createElement('th', {}, ['Issues']),
  ]);
  const thead = createElement('thead', {}, [headerRow]);

  const tbody = createElement('tbody');
  for (const result of results.results) {
    tbody.appendChild(createPhoneRow(result));
  }

  const table = createElement('table', { className: 'results-table' }, [thead, tbody]);
  const tableContainer = createElement('div', { className: 'results-table-container' }, [table]);

  container.replaceChildren(summary, tableContainer);
}

function createPhoneRow(result: PhoneValidationResult): HTMLElement {
  // Original cell
  const phoneCode = createElement('code', {}, [result.phoneNumber]);
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
  if (result.normalizedNumber) {
    normalizedCell.appendChild(createElement('code', {}, [result.normalizedNumber]));
  } else {
    normalizedCell.appendChild(createText('-'));
  }

  // Country cell
  const countryCell = createElement('td', {}, [result.countryIso2 || '-']);

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

  return createElement('tr', {}, [phoneCell, statusCell, normalizedCell, countryCell, issuesCell]);
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
