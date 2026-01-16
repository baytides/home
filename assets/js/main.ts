/**
 * Bay Tides Main TypeScript
 * Handles theme, navigation, search, accessibility features, form validation, and more
 */

import { validateEmail, type EmailValidationResult } from './email-verifier';
import { validatePhone, type PhoneValidationResult } from './phone-verifier';

// ==========================================================================
// API Constants
// ==========================================================================

const VERIFY_API_ENDPOINT = 'https://donate-tools.baytides.org';

// ==========================================================================
// MX Record Validation (async, server-side)
// ==========================================================================

interface MxValidationResult {
  email: string;
  isValid: boolean;
  hasMxRecord: boolean;
  errors: string[];
}

// Cache MX results to avoid repeated API calls
const mxValidationCache = new Map<string, MxValidationResult>();

async function validateEmailWithMx(email: string): Promise<MxValidationResult> {
  // Check cache first
  const cached = mxValidationCache.get(email.toLowerCase());
  if (cached) return cached;

  try {
    const response = await fetch(`${VERIFY_API_ENDPOINT}/verify-contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: [email] }),
    });

    if (!response.ok) {
      throw new Error('API error');
    }

    const data = await response.json();
    const result = data.emails?.[0];

    if (result) {
      const validationResult: MxValidationResult = {
        email: result.email,
        isValid: result.isValid,
        hasMxRecord: result.hasMxRecord ?? true,
        errors: result.errors || [],
      };
      mxValidationCache.set(email.toLowerCase(), validationResult);
      return validationResult;
    }
  } catch {
    // On error, assume valid to not block the user
  }

  return {
    email,
    isValid: true,
    hasMxRecord: true,
    errors: [],
  };
}

// Helper to show MX validation warning on an input
function showMxWarning(input: HTMLInputElement, message: string): void {
  // Remove any existing warning
  const existingWarning = input.parentElement?.querySelector('.mx-warning');
  existingWarning?.remove();

  // Create warning element
  const warning = document.createElement('div');
  warning.className = 'mx-warning';
  warning.setAttribute('role', 'alert');
  warning.textContent = message;
  warning.style.cssText = 'color: #c53030; font-size: 0.875rem; margin-top: 0.25rem;';

  input.parentElement?.appendChild(warning);
  input.setAttribute('aria-invalid', 'true');
}

function clearMxWarning(input: HTMLInputElement): void {
  const warning = input.parentElement?.querySelector('.mx-warning');
  warning?.remove();
  input.removeAttribute('aria-invalid');
}

// Attach MX validation to an email input (on blur)
function attachMxValidation(input: HTMLInputElement): void {
  input.addEventListener('blur', async () => {
    const email = input.value.trim();
    if (!email) {
      clearMxWarning(input);
      return;
    }

    // First do quick client-side validation
    const quickValidation = validateEmail(email);
    if (!quickValidation.isValid) {
      // Client-side validation will handle the error display
      return;
    }

    // Then do async MX validation
    const mxResult = await validateEmailWithMx(email);
    if (!mxResult.hasMxRecord) {
      showMxWarning(
        input,
        'This email domain does not appear to accept emails. Please check the address.'
      );
    } else if (!mxResult.isValid && mxResult.errors.length > 0) {
      showMxWarning(input, mxResult.errors[0]);
    } else {
      clearMxWarning(input);
    }
  });

  // Clear warning on input
  input.addEventListener('input', () => {
    clearMxWarning(input);
  });
}

// ==========================================================================
// Types
// ==========================================================================

interface ValidationRules {
  required?: boolean;
  minLength?: number;
  type?: 'email' | 'text';
}

interface FieldValidationConfig {
  [fieldName: string]: ValidationRules;
}

// ==========================================================================
// Utility Functions
// ==========================================================================

function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ==========================================================================
// Theme Management
// ==========================================================================

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function setTheme(isDark: boolean, save = false): void {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  if (save) localStorage.setItem('theme', isDark ? 'dark' : 'light');
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
}

// Initialize theme immediately
const savedTheme = localStorage.getItem('theme');
setTheme(savedTheme ? savedTheme === 'dark' : prefersDark.matches);

// Reduced motion
if (prefersReducedMotion.matches) {
  document.documentElement.setAttribute('data-reduced-motion', 'true');
}

// Load saved accessibility preferences
const savedHighContrast = localStorage.getItem('highContrast');
const savedFontSize = localStorage.getItem('fontSize');
const savedReducedMotion = localStorage.getItem('reducedMotion');
const savedColorblind = localStorage.getItem('colorblind');
const savedFocusMode = localStorage.getItem('focusMode');
const savedTextSpacing = localStorage.getItem('textSpacing');

if (savedHighContrast === 'true') {
  document.documentElement.setAttribute('data-high-contrast', 'true');
}
if (savedFontSize) {
  document.documentElement.setAttribute('data-font-size', savedFontSize);
}
if (savedReducedMotion === 'true') {
  document.documentElement.setAttribute('data-reduced-motion', 'true');
}
if (savedColorblind === 'true') {
  document.documentElement.setAttribute('data-colorblind', 'true');
}
if (savedFocusMode === 'true') {
  document.documentElement.setAttribute('data-focus-mode', 'true');
}
if (savedTextSpacing) {
  document.documentElement.setAttribute('data-text-spacing', savedTextSpacing);
}

// ==========================================================================
// Partial Loading
// ==========================================================================

async function loadPartial(
  url: string,
  selector: string,
  position: InsertPosition = 'afterbegin'
): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    const html = await response.text();
    const container = document.querySelector(selector);
    if (container) {
      container.insertAdjacentHTML(position, html);
      return true;
    }
    return false;
  } catch (error) {
    console.warn(`Could not load partial: ${url}`, error);
    return false;
  }
}

// ==========================================================================
// Page Initialization
// ==========================================================================

async function initPage(): Promise<void> {
  const headerPlaceholder = document.getElementById('header-placeholder');
  const footerPlaceholder = document.getElementById('footer-placeholder');

  if (headerPlaceholder) {
    const loaded = await loadPartial('partials/header.html', '#header-placeholder', 'afterbegin');
    if (loaded) {
      headerPlaceholder.removeAttribute('id');
      initNavigation();
    }
  } else {
    initNavigation();
  }

  if (footerPlaceholder) {
    const loaded = await loadPartial('partials/footer.html', '#footer-placeholder', 'afterbegin');
    if (loaded) footerPlaceholder.removeAttribute('id');
  }

  setActiveNavLink();
  initBackToTop();
  initAccessibilityPanel();
  initFormValidation();
  initFormLoading();
  initSponsorsCarousel();
}

function setActiveNavLink(): void {
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll<HTMLAnchorElement>('nav a:not(.btn)').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
}

// ==========================================================================
// Navigation
// ==========================================================================

function initNavigation(): void {
  const mobileToggle = document.querySelector<HTMLButtonElement>('.mobile-menu-toggle');
  const navList = document.querySelector<HTMLUListElement>('nav ul');

  if (mobileToggle && navList) {
    mobileToggle.addEventListener('click', function () {
      const isOpen = navList.classList.toggle('active');
      this.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('nav') && !target.closest('.mobile-menu-toggle')) {
        navList.classList.remove('active');
        mobileToggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navList.classList.contains('active')) {
        navList.classList.remove('active');
        mobileToggle.setAttribute('aria-expanded', 'false');
        mobileToggle.focus();
      }
    });
  }

  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    themeToggle.setAttribute('aria-pressed', currentTheme === 'dark' ? 'true' : 'false');

    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setTheme(!isDark, true);
      announce(`Switched to ${isDark ? 'light' : 'dark'} mode`);
    });

    prefersDark.addEventListener('change', (e) => {
      if (!localStorage.getItem('theme')) setTheme(e.matches);
    });
  }

  initSearch();
}

// ==========================================================================
// Search
// ==========================================================================

function initSearch(): void {
  const searchToggle = document.getElementById('search-toggle');
  const searchOverlay = document.getElementById('search-overlay');
  const searchClose = document.getElementById('search-close');
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
  const searchResults = document.getElementById('search-results');

  if (!searchToggle || !searchOverlay || !searchInput || !searchResults) return;

  const results = searchResults.querySelectorAll<HTMLAnchorElement>('.search-result');
  let lastFocused: HTMLElement | null = null;

  function openSearch(): void {
    lastFocused = document.activeElement as HTMLElement;
    searchOverlay!.hidden = false;
    searchOverlay!.classList.add('active');
    searchToggle!.setAttribute('aria-expanded', 'true');
    searchInput!.value = '';
    results.forEach((result) => (result.style.display = 'none'));
    searchInput!.focus();
    document.body.style.overflow = 'hidden';
  }

  function closeSearch(): void {
    searchOverlay!.classList.remove('active');
    searchToggle!.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
    setTimeout(() => {
      if (!searchOverlay!.classList.contains('active')) {
        searchOverlay!.hidden = true;
      }
    }, 300);
  }

  searchToggle.addEventListener('click', openSearch);
  if (searchClose) searchClose.addEventListener('click', closeSearch);
  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) closeSearch();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchOverlay.classList.contains('active')) {
      closeSearch();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchOverlay.classList.contains('active') ? closeSearch() : openSearch();
    }
  });

  // Filter results with debounce for performance
  const filterResults = debounce((query: string) => {
    if (query === '') {
      results.forEach((result) => (result.style.display = 'none'));
      return;
    }
    let count = 0;
    results.forEach((result) => {
      const text = result.textContent?.toLowerCase() ?? '';
      const matches = text.includes(query);
      result.style.display = matches ? 'block' : 'none';
      if (matches) count++;
    });
    announce(`${count} result${count !== 1 ? 's' : ''} found`);
  }, 150);

  searchInput.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
    filterResults(query);
  });

  // Trap focus
  searchOverlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = searchOverlay.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

// ==========================================================================
// Screen Reader Announcements
// ==========================================================================

let announcer: HTMLDivElement | null = null;

function announce(message: string): void {
  if (!announcer) {
    announcer = document.createElement('div');
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    announcer.className = 'sr-only';
    document.body.appendChild(announcer);
  }
  announcer.textContent = '';
  setTimeout(() => {
    if (announcer) announcer.textContent = message;
  }, 100);
}

// ==========================================================================
// Back to Top Button
// ==========================================================================

function initBackToTop(): void {
  const btn = document.createElement('button');
  btn.className = 'back-to-top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M18 15l-6-6-6 6"/>
  </svg>`;
  document.body.appendChild(btn);

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        btn.classList.toggle('visible', window.scrollY > 300);
        ticking = false;
      });
      ticking = true;
    }
  });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ==========================================================================
// Accessibility Panel
// ==========================================================================

function initAccessibilityPanel(): void {
  const toggle = document.createElement('button');
  toggle.className = 'accessibility-toggle';
  toggle.setAttribute('aria-label', 'Accessibility options');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9H15V22H13V16H11V22H9V9H3V7H21V9Z"/>
  </svg>`;
  document.body.appendChild(toggle);

  const panel = document.createElement('div');
  panel.className = 'accessibility-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Accessibility settings');
  panel.innerHTML = `
    <h3>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="18" height="18">
        <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9H15V22H13V16H11V22H9V9H3V7H21V9Z"/>
      </svg>
      Accessibility
    </h3>

    <div class="panel-section">
      <div class="panel-section-title">Vision</div>
      <label>
        <input type="checkbox" id="high-contrast-toggle">
        High Contrast
      </label>
      <label>
        <input type="checkbox" id="colorblind-toggle">
        Colorblind Mode
      </label>
      <label>
        Font Size
        <select id="font-size-select">
          <option value="default">Default</option>
          <option value="large">Large</option>
          <option value="xlarge">Extra Large</option>
        </select>
      </label>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Reading</div>
      <label>
        Text Spacing
        <select id="text-spacing-select">
          <option value="default">Default</option>
          <option value="comfortable">Comfortable</option>
          <option value="spacious">Spacious</option>
        </select>
      </label>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Motion & Focus</div>
      <label>
        <input type="checkbox" id="reduced-motion-toggle">
        Reduce Motion
      </label>
      <label>
        <input type="checkbox" id="focus-mode-toggle">
        Focus Mode
      </label>
    </div>

    <button type="button" class="reset-btn" id="accessibility-reset">
      Reset to Defaults
    </button>
  `;
  document.body.appendChild(panel);

  const highContrastToggle = document.getElementById('high-contrast-toggle') as HTMLInputElement;
  const colorblindToggle = document.getElementById('colorblind-toggle') as HTMLInputElement;
  const reducedMotionToggle = document.getElementById('reduced-motion-toggle') as HTMLInputElement;
  const focusModeToggle = document.getElementById('focus-mode-toggle') as HTMLInputElement;
  const fontSizeSelect = document.getElementById('font-size-select') as HTMLSelectElement;
  const textSpacingSelect = document.getElementById('text-spacing-select') as HTMLSelectElement;
  const resetBtn = document.getElementById('accessibility-reset') as HTMLButtonElement;

  // Initialize from saved preferences
  highContrastToggle.checked =
    document.documentElement.getAttribute('data-high-contrast') === 'true';
  colorblindToggle.checked = document.documentElement.getAttribute('data-colorblind') === 'true';
  reducedMotionToggle.checked =
    document.documentElement.getAttribute('data-reduced-motion') === 'true';
  focusModeToggle.checked = document.documentElement.getAttribute('data-focus-mode') === 'true';
  fontSizeSelect.value = document.documentElement.getAttribute('data-font-size') || 'default';
  textSpacingSelect.value = document.documentElement.getAttribute('data-text-spacing') || 'default';

  toggle.addEventListener('click', () => {
    const isVisible = panel.classList.toggle('visible');
    toggle.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
  });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.accessibility-panel') && !target.closest('.accessibility-toggle')) {
      panel.classList.remove('visible');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Escape key closes panel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('visible')) {
      panel.classList.remove('visible');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });

  highContrastToggle.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    if (enabled) {
      document.documentElement.setAttribute('data-high-contrast', 'true');
      localStorage.setItem('highContrast', 'true');
    } else {
      document.documentElement.removeAttribute('data-high-contrast');
      localStorage.removeItem('highContrast');
    }
    showToast(`High contrast ${enabled ? 'enabled' : 'disabled'}`, 'info');
    announce(`High contrast ${enabled ? 'enabled' : 'disabled'}`);
  });

  colorblindToggle.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    if (enabled) {
      document.documentElement.setAttribute('data-colorblind', 'true');
      localStorage.setItem('colorblind', 'true');
    } else {
      document.documentElement.removeAttribute('data-colorblind');
      localStorage.removeItem('colorblind');
    }
    showToast(`Colorblind mode ${enabled ? 'enabled' : 'disabled'}`, 'info');
    announce(`Colorblind mode ${enabled ? 'enabled' : 'disabled'}`);
  });

  reducedMotionToggle.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    if (enabled) {
      document.documentElement.setAttribute('data-reduced-motion', 'true');
      localStorage.setItem('reducedMotion', 'true');
    } else {
      document.documentElement.removeAttribute('data-reduced-motion');
      localStorage.removeItem('reducedMotion');
    }
    showToast(`Reduced motion ${enabled ? 'enabled' : 'disabled'}`, 'info');
    announce(`Reduced motion ${enabled ? 'enabled' : 'disabled'}`);
  });

  focusModeToggle.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    if (enabled) {
      document.documentElement.setAttribute('data-focus-mode', 'true');
      localStorage.setItem('focusMode', 'true');
    } else {
      document.documentElement.removeAttribute('data-focus-mode');
      localStorage.removeItem('focusMode');
    }
    showToast(`Focus mode ${enabled ? 'enabled' : 'disabled'}`, 'info');
    announce(`Focus mode ${enabled ? 'enabled' : 'disabled'}`);
  });

  fontSizeSelect.addEventListener('change', (e) => {
    const size = (e.target as HTMLSelectElement).value;
    if (size === 'default') {
      document.documentElement.removeAttribute('data-font-size');
      localStorage.removeItem('fontSize');
    } else {
      document.documentElement.setAttribute('data-font-size', size);
      localStorage.setItem('fontSize', size);
    }
    showToast(`Font size set to ${size}`, 'info');
    announce(`Font size set to ${size}`);
  });

  textSpacingSelect.addEventListener('change', (e) => {
    const spacing = (e.target as HTMLSelectElement).value;
    if (spacing === 'default') {
      document.documentElement.removeAttribute('data-text-spacing');
      localStorage.removeItem('textSpacing');
    } else {
      document.documentElement.setAttribute('data-text-spacing', spacing);
      localStorage.setItem('textSpacing', spacing);
    }
    showToast(`Text spacing set to ${spacing}`, 'info');
    announce(`Text spacing set to ${spacing}`);
  });

  resetBtn.addEventListener('click', () => {
    // Reset all accessibility preferences
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-colorblind');
    document.documentElement.removeAttribute('data-reduced-motion');
    document.documentElement.removeAttribute('data-focus-mode');
    document.documentElement.removeAttribute('data-font-size');
    document.documentElement.removeAttribute('data-text-spacing');

    localStorage.removeItem('highContrast');
    localStorage.removeItem('colorblind');
    localStorage.removeItem('reducedMotion');
    localStorage.removeItem('focusMode');
    localStorage.removeItem('fontSize');
    localStorage.removeItem('textSpacing');

    // Reset UI controls
    highContrastToggle.checked = false;
    colorblindToggle.checked = false;
    reducedMotionToggle.checked = false;
    focusModeToggle.checked = false;
    fontSizeSelect.value = 'default';
    textSpacingSelect.value = 'default';

    showToast('Accessibility settings reset to defaults', 'success');
    announce('Accessibility settings reset to defaults');
  });
}

// ==========================================================================
// Toast Notification System
// ==========================================================================

type ToastType = 'success' | 'error' | 'info';

function showToast(message: string, type: ToastType = 'info'): void {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');

  const iconMap: Record<ToastType, string> = {
    success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M20 6L9 17l-5-5"/>
    </svg>`,
    error: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <path d="M15 9l-6 6M9 9l6 6"/>
    </svg>`,
    info: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 16v-4M12 8h.01"/>
    </svg>`,
  };

  toast.innerHTML = `
    ${iconMap[type]}
    <span class="toast-message">${message}</span>
    <button type="button" class="toast-close" aria-label="Dismiss">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
  `;

  container.appendChild(toast);

  const closeBtn = toast.querySelector('.toast-close');
  closeBtn?.addEventListener('click', () => dismissToast(toast));

  // Auto-dismiss after 5 seconds
  setTimeout(() => dismissToast(toast), 5000);
}

function dismissToast(toast: Element): void {
  toast.classList.add('toast-exit');
  setTimeout(() => toast.remove(), 300);
}

// ==========================================================================
// Form Validation
// ==========================================================================

function initFormValidation(): void {
  const contactForm = document.getElementById('contact-form') as HTMLFormElement | null;
  if (!contactForm) return;

  const fields: FieldValidationConfig = {
    name: { required: true, minLength: 2 },
    email: { required: true, type: 'email' },
    message: { required: true, minLength: 10 },
  };

  function validateField(
    input: HTMLInputElement | HTMLTextAreaElement,
    rules: ValidationRules
  ): boolean {
    const value = input.value.trim();
    let error = '';

    if (rules.required && !value) {
      error = 'This field is required';
    } else if (rules.minLength && value.length < rules.minLength) {
      error = `Must be at least ${rules.minLength} characters`;
    } else if (rules.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      error = 'Please enter a valid email address';
    }

    const existingError = input.parentElement?.querySelector('.field-error');
    if (existingError) existingError.remove();

    if (error) {
      input.classList.add('error');
      input.setAttribute('aria-invalid', 'true');
      const errorEl = document.createElement('span');
      errorEl.className = 'field-error';
      errorEl.setAttribute('role', 'alert');
      errorEl.textContent = error;
      input.parentElement?.appendChild(errorEl);
      return false;
    } else {
      input.classList.remove('error');
      input.removeAttribute('aria-invalid');
      return true;
    }
  }

  Object.keys(fields).forEach((fieldName) => {
    const input = contactForm.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[name="${fieldName}"]`
    );
    if (input) {
      input.addEventListener('blur', () => validateField(input, fields[fieldName]));
    }
  });

  // Attach MX validation to email input for async domain verification
  const emailInput = contactForm.querySelector<HTMLInputElement>('[name="email"]');
  if (emailInput) {
    attachMxValidation(emailInput);
  }

  let isSubmitting = false;

  contactForm.addEventListener('submit', (e) => {
    // Prevent double-submit
    if (isSubmitting) {
      e.preventDefault();
      return;
    }

    let isValid = true;
    Object.keys(fields).forEach((fieldName) => {
      const input = contactForm.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[name="${fieldName}"]`
      );
      if (input && !validateField(input, fields[fieldName])) {
        isValid = false;
      }
    });

    if (!isValid) {
      e.preventDefault();
      const firstError = contactForm.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstError.focus();
      }
    } else {
      isSubmitting = true;
    }
  });
}

// ==========================================================================
// Form Loading State
// ==========================================================================

function initFormLoading(): void {
  document.querySelectorAll<HTMLFormElement>('form').forEach((form) => {
    form.addEventListener('submit', function () {
      const submitBtn = this.querySelector<HTMLButtonElement>('[type="submit"]');
      if (submitBtn) {
        submitBtn.classList.add('loading');
        submitBtn.setAttribute('aria-busy', 'true');
      }
    });
  });

  // Attach MX validation to newsletter form email input
  const newsletterEmailInput = document.getElementById(
    'newsletter-email'
  ) as HTMLInputElement | null;
  if (newsletterEmailInput) {
    attachMxValidation(newsletterEmailInput);
  }

  const params = new URLSearchParams(window.location.search);
  const statusDiv = document.getElementById('contact-form-status');
  const newsletterStatusDiv = document.getElementById('newsletter-form-status');

  if (params.get('submitted') === 'true' && statusDiv) {
    statusDiv.innerHTML =
      '<div class="form-status success" role="alert">Thank you! Your message has been sent successfully.</div>';
  } else if (params.get('subscribed') === 'true' && newsletterStatusDiv) {
    newsletterStatusDiv.innerHTML =
      '<div class="form-status success" role="alert">Thank you for subscribing to our newsletter!</div>';
  } else if (params.get('error') && statusDiv) {
    const errorMessages: Record<string, string> = {
      spam: 'Your submission was flagged as spam.',
      captcha: 'CAPTCHA verification failed. Please try again.',
    };
    statusDiv.innerHTML = `<div class="form-status error" role="alert">${errorMessages[params.get('error')!] || 'An error occurred. Please try again.'}</div>`;
  }
}

// ==========================================================================
// Sponsors Carousel
// ==========================================================================

function initSponsorsCarousel(): void {
  const wrapper = document.querySelector<HTMLDivElement>('.sponsors-wrapper');
  if (!wrapper) return;

  const track = wrapper.querySelector<HTMLDivElement>('.sponsors-track');
  const prevBtn = wrapper.querySelector<HTMLButtonElement>('.sponsors-nav.prev');
  const nextBtn = wrapper.querySelector<HTMLButtonElement>('.sponsors-nav.next');
  const viewport = wrapper.querySelector<HTMLDivElement>('.sponsors-viewport');
  const logosContainer = wrapper.querySelector<HTMLDivElement>('.sponsors-logos');

  if (!track || !prevBtn || !nextBtn || !viewport || !logosContainer) return;

  const logos = Array.from(logosContainer.querySelectorAll<HTMLImageElement>('.sponsor-logo'));

  // Calculate dimensions
  function getLogoWidth(): number {
    return logos[0] ? logos[0].getBoundingClientRect().width + 64 : 104;
  }

  let logoWidth = getLogoWidth();
  let totalWidth = logos.length * logoWidth;

  // Clone logos for infinite scroll
  logos.forEach((logo) => {
    const clone = logo.cloneNode(true) as HTMLImageElement;
    clone.setAttribute('aria-hidden', 'true');
    clone.removeAttribute('alt');
    logosContainer.appendChild(clone);
  });

  let position = 0;
  let autoplayAnimationId: number | null = null;
  let lastAutoplayTime = 0;
  const autoplayDelay = 3000;

  function slideTo(newPosition: number): void {
    if (newPosition >= totalWidth) {
      track!.style.transition = 'none';
      position = 0;
      track!.style.transform = `translateX(-${position}px)`;
      track!.offsetHeight; // Force reflow
      track!.style.transition = 'transform 0.5s ease';
      return;
    }
    if (newPosition < 0) {
      track!.style.transition = 'none';
      position = totalWidth - logoWidth;
      track!.style.transform = `translateX(-${position}px)`;
      track!.offsetHeight;
      track!.style.transition = 'transform 0.5s ease';
      return;
    }
    position = newPosition;
    track!.style.transform = `translateX(-${position}px)`;
  }

  function slideNext(): void {
    slideTo(position + logoWidth);
  }

  // Use requestAnimationFrame for smoother autoplay
  function autoplayLoop(timestamp: number): void {
    if (!lastAutoplayTime) lastAutoplayTime = timestamp;
    const elapsed = timestamp - lastAutoplayTime;

    if (elapsed >= autoplayDelay) {
      slideNext();
      lastAutoplayTime = timestamp;
    }

    autoplayAnimationId = requestAnimationFrame(autoplayLoop);
  }

  function startAutoplay(): void {
    stopAutoplay();
    lastAutoplayTime = 0;
    autoplayAnimationId = requestAnimationFrame(autoplayLoop);
  }

  function stopAutoplay(): void {
    if (autoplayAnimationId) {
      cancelAnimationFrame(autoplayAnimationId);
      autoplayAnimationId = null;
    }
  }

  nextBtn.addEventListener('click', () => {
    slideNext();
    startAutoplay();
  });

  prevBtn.addEventListener('click', () => {
    slideTo(position - logoWidth);
    startAutoplay();
  });

  wrapper.addEventListener('mouseenter', stopAutoplay);
  wrapper.addEventListener('mouseleave', startAutoplay);
  wrapper.addEventListener('focusin', stopAutoplay);
  wrapper.addEventListener('focusout', startAutoplay);

  // Recalculate on resize
  const handleResize = debounce(() => {
    logoWidth = getLogoWidth();
    totalWidth = logos.length * logoWidth;
    // Reset position if it's out of bounds
    if (position > totalWidth) {
      position = 0;
      track!.style.transform = `translateX(-${position}px)`;
    }
  }, 150);

  window.addEventListener('resize', handleResize);

  if (!prefersReducedMotion.matches) {
    startAutoplay();
  }
}

// ==========================================================================
// Keyboard Navigation Detection
// ==========================================================================

function initKeyboardDetection(): void {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      document.body.classList.add('using-keyboard');
    }
  });

  document.addEventListener('mousedown', () => {
    document.body.classList.remove('using-keyboard');
  });
}

// ==========================================================================
// Service Worker Update Notification
// ==========================================================================

function initServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      // Check for updates periodically
      setInterval(() => registration.update(), 60 * 60 * 1000); // Check hourly

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New content is available, show notification
            showUpdateNotification(registration);
          }
        });
      });
    })
    .catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
}

function showUpdateNotification(registration: ServiceWorkerRegistration): void {
  const notification = document.createElement('div');
  notification.className = 'update-notification';
  notification.setAttribute('role', 'alert');
  notification.innerHTML = `
    <span>A new version is available.</span>
    <button type="button" class="update-btn">Refresh</button>
    <button type="button" class="dismiss-btn" aria-label="Dismiss">&times;</button>
  `;

  document.body.appendChild(notification);

  // Animate in
  requestAnimationFrame(() => {
    notification.classList.add('visible');
  });

  const refreshBtn = notification.querySelector('.update-btn');
  const dismissBtn = notification.querySelector('.dismiss-btn');

  refreshBtn?.addEventListener('click', () => {
    if (registration.waiting) {
      registration.waiting.postMessage('skipWaiting');
    }
    window.location.reload();
  });

  dismissBtn?.addEventListener('click', () => {
    notification.classList.remove('visible');
    setTimeout(() => notification.remove(), 300);
  });
}

// ==========================================================================
// Donation Form with Stripe Elements
// ==========================================================================

// Declare Stripe types
declare const Stripe: (key: string) => {
  elements: (options: { clientSecret: string; appearance?: object }) => {
    create: (
      type: string,
      options?: object
    ) => {
      mount: (selector: string) => void;
      on: (
        event: string,
        handler: (e: { complete: boolean; error?: { message: string } }) => void
      ) => void;
    };
  };
  confirmPayment: (options: {
    elements: ReturnType<ReturnType<ReturnType<typeof Stripe>['elements']>['create']>;
    confirmParams: { return_url: string; receipt_email?: string };
    redirect?: 'if_required';
  }) => Promise<{ error?: { message: string }; paymentIntent?: { status: string } }>;
};

function initDonationForm(): void {
  const donationForm = document.getElementById('donation-form');
  if (!donationForm) return;

  // Check if Stripe is available
  if (typeof Stripe === 'undefined') {
    console.warn('Stripe.js not loaded');
    return;
  }

  // Elements
  const typeButtons = donationForm.querySelectorAll<HTMLButtonElement>('.toggle-btn');
  const amountButtons = donationForm.querySelectorAll<HTMLButtonElement>('.amount-btn');
  const customAmountWrapper = document.getElementById('custom-amount-wrapper');
  const customAmountInput = document.getElementById('custom-amount') as HTMLInputElement | null;
  const fundSelect = document.getElementById('fund-select') as HTMLSelectElement | null;
  const tributeTypeSelect = document.getElementById('tribute-type') as HTMLSelectElement | null;
  const tributeNameWrapper = document.getElementById('tribute-name-wrapper');
  const tributeNameInput = document.getElementById('tribute-name') as HTMLInputElement | null;
  const anonymousCheckbox = document.getElementById(
    'anonymous-checkbox'
  ) as HTMLInputElement | null;
  const statusDiv = document.getElementById('donation-status');

  // Payment section elements
  const paymentSection = document.getElementById('payment-section');
  const amountSectionActions = document.getElementById('amount-section-actions');
  const continueBtn = document.getElementById('continue-btn') as HTMLButtonElement | null;
  const submitPaymentBtn = document.getElementById(
    'submit-payment-btn'
  ) as HTMLButtonElement | null;
  const editAmountBtn = document.getElementById('edit-amount-btn');
  const paymentErrorsDiv = document.getElementById('payment-errors');

  // Donor info inputs
  const donorFirstNameInput = document.getElementById(
    'donor-first-name'
  ) as HTMLInputElement | null;
  const donorLastNameInput = document.getElementById('donor-last-name') as HTMLInputElement | null;
  const donorEmailInput = document.getElementById('donor-email') as HTMLInputElement | null;
  const donorAddressInput = document.getElementById('donor-address') as HTMLInputElement | null;
  const donorCityInput = document.getElementById('donor-city') as HTMLInputElement | null;
  const donorStateInput = document.getElementById('donor-state') as HTMLInputElement | null;
  const donorZipInput = document.getElementById('donor-zip') as HTMLInputElement | null;
  const donorPhoneInput = document.getElementById('donor-phone') as HTMLInputElement | null;
  const donorOrgInput = document.getElementById('donor-org') as HTMLInputElement | null;

  // State
  let donationType: 'one-time' | 'monthly' = 'one-time';
  let selectedAmount = 100;
  let isCustomAmount = false;
  let isSubmitting = false;

  // Stripe state
  const stripePublicKey =
    'pk_live_51Qu3c4I4J9kYJwLIc8a3F2Y0d0QZZv5VvnBqw5gYhF1mzk4K6jNjjvx8hOvvPwI1hXO3KONWvL6YVf6Z4UGBx5Dd00EYr1ZKJI';
  const stripe = Stripe(stripePublicKey);
  let elements: ReturnType<typeof stripe.elements> | null = null;
  let paymentElement: ReturnType<ReturnType<typeof stripe.elements>['create']> | null = null;
  let clientSecret: string | null = null;

  const apiEndpoint = 'https://donate-tools.baytides.org';

  // Attach MX validation to donor email input
  if (donorEmailInput) {
    attachMxValidation(donorEmailInput);
  }

  function updateContinueButton(): void {
    if (!continueBtn) return;
    const amountText = selectedAmount > 0 ? `$${selectedAmount}` : '';
    const typeText = donationType === 'monthly' ? '/month' : '';
    continueBtn.textContent = `Continue to Payment${amountText ? ' • ' + amountText : ''}${typeText}`;
  }

  function updateSubmitButton(): void {
    if (!submitPaymentBtn) return;
    const amountText = selectedAmount > 0 ? `$${selectedAmount}` : '';
    const typeText = donationType === 'monthly' ? '/month' : '';
    submitPaymentBtn.textContent = isSubmitting
      ? 'Processing...'
      : `Complete Donation${amountText ? ' • ' + amountText : ''}${typeText}`;
  }

  function showStatus(message: string, isError: boolean): void {
    if (!statusDiv) return;
    statusDiv.textContent = '';
    const statusEl = document.createElement('div');
    statusEl.className = `form-status ${isError ? 'error' : 'success'}`;
    statusEl.setAttribute('role', 'alert');
    statusEl.textContent = message;
    statusDiv.appendChild(statusEl);
    statusDiv.style.display = 'block';
  }

  function showPaymentError(message: string): void {
    if (paymentErrorsDiv) {
      paymentErrorsDiv.textContent = message;
    }
  }

  function clearPaymentError(): void {
    if (paymentErrorsDiv) {
      paymentErrorsDiv.textContent = '';
    }
  }

  // Create Payment Intent and initialize Stripe Elements
  async function initializePayment(): Promise<boolean> {
    try {
      // Create payment intent via API
      const response = await fetch(`${apiEndpoint}/create-payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: selectedAmount,
          frequency: donationType,
          fund: fundSelect?.value || 'General Fund',
          tributeType: tributeTypeSelect?.value || 'none',
          tributeName: tributeNameInput?.value || '',
          anonymous: anonymousCheckbox?.checked || false,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to initialize payment');
      }

      const data = await response.json();
      clientSecret = data.clientSecret;

      if (!clientSecret) {
        throw new Error('No client secret returned');
      }

      // Get current theme
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

      // Create Stripe Elements with the client secret
      const appearance = {
        theme: isDark ? 'night' : 'stripe',
        variables: {
          colorPrimary: '#2b6cb0',
          colorBackground: isDark ? '#1a202c' : '#ffffff',
          colorText: isDark ? '#e2e8f0' : '#1a202c',
          colorDanger: '#9b1c1c',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          borderRadius: '12px',
          spacingUnit: '4px',
        },
        rules: {
          '.Input': {
            border: '2px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0'),
            padding: '12px 16px',
          },
          '.Input:focus': {
            border: '2px solid #2b6cb0',
            boxShadow: '0 0 0 3px rgba(43, 108, 176, 0.1)',
          },
          '.Label': {
            fontWeight: '600',
            marginBottom: '8px',
          },
        },
      };

      elements = stripe.elements({ clientSecret, appearance });
      paymentElement = elements.create('payment', {
        layout: 'tabs',
      });

      // Mount the Payment Element
      paymentElement.mount('#payment-element');

      // Listen for changes to enable/disable submit button
      paymentElement.on('change', (event: { complete: boolean; error?: { message: string } }) => {
        if (submitPaymentBtn) {
          submitPaymentBtn.disabled = !event.complete;
        }
        if (event.error) {
          showPaymentError(event.error.message);
        } else {
          clearPaymentError();
        }
      });

      return true;
    } catch (error) {
      console.error('Payment initialization error:', error);
      showPaymentError('Unable to initialize payment. Please try again.');
      return false;
    }
  }

  // Handle Continue button click - show payment section
  async function handleContinue(): Promise<void> {
    if (selectedAmount < 1) {
      showStatus('Please select or enter a donation amount.', true);
      return;
    }

    // Show loading state
    if (continueBtn) {
      continueBtn.textContent = 'Loading...';
      continueBtn.disabled = true;
    }

    // Initialize payment
    const success = await initializePayment();

    if (success) {
      // Hide amount section actions, show payment section
      if (amountSectionActions) amountSectionActions.style.display = 'none';
      if (paymentSection) paymentSection.style.display = 'block';

      // Create summary
      createDonationSummary();

      // Collapse amount selection
      donationForm.classList.add('amount-selection-collapsed');

      // Focus email input
      donorEmailInput?.focus();

      // Update submit button
      updateSubmitButton();
    } else {
      // Reset continue button
      if (continueBtn) {
        continueBtn.disabled = false;
        updateContinueButton();
      }
    }
  }

  // Create donation summary
  function createDonationSummary(): void {
    // Remove existing summary if any
    const existingSummary = donationForm.querySelector('.donation-summary');
    if (existingSummary) existingSummary.remove();

    const summary = document.createElement('div');
    summary.className = 'donation-summary';

    const typeLabel = donationType === 'monthly' ? 'Monthly donation' : 'One-time donation';
    const fund = fundSelect?.value || 'General Fund';

    let html = `
      <div class="summary-row">
        <span class="summary-label">Type</span>
        <span class="summary-value">${typeLabel}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Fund</span>
        <span class="summary-value">${fund}</span>
      </div>
    `;

    if (tributeTypeSelect?.value && tributeTypeSelect.value !== 'none') {
      const tributeLabel = tributeTypeSelect.value === 'in_honor' ? 'In honor of' : 'In memory of';
      const tributeName = tributeNameInput?.value || '';
      if (tributeName) {
        html += `
          <div class="summary-row">
            <span class="summary-label">${tributeLabel}</span>
            <span class="summary-value">${tributeName}</span>
          </div>
        `;
      }
    }

    html += `
      <div class="summary-row">
        <span class="summary-label">Amount</span>
        <span class="summary-value summary-total">$${selectedAmount}${donationType === 'monthly' ? '/month' : ''}</span>
      </div>
    `;

    summary.innerHTML = html;

    // Insert after payment section header
    const header = paymentSection?.querySelector('.payment-section-header');
    if (header) {
      header.insertAdjacentElement('afterend', summary);
    }
  }

  // Handle Edit Amount button
  function handleEditAmount(): void {
    // Show amount section, hide payment section
    donationForm.classList.remove('amount-selection-collapsed');
    if (paymentSection) paymentSection.style.display = 'none';
    if (amountSectionActions) amountSectionActions.style.display = 'block';

    // Reset continue button
    if (continueBtn) {
      continueBtn.disabled = false;
      updateContinueButton();
    }

    // Remove summary
    const summary = donationForm.querySelector('.donation-summary');
    if (summary) summary.remove();

    // Clear payment element
    const paymentElementContainer = document.getElementById('payment-element');
    if (paymentElementContainer) paymentElementContainer.innerHTML = '';

    elements = null;
    paymentElement = null;
    clientSecret = null;
  }

  // Validate required donor fields
  function validateDonorInfo(): {
    valid: boolean;
    message?: string;
    field?: HTMLInputElement;
    emailSuggestion?: string;
  } {
    const firstName = donorFirstNameInput?.value?.trim();
    const lastName = donorLastNameInput?.value?.trim();
    const email = donorEmailInput?.value?.trim();
    const address = donorAddressInput?.value?.trim();
    const city = donorCityInput?.value?.trim();
    const state = donorStateInput?.value?.trim();
    const zip = donorZipInput?.value?.trim();

    if (!firstName)
      return {
        valid: false,
        message: 'Please enter your first name.',
        field: donorFirstNameInput!,
      };
    if (!lastName)
      return { valid: false, message: 'Please enter your last name.', field: donorLastNameInput! };
    if (!email)
      return { valid: false, message: 'Please enter your email address.', field: donorEmailInput! };

    // Use comprehensive email validation
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      const errorMessage = emailValidation.errors[0] || 'Please enter a valid email address.';
      return {
        valid: false,
        message: errorMessage,
        field: donorEmailInput!,
        emailSuggestion: emailValidation.suggestion,
      };
    }

    // If there's a typo suggestion, warn but don't block
    if (emailValidation.suggestion) {
      return {
        valid: false,
        message: `Did you mean ${emailValidation.suggestion}?`,
        field: donorEmailInput!,
        emailSuggestion: emailValidation.suggestion,
      };
    }

    if (!address)
      return {
        valid: false,
        message: 'Please enter your street address.',
        field: donorAddressInput!,
      };
    if (!city) return { valid: false, message: 'Please enter your city.', field: donorCityInput! };
    if (!state)
      return { valid: false, message: 'Please enter your state.', field: donorStateInput! };
    if (!zip)
      return { valid: false, message: 'Please enter your ZIP code.', field: donorZipInput! };

    // Validate phone if provided (optional field, but should be valid if entered)
    const phone = donorPhoneInput?.value?.trim();
    if (phone) {
      const phoneValidation = validatePhone(phone);
      if (!phoneValidation.isValid) {
        const errorMessage = phoneValidation.errors[0] || 'Please enter a valid phone number.';
        return {
          valid: false,
          message: errorMessage,
          field: donorPhoneInput!,
        };
      }
    }

    return { valid: true };
  }

  // Track if user has dismissed email suggestion
  let emailSuggestionDismissed = false;

  // Get donor info object
  function getDonorInfo() {
    return {
      firstName: donorFirstNameInput?.value?.trim() || '',
      lastName: donorLastNameInput?.value?.trim() || '',
      email: donorEmailInput?.value?.trim() || '',
      address: {
        line1: donorAddressInput?.value?.trim() || '',
        city: donorCityInput?.value?.trim() || '',
        state: donorStateInput?.value?.trim() || '',
        postal_code: donorZipInput?.value?.trim() || '',
        country: 'US',
      },
      phone: donorPhoneInput?.value?.trim() || '',
      organization: donorOrgInput?.value?.trim() || '',
    };
  }

  // Handle payment submission
  async function handlePaymentSubmit(): Promise<void> {
    if (isSubmitting || !elements || !clientSecret) return;

    // Validate donor info
    const validation = validateDonorInfo();
    if (!validation.valid) {
      // Special handling for email suggestions - allow user to proceed if they've seen the suggestion
      if (validation.emailSuggestion && !emailSuggestionDismissed) {
        showPaymentError(
          `${validation.message} <button type="button" class="email-suggestion-btn" id="use-suggested-email">Use this</button> or <button type="button" class="email-suggestion-dismiss" id="dismiss-suggestion">Keep my email</button>`
        );
        validation.field?.focus();

        // Add event listeners for suggestion buttons
        const useSuggestedBtn = document.getElementById('use-suggested-email');
        const dismissBtn = document.getElementById('dismiss-suggestion');

        useSuggestedBtn?.addEventListener('click', () => {
          if (donorEmailInput && validation.emailSuggestion) {
            donorEmailInput.value = validation.emailSuggestion;
            clearPaymentError();
            emailSuggestionDismissed = false;
          }
        });

        dismissBtn?.addEventListener('click', () => {
          emailSuggestionDismissed = true;
          clearPaymentError();
          // Re-trigger submission
          handlePaymentSubmit();
        });

        return;
      }

      showPaymentError(validation.message || 'Please fill in all required fields.');
      validation.field?.focus();
      return;
    }

    const donorInfo = getDonorInfo();

    isSubmitting = true;
    if (submitPaymentBtn) {
      submitPaymentBtn.disabled = true;
      submitPaymentBtn.textContent = 'Processing...';
    }
    clearPaymentError();

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements: paymentElement!,
        confirmParams: {
          return_url: `${window.location.origin}/donate.html?success=true`,
          receipt_email: donorInfo.email,
          payment_method_data: {
            billing_details: {
              name: `${donorInfo.firstName} ${donorInfo.lastName}`,
              email: donorInfo.email,
              phone: donorInfo.phone || undefined,
              address: donorInfo.address,
            },
          },
        },
        redirect: 'if_required',
      });

      if (error) {
        showPaymentError(error.message || 'Payment failed. Please try again.');
        isSubmitting = false;
        if (submitPaymentBtn) {
          submitPaymentBtn.disabled = false;
          updateSubmitButton();
        }
      } else if (paymentIntent?.status === 'succeeded') {
        // Payment succeeded without redirect
        showStatus(
          `Thank you, ${donorInfo.firstName}! Your donation has been received. You will receive a confirmation email shortly.`,
          false
        );

        // Hide payment section, show success
        if (paymentSection) paymentSection.style.display = 'none';
        donationForm.classList.remove('amount-selection-collapsed');

        // Reset form
        resetForm();
      }
    } catch (err) {
      showPaymentError('An unexpected error occurred. Please try again.');
      isSubmitting = false;
      if (submitPaymentBtn) {
        submitPaymentBtn.disabled = false;
        updateSubmitButton();
      }
    }
  }

  // Reset form to initial state
  function resetForm(): void {
    donationType = 'one-time';
    selectedAmount = 100;
    isCustomAmount = false;

    // Reset buttons
    typeButtons.forEach((b) => b.classList.remove('active'));
    typeButtons[0]?.classList.add('active');

    amountButtons.forEach((b) => {
      b.classList.remove('active');
      if (b.dataset.amount === '100') b.classList.add('active');
    });

    if (customAmountWrapper) customAmountWrapper.style.display = 'none';
    if (customAmountInput) customAmountInput.value = '';
    if (fundSelect) fundSelect.value = 'General Fund';
    if (tributeTypeSelect) tributeTypeSelect.value = 'none';
    if (tributeNameWrapper) tributeNameWrapper.style.display = 'none';
    if (tributeNameInput) tributeNameInput.value = '';
    if (anonymousCheckbox) anonymousCheckbox.checked = false;

    // Clear all donor info fields
    if (donorFirstNameInput) donorFirstNameInput.value = '';
    if (donorLastNameInput) donorLastNameInput.value = '';
    if (donorEmailInput) donorEmailInput.value = '';
    if (donorAddressInput) donorAddressInput.value = '';
    if (donorCityInput) donorCityInput.value = '';
    if (donorStateInput) donorStateInput.value = '';
    if (donorZipInput) donorZipInput.value = '';
    if (donorPhoneInput) donorPhoneInput.value = '';
    if (donorOrgInput) donorOrgInput.value = '';

    if (amountSectionActions) amountSectionActions.style.display = 'block';
    updateContinueButton();
  }

  // Event listeners
  typeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      typeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      donationType = (btn.dataset.type as 'one-time' | 'monthly') || 'one-time';
      updateContinueButton();
    });
  });

  amountButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      amountButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const amount = btn.dataset.amount;
      if (amount === 'other') {
        isCustomAmount = true;
        if (customAmountWrapper) {
          customAmountWrapper.style.display = 'block';
          customAmountInput?.focus();
        }
        selectedAmount = customAmountInput ? parseInt(customAmountInput.value) || 0 : 0;
      } else {
        isCustomAmount = false;
        if (customAmountWrapper) customAmountWrapper.style.display = 'none';
        selectedAmount = parseInt(amount || '0');
      }
      updateContinueButton();
    });
  });

  customAmountInput?.addEventListener('input', () => {
    selectedAmount = parseInt(customAmountInput.value) || 0;
    updateContinueButton();
  });

  tributeTypeSelect?.addEventListener('change', () => {
    if (tributeNameWrapper) {
      tributeNameWrapper.style.display = tributeTypeSelect.value !== 'none' ? 'block' : 'none';
    }
  });

  continueBtn?.addEventListener('click', handleContinue);
  editAmountBtn?.addEventListener('click', handleEditAmount);
  submitPaymentBtn?.addEventListener('click', handlePaymentSubmit);

  // Initialize
  updateContinueButton();

  // Check for success/cancelled status from URL
  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === 'true') {
    showStatus(
      'Thank you for your generous donation! You will receive a confirmation email shortly.',
      false
    );
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  } else if (params.get('cancelled') === 'true') {
    showStatus('Donation was cancelled. Please try again when you are ready.', true);
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ==========================================================================
// Initialize
// ==========================================================================

function init(): void {
  initPage();
  initKeyboardDetection();
  initServiceWorker();
  initDonationForm();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
