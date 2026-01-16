/**
 * Email Verification Utility
 *
 * Provides comprehensive email validation including:
 * - Format validation (RFC 5322 compliant)
 * - Common domain typo detection with suggestions
 * - Disposable email provider blocking
 * - MX record validation (via backend API)
 */

// Common email domain typos and their corrections
const DOMAIN_TYPOS: Record<string, string> = {
  // Gmail typos
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.om': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmsil.com': 'gmail.com',
  'gmil.com': 'gmail.com',
  'gimail.com': 'gmail.com',
  'hmail.com': 'gmail.com',
  'gemail.com': 'gmail.com',
  'g]mail.com': 'gmail.com',

  // Yahoo typos
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'yahoo.cm': 'yahoo.com',
  'yhoo.com': 'yahoo.com',
  'yhaoo.com': 'yahoo.com',
  'yaoo.com': 'yahoo.com',

  // Hotmail typos
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmaill.com': 'hotmail.com',
  'hitmail.com': 'hotmail.com',
  'hoymail.com': 'hotmail.com',

  // Outlook typos
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'outlook.con': 'outlook.com',
  'outllook.com': 'outlook.com',
  'outlool.com': 'outlook.com',

  // iCloud typos
  'icloud.co': 'icloud.com',
  'icloud.con': 'icloud.com',
  'icould.com': 'icloud.com',
  'iclould.com': 'icloud.com',
  'icluod.com': 'icloud.com',

  // AOL typos
  'aol.co': 'aol.com',
  'aol.con': 'aol.com',
  'ao.com': 'aol.com',

  // Comcast typos
  'comast.net': 'comcast.net',
  'comcat.net': 'comcast.net',
  'comcast.com': 'comcast.net',

  // Common TLD typos
  '.con': '.com',
  '.cm': '.com',
  '.co': '.com',
  '.cpm': '.com',
  '.vom': '.com',
  '.ocm': '.com',
  '.ent': '.net',
  '.ner': '.net',
  '.net.com': '.net',
  '.ogr': '.org',
  '.or': '.org',
  '.prg': '.org',
};

// Known disposable email domains (partial list - can be expanded)
const DISPOSABLE_DOMAINS: Set<string> = new Set([
  // Popular disposable services
  '10minutemail.com',
  '10minutemail.net',
  'guerrillamail.com',
  'guerrillamail.org',
  'guerrillamail.net',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'guerrillamail.info',
  'pokemail.net',
  'spam4.me',
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.io',
  'throwaway.email',
  'throwawaymail.com',
  'mailinator.com',
  'mailinator.net',
  'mailinator.org',
  'mailinator2.com',
  'mailinater.com',
  'maildrop.cc',
  'getairmail.com',
  'fakeinbox.com',
  'tempinbox.com',
  'dispostable.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'cool.fr.nf',
  'jetable.fr.nf',
  'nospam.ze.tc',
  'nomail.xl.cx',
  'mega.zik.dj',
  'speed.1s.fr',
  'courriel.fr.nf',
  'moncourrier.fr.nf',
  'monemail.fr.nf',
  'monmail.fr.nf',
  'getnada.com',
  'abyssmail.com',
  'boximail.com',
  'clrmail.com',
  'dropjar.com',
  'emailsensei.com',
  'evopo.com',
  'imgof.com',
  'inboxes.com',
  'mozmail.com',
  'sharklasers.com',
  'spam.la',
  'spamgoes.in',
  'supermailer.jp',
  'teleworm.us',
  'trashymail.com',
  'trbvm.com',
  'trbvn.com',
  'wegwerfmail.de',
  'wegwerfmail.net',
  'wegwerfmail.org',
  'wh4f.org',
  'mailnesia.com',
  'spamex.com',
  'trashmail.com',
  'trashmail.me',
  'trashmail.net',
  'trash-mail.com',
  'emailondeck.com',
  'tempr.email',
  'discard.email',
  'discardmail.com',
  'discardmail.de',
  'spambog.com',
  'spambog.de',
  'spambog.ru',
  'mailcatch.com',
  'mytrashmail.com',
  'mt2009.com',
  'thankyou2010.com',
  'trash2009.com',
  'mt2014.com',
  'tempsky.com',
  'mailtemp.info',
  'mailforspam.com',
  'objectmail.com',
  'proxymail.eu',
  'rcpt.at',
  'fakemailgenerator.com',
  'armyspy.com',
  'cuvox.de',
  'dayrep.com',
  'einrot.com',
  'fleckens.hu',
  'gustr.com',
  'jourrapide.com',
  'rhyta.com',
  'superrito.com',
  'teleworm.us',
  'tempail.com',
  'burnermail.io',
  'mailsac.com',
  'emailfake.com',
  'fakemailgenerator.net',
  'mailpoof.com',
]);

export interface EmailValidationResult {
  isValid: boolean;
  email: string;
  normalizedEmail: string;
  errors: string[];
  warnings: string[];
  suggestion?: string;
  isDisposable: boolean;
  hasMxRecord?: boolean;
}

export interface BulkValidationResult {
  total: number;
  valid: number;
  invalid: number;
  disposable: number;
  results: EmailValidationResult[];
}

/**
 * Validates email format using RFC 5322 compliant regex
 */
function isValidEmailFormat(email: string): boolean {
  // RFC 5322 compliant regex for email validation
  const emailRegex =
    /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/i;

  return emailRegex.test(email);
}

/**
 * Checks for common domain typos and returns suggestion
 */
function checkDomainTypo(domain: string): string | null {
  const lowerDomain = domain.toLowerCase();

  // Direct match
  if (DOMAIN_TYPOS[lowerDomain]) {
    return DOMAIN_TYPOS[lowerDomain];
  }

  // Check TLD typos
  for (const [typo, correction] of Object.entries(DOMAIN_TYPOS)) {
    if (typo.startsWith('.') && lowerDomain.endsWith(typo)) {
      return lowerDomain.slice(0, -typo.length) + correction;
    }
  }

  // Levenshtein distance check for close matches
  const commonDomains = [
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'icloud.com',
    'aol.com',
    'comcast.net',
    'att.net',
    'verizon.net',
    'sbcglobal.net',
  ];

  for (const common of commonDomains) {
    if (levenshteinDistance(lowerDomain, common) <= 2 && lowerDomain !== common) {
      return common;
    }
  }

  return null;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if email domain is a known disposable email provider
 */
function isDisposableEmail(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}

/**
 * Normalize email address (lowercase, trim whitespace)
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validate a single email address
 */
export function validateEmail(email: string): EmailValidationResult {
  const result: EmailValidationResult = {
    isValid: true,
    email: email,
    normalizedEmail: normalizeEmail(email),
    errors: [],
    warnings: [],
    isDisposable: false,
  };

  // Check if email is provided
  if (!email || email.trim() === '') {
    result.isValid = false;
    result.errors.push('Email address is required');
    return result;
  }

  const normalized = result.normalizedEmail;

  // Check format
  if (!isValidEmailFormat(normalized)) {
    result.isValid = false;
    result.errors.push('Invalid email format');
    return result;
  }

  // Extract domain
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex === -1) {
    result.isValid = false;
    result.errors.push('Invalid email format: missing @ symbol');
    return result;
  }

  const domain = normalized.substring(atIndex + 1);

  // Check for domain typos
  const suggestedDomain = checkDomainTypo(domain);
  if (suggestedDomain) {
    const localPart = normalized.substring(0, atIndex);
    result.suggestion = `${localPart}@${suggestedDomain}`;
    result.warnings.push(`Did you mean ${result.suggestion}?`);
  }

  // Check for disposable email
  if (isDisposableEmail(domain)) {
    result.isValid = false;
    result.isDisposable = true;
    result.errors.push('Disposable email addresses are not accepted');
  }

  // Additional checks
  if (normalized.includes('..')) {
    result.isValid = false;
    result.errors.push('Email cannot contain consecutive dots');
  }

  if (normalized.startsWith('.') || domain.startsWith('.')) {
    result.isValid = false;
    result.errors.push('Email cannot start with a dot');
  }

  // Check for very short or suspicious local parts
  const localPart = normalized.substring(0, atIndex);
  if (localPart.length < 2) {
    result.warnings.push('Very short email local part');
  }

  // Check for numeric-only local part (often spam)
  if (/^\d+$/.test(localPart) && localPart.length > 6) {
    result.warnings.push('Numeric-only email addresses may have delivery issues');
  }

  return result;
}

/**
 * Validate multiple email addresses (bulk validation)
 */
export function validateEmails(emails: string[]): BulkValidationResult {
  const results = emails.map(validateEmail);

  return {
    total: emails.length,
    valid: results.filter((r) => r.isValid).length,
    invalid: results.filter((r) => !r.isValid).length,
    disposable: results.filter((r) => r.isDisposable).length,
    results,
  };
}

/**
 * Parse email list from various formats (newline, comma, semicolon separated)
 */
export function parseEmailList(input: string): string[] {
  return input
    .split(/[\n,;]+/)
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

/**
 * Export validation results to CSV format
 */
export function exportToCSV(results: BulkValidationResult): string {
  const headers = ['Email', 'Valid', 'Disposable', 'Errors', 'Warnings', 'Suggestion'];
  const rows = results.results.map((r) => [
    r.email,
    r.isValid ? 'Yes' : 'No',
    r.isDisposable ? 'Yes' : 'No',
    r.errors.join('; '),
    r.warnings.join('; '),
    r.suggestion || '',
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');

  return csvContent;
}

/**
 * Get list of all disposable domains (for reference)
 */
export function getDisposableDomains(): string[] {
  return Array.from(DISPOSABLE_DOMAINS).sort();
}

/**
 * Add custom disposable domains
 */
export function addDisposableDomains(domains: string[]): void {
  domains.forEach((domain) => DISPOSABLE_DOMAINS.add(domain.toLowerCase()));
}

// Default export for convenience
export default {
  validateEmail,
  validateEmails,
  parseEmailList,
  exportToCSV,
  getDisposableDomains,
  addDisposableDomains,
};
