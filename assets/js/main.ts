/**
 * Bay Tides Main TypeScript
 * Handles theme, navigation, search, accessibility features, form validation, and more
 */

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

if (savedHighContrast === 'true') {
  document.documentElement.setAttribute('data-high-contrast', 'true');
}
if (savedFontSize) {
  document.documentElement.setAttribute('data-font-size', savedFontSize);
}
if (savedReducedMotion === 'true') {
  document.documentElement.setAttribute('data-reduced-motion', 'true');
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

  // Filter results
  searchInput.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
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
    <h3>Accessibility</h3>
    <label>
      <input type="checkbox" id="high-contrast-toggle">
      High Contrast
    </label>
    <label>
      <input type="checkbox" id="reduced-motion-toggle">
      Reduce Motion
    </label>
    <label>
      Font Size
      <select id="font-size-select">
        <option value="default">Default</option>
        <option value="large">Large</option>
        <option value="xlarge">Extra Large</option>
      </select>
    </label>
  `;
  document.body.appendChild(panel);

  const highContrastToggle = document.getElementById('high-contrast-toggle') as HTMLInputElement;
  const reducedMotionToggle = document.getElementById('reduced-motion-toggle') as HTMLInputElement;
  const fontSizeSelect = document.getElementById('font-size-select') as HTMLSelectElement;

  highContrastToggle.checked =
    document.documentElement.getAttribute('data-high-contrast') === 'true';
  reducedMotionToggle.checked =
    document.documentElement.getAttribute('data-reduced-motion') === 'true';
  fontSizeSelect.value = document.documentElement.getAttribute('data-font-size') || 'default';

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

  highContrastToggle.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    if (enabled) {
      document.documentElement.setAttribute('data-high-contrast', 'true');
      localStorage.setItem('highContrast', 'true');
    } else {
      document.documentElement.removeAttribute('data-high-contrast');
      localStorage.removeItem('highContrast');
    }
    announce(`High contrast ${enabled ? 'enabled' : 'disabled'}`);
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
    announce(`Reduced motion ${enabled ? 'enabled' : 'disabled'}`);
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
    announce(`Font size set to ${size}`);
  });
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

  contactForm.addEventListener('submit', (e) => {
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
      if (firstError) firstError.focus();
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
  const logoWidth = logos[0] ? logos[0].offsetWidth + 64 : 104;
  const totalWidth = logos.length * logoWidth;

  // Clone logos for infinite scroll
  logos.forEach((logo) => {
    const clone = logo.cloneNode(true) as HTMLImageElement;
    clone.setAttribute('aria-hidden', 'true');
    clone.removeAttribute('alt');
    logosContainer.appendChild(clone);
  });

  let position = 0;
  let autoplayInterval: ReturnType<typeof setInterval> | null = null;

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

  function startAutoplay(): void {
    stopAutoplay();
    autoplayInterval = setInterval(slideNext, 3000);
  }

  function stopAutoplay(): void {
    if (autoplayInterval) {
      clearInterval(autoplayInterval);
      autoplayInterval = null;
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
// Initialize
// ==========================================================================

function init(): void {
  initPage();
  initKeyboardDetection();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
