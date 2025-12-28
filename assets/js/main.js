// Bay Tides - Main JavaScript
// Handles dynamic loading of header/footer and site functionality

(function() {
  'use strict';

  // ============================================
  // Theme Management (runs immediately)
  // ============================================
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function setTheme(dark, saveToStorage = false) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

    // Only save to localStorage when user manually toggles
    if (saveToStorage) {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    }

    // Update aria-pressed for theme toggle if it exists
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
  }

  // Apply theme immediately to prevent flash
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    // User has manually set a preference
    setTheme(savedTheme === 'dark');
  } else {
    // Follow system preference (default to light if no preference)
    setTheme(prefersDark.matches);
  }

  // Apply reduced motion preference
  if (prefersReducedMotion.matches) {
    document.documentElement.setAttribute('data-reduced-motion', 'true');
  }

  // ============================================
  // Dynamic Header/Footer Loading
  // ============================================
  async function loadPartial(url, targetSelector, position = 'afterbegin') {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load ${url}`);
      const html = await response.text();

      const target = document.querySelector(targetSelector);
      if (target) {
        target.insertAdjacentHTML(position, html);
      }
      return true;
    } catch (error) {
      console.warn(`Could not load partial: ${url}`, error);
      return false;
    }
  }

  async function initPartials() {
    const headerPlaceholder = document.getElementById('header-placeholder');
    const footerPlaceholder = document.getElementById('footer-placeholder');

    // Load partials if placeholders exist
    if (headerPlaceholder) {
      const loaded = await loadPartial('partials/header.html', '#header-placeholder', 'afterbegin');
      if (loaded) {
        headerPlaceholder.removeAttribute('id');
        initHeaderFunctionality();
      }
    } else {
      // Header is inline, just init functionality
      initHeaderFunctionality();
    }

    if (footerPlaceholder) {
      const loaded = await loadPartial('partials/footer.html', '#footer-placeholder', 'afterbegin');
      if (loaded) {
        footerPlaceholder.removeAttribute('id');
      }
    }

    // Mark active nav link
    markActiveNavLink();
  }

  // ============================================
  // Header Functionality
  // ============================================
  function initHeaderFunctionality() {
    initMobileMenu();
    initThemeToggle();
    initSearch();
  }

  // Mobile menu toggle
  function initMobileMenu() {
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const navUl = document.querySelector('nav ul');

    if (!mobileMenuToggle || !navUl) return;

    mobileMenuToggle.addEventListener('click', function() {
      const isExpanded = navUl.classList.toggle('active');
      this.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('nav') && !e.target.closest('.mobile-menu-toggle')) {
        navUl.classList.remove('active');
        mobileMenuToggle.setAttribute('aria-expanded', 'false');
      }
    });

    // Close menu on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navUl.classList.contains('active')) {
        navUl.classList.remove('active');
        mobileMenuToggle.setAttribute('aria-expanded', 'false');
        mobileMenuToggle.focus();
      }
    });
  }

  // Theme toggle
  function initThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;

    // Set initial aria-pressed state
    const currentTheme = document.documentElement.getAttribute('data-theme');
    themeToggle.setAttribute('aria-pressed', currentTheme === 'dark' ? 'true' : 'false');

    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setTheme(!isDark, true);  // Save to localStorage when manually toggled

      // Announce change to screen readers
      announceToScreenReader(`Switched to ${!isDark ? 'dark' : 'light'} mode`);
    });

    // Listen for system preference changes
    prefersDark.addEventListener('change', (e) => {
      if (!localStorage.getItem('theme')) {
        setTheme(e.matches);
      }
    });
  }

  // Search functionality
  function initSearch() {
    const searchToggle = document.getElementById('search-toggle');
    const searchOverlay = document.getElementById('search-overlay');
    const searchClose = document.getElementById('search-close');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    if (!searchToggle || !searchOverlay || !searchInput || !searchResults) return;

    const allResults = searchResults.querySelectorAll('.search-result');
    let previousFocus = null;

    function openSearch() {
      previousFocus = document.activeElement;
      searchOverlay.hidden = false;
      searchOverlay.classList.add('active');
      searchToggle.setAttribute('aria-expanded', 'true');
      searchInput.focus();

      // Trap focus in modal
      document.body.style.overflow = 'hidden';
    }

    function closeSearch() {
      searchOverlay.classList.remove('active');
      searchToggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';

      // Restore focus
      if (previousFocus) {
        previousFocus.focus();
      }

      // Hide after animation
      setTimeout(() => {
        if (!searchOverlay.classList.contains('active')) {
          searchOverlay.hidden = true;
        }
      }, 300);
    }

    searchToggle.addEventListener('click', openSearch);

    if (searchClose) {
      searchClose.addEventListener('click', closeSearch);
    }

    searchOverlay.addEventListener('click', (e) => {
      if (e.target === searchOverlay) {
        closeSearch();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape to close
      if (e.key === 'Escape' && searchOverlay.classList.contains('active')) {
        closeSearch();
      }

      // Ctrl/Cmd + K to open
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (searchOverlay.classList.contains('active')) {
          closeSearch();
        } else {
          openSearch();
        }
      }
    });

    // Search filtering with live region announcement
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      let visibleCount = 0;

      allResults.forEach(result => {
        const text = result.textContent.toLowerCase();
        const matches = query === '' || text.includes(query);
        result.style.display = matches ? 'block' : 'none';
        if (matches) visibleCount++;
      });

      // Announce results count to screen readers
      if (query.length > 0) {
        announceToScreenReader(`${visibleCount} result${visibleCount !== 1 ? 's' : ''} found`);
      }
    });

    // Focus trap within search modal
    searchOverlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;

      const focusableElements = searchOverlay.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    });
  }

  // ============================================
  // Navigation
  // ============================================
  function markActiveNavLink() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('nav a:not(.btn)');

    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPage || (currentPage === '' && href === 'index.html')) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  // ============================================
  // Accessibility Helpers
  // ============================================

  // Live region for screen reader announcements
  let liveRegion = null;

  function announceToScreenReader(message) {
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.className = 'sr-only';
      document.body.appendChild(liveRegion);
    }

    // Clear and set message (timing ensures announcement)
    liveRegion.textContent = '';
    setTimeout(() => {
      liveRegion.textContent = message;
    }, 100);
  }

  // Enhanced focus visibility
  function initFocusVisibility() {
    // Add class to body when using keyboard navigation
    let usingKeyboard = false;

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        usingKeyboard = true;
        document.body.classList.add('using-keyboard');
      }
    });

    document.addEventListener('mousedown', () => {
      usingKeyboard = false;
      document.body.classList.remove('using-keyboard');
    });
  }

  // ============================================
  // Sponsors Carousel
  // ============================================
  function initSponsorsCarousel() {
    const wrapper = document.querySelector('.sponsors-wrapper');
    if (!wrapper) return;

    const track = wrapper.querySelector('.sponsors-track');
    const prevBtn = wrapper.querySelector('.sponsors-nav.prev');
    const nextBtn = wrapper.querySelector('.sponsors-nav.next');
    const viewport = wrapper.querySelector('.sponsors-viewport');

    if (!track || !prevBtn || !nextBtn || !viewport) return;

    let position = 0;
    let autoScrollInterval = null;
    const scrollAmount = 200; // pixels to scroll per step

    function getMaxScroll() {
      return track.scrollWidth - viewport.offsetWidth;
    }

    function scrollTo(newPosition) {
      const maxScroll = getMaxScroll();
      position = Math.max(0, Math.min(newPosition, maxScroll));

      // Loop back to start when reaching the end
      if (position >= maxScroll) {
        position = 0;
      }

      track.style.transform = `translateX(-${position}px)`;
    }

    function scrollNext() {
      scrollTo(position + scrollAmount);
    }

    function scrollPrev() {
      const maxScroll = getMaxScroll();
      if (position <= 0) {
        position = maxScroll;
      }
      scrollTo(position - scrollAmount);
    }

    function startAutoScroll() {
      stopAutoScroll();
      autoScrollInterval = setInterval(scrollNext, 3000);
    }

    function stopAutoScroll() {
      if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
      }
    }

    // Button click handlers
    nextBtn.addEventListener('click', () => {
      scrollNext();
      startAutoScroll(); // Reset timer after manual interaction
    });

    prevBtn.addEventListener('click', () => {
      scrollPrev();
      startAutoScroll(); // Reset timer after manual interaction
    });

    // Pause on hover
    wrapper.addEventListener('mouseenter', stopAutoScroll);
    wrapper.addEventListener('mouseleave', startAutoScroll);

    // Pause on focus for accessibility
    wrapper.addEventListener('focusin', stopAutoScroll);
    wrapper.addEventListener('focusout', startAutoScroll);

    // Respect reduced motion preference
    if (!prefersReducedMotion.matches) {
      startAutoScroll();
    }
  }

  // ============================================
  // Initialize
  // ============================================
  function init() {
    initPartials();
    initFocusVisibility();
    initSponsorsCarousel();
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
