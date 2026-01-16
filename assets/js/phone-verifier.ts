/**
 * Phone Verification Utility
 *
 * Provides phone number validation and normalization using the E.164 standard.
 * Built on top of the AfterShip/phone library.
 */

import { phone } from 'phone';

export interface PhoneValidationResult {
  isValid: boolean;
  phoneNumber: string;
  normalizedNumber: string | null;
  countryCode: string | null;
  countryIso2: string | null;
  countryIso3: string | null;
  errors: string[];
  warnings: string[];
}

export interface BulkPhoneValidationResult {
  total: number;
  valid: number;
  invalid: number;
  results: PhoneValidationResult[];
}

/**
 * Format phone number for display (US format)
 */
function formatForDisplay(e164: string): string {
  // Remove the + prefix
  const digits = e164.replace(/^\+/, '');

  // US numbers: +1XXXXXXXXXX -> (XXX) XXX-XXXX
  if (digits.startsWith('1') && digits.length === 11) {
    const areaCode = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7);
    return `(${areaCode}) ${prefix}-${line}`;
  }

  // International format: just add spaces
  return e164;
}

/**
 * Validate a single phone number
 */
export function validatePhone(phoneNumber: string, country: string = 'US'): PhoneValidationResult {
  const result: PhoneValidationResult = {
    isValid: false,
    phoneNumber: phoneNumber,
    normalizedNumber: null,
    countryCode: null,
    countryIso2: null,
    countryIso3: null,
    errors: [],
    warnings: [],
  };

  // Check if phone is provided
  if (!phoneNumber || phoneNumber.trim() === '') {
    // Empty phone is okay (it's optional)
    result.isValid = true;
    return result;
  }

  const cleaned = phoneNumber.trim();

  // Use the phone library for validation
  const phoneResult = phone(cleaned, { country });

  if (phoneResult.isValid) {
    result.isValid = true;
    result.normalizedNumber = phoneResult.phoneNumber;
    result.countryCode = phoneResult.countryCode;
    result.countryIso2 = phoneResult.countryIso2;
    result.countryIso3 = phoneResult.countryIso3;
  } else {
    // Try without country restriction for international numbers
    const internationalResult = phone(cleaned);

    if (internationalResult.isValid) {
      result.isValid = true;
      result.normalizedNumber = internationalResult.phoneNumber;
      result.countryCode = internationalResult.countryCode;
      result.countryIso2 = internationalResult.countryIso2;
      result.countryIso3 = internationalResult.countryIso3;

      if (internationalResult.countryIso2 !== 'US') {
        result.warnings.push(
          `International phone number detected (${internationalResult.countryIso2})`
        );
      }
    } else {
      result.errors.push('Invalid phone number format');

      // Provide helpful suggestions
      const digitsOnly = cleaned.replace(/\D/g, '');
      if (digitsOnly.length < 10) {
        result.errors.push('Phone number appears too short (US numbers need 10 digits)');
      } else if (digitsOnly.length > 15) {
        result.errors.push('Phone number appears too long');
      }
    }
  }

  return result;
}

/**
 * Validate multiple phone numbers (bulk validation)
 */
export function validatePhones(
  phones: string[],
  country: string = 'US'
): BulkPhoneValidationResult {
  const results = phones.map((p) => validatePhone(p, country));

  return {
    total: phones.length,
    valid: results.filter((r) => r.isValid).length,
    invalid: results.filter((r) => !r.isValid).length,
    results,
  };
}

/**
 * Parse phone list from various formats (newline, comma, semicolon separated)
 */
export function parsePhoneList(input: string): string[] {
  return input
    .split(/[\n,;]+/)
    .map((phone) => phone.trim())
    .filter((phone) => phone.length > 0);
}

/**
 * Format a validated phone number for display
 */
export function formatPhone(validationResult: PhoneValidationResult): string {
  if (!validationResult.normalizedNumber) {
    return validationResult.phoneNumber;
  }
  return formatForDisplay(validationResult.normalizedNumber);
}

/**
 * Export validation results to CSV format
 */
export function exportToCSV(results: BulkPhoneValidationResult): string {
  const headers = ['Original', 'Valid', 'Normalized (E.164)', 'Country', 'Errors', 'Warnings'];
  const rows = results.results.map((r) => [
    r.phoneNumber,
    r.isValid ? 'Yes' : 'No',
    r.normalizedNumber || '',
    r.countryIso2 || '',
    r.errors.join('; '),
    r.warnings.join('; '),
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');

  return csvContent;
}

// Default export for convenience
export default {
  validatePhone,
  validatePhones,
  parsePhoneList,
  formatPhone,
  exportToCSV,
};
