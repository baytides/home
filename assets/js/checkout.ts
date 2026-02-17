/**
 * Bay Tides Checkout - 4-Step Donation Wizard
 * Handles donation flow with Stripe Payment Element and PDF receipt generation
 */

declare const jspdf: { jsPDF: new () => any };

interface StripePaymentElement {
  mount(selector: string): void;
  on(event: 'ready', handler: () => void): void;
  on(event: 'change', handler: (event: { error?: { message?: string } }) => void): void;
}

interface StripeElements {
  create(type: 'payment', options?: object): StripePaymentElement;
}

interface StripeConfirmResult {
  error?: { message?: string };
  paymentIntent?: { id: string; status: string };
}

interface StripeInstance {
  elements(options: { clientSecret: string; appearance?: object }): StripeElements;
  confirmPayment(options: object): Promise<StripeConfirmResult>;
}

declare const Stripe: (publishableKey: string) => StripeInstance;

// ==========================================================================
// Types
// ==========================================================================

interface DonationData {
  amount: number;
  frequency: 'one-time' | 'monthly';
  fund: string;
  tributeType: 'none' | 'in_honor' | 'in_memory';
  tributeName: string;
  anonymous: boolean;
}

interface DonorInfo {
  firstName: string;
  lastName: string;
  email: string;
  address: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  organization: string;
}

interface PaymentIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
}

interface ReceiptData {
  date: string;
  amount: number;
  frequency: 'one-time' | 'monthly';
  fund: string;
  tributeType: 'none' | 'in_honor' | 'in_memory';
  tributeName: string;
  transactionId: string;
  donor: DonorInfo;
}

// ==========================================================================
// State
// ==========================================================================

let stripe: StripeInstance | null = null;
let elements: StripeElements | null = null;
let paymentElement: StripePaymentElement | null = null;

const donationData: DonationData = {
  amount: 100,
  frequency: 'one-time',
  fund: 'General Fund',
  tributeType: 'none',
  tributeName: '',
  anonymous: false,
};

const donorInfo: DonorInfo = {
  firstName: '',
  lastName: '',
  email: '',
  address: '',
  address2: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  organization: '',
};

let receiptData: ReceiptData | null = null;

// API endpoint
const API_URL = import.meta.env.PROD ? 'https://donate.baytides.org' : 'http://localhost:8787';

// ==========================================================================
// DOM Helpers
// ==========================================================================

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

function $$(selector: string): NodeListOf<HTMLElement> {
  return document.querySelectorAll(selector);
}

// ==========================================================================
// Step Navigation
// ==========================================================================

function goToStep(step: number): void {
  if (step < 1 || step > 4) return;

  // Hide all steps
  $$('.checkout-step').forEach((el) => el.classList.remove('active'));

  // Show target step
  $(`#step-${step}`)?.classList.add('active');

  // Update stepper
  $$('.stepper-step').forEach((el) => {
    const stepNum = parseInt(el.dataset.step || '0');
    el.classList.remove('active', 'completed');
    el.removeAttribute('aria-current');
    if (stepNum < step) {
      el.classList.add('completed');
    } else if (stepNum === step) {
      el.classList.add('active');
      el.setAttribute('aria-current', 'step');
    }
  });

  const progressStatus = $('#checkout-progress-status');
  if (progressStatus) {
    const label =
      { 1: 'Amount', 2: 'Your Information', 3: 'Payment', 4: 'Complete' }[step] || 'Step';
    progressStatus.textContent = `Step ${step} of 4: ${label}`;
  }

  const formStatus = $('#checkout-form-status');
  if (formStatus) {
    formStatus.textContent = '';
  }

  // Scroll to top
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });

  // Initialize payment element when entering step 3
  if (step === 3 && !paymentElement) {
    initializePayment();
  }
}

function setFormStatus(message: string): void {
  const formStatus = $('#checkout-form-status');
  if (formStatus) {
    formStatus.textContent = message;
  }
}

function updateSummaries(): void {
  const amountText = `$${donationData.amount}`;
  const typeText = donationData.frequency === 'monthly' ? 'Monthly donation' : 'One-time donation';

  // Update mini summaries
  const summaryAmount2 = $('#summary-amount-2');
  const summaryType2 = $('#summary-type-2');
  const summaryAmount3 = $('#summary-amount-3');
  const summaryType3 = $('#summary-type-3');

  if (summaryAmount2) summaryAmount2.textContent = amountText;
  if (summaryType2) summaryType2.textContent = typeText;
  if (summaryAmount3) summaryAmount3.textContent = amountText;
  if (summaryType3) summaryType3.textContent = typeText;

  // Update payment summary
  const paymentAmount = $('#payment-donation-amount');
  const paymentFund = $('#payment-fund');
  const paymentTotal = $('#payment-total');

  if (paymentAmount) paymentAmount.textContent = `$${donationData.amount.toFixed(2)}`;
  if (paymentFund) paymentFund.textContent = donationData.fund;
  if (paymentTotal) paymentTotal.textContent = `$${donationData.amount.toFixed(2)}`;
}

// ==========================================================================
// Step 1: Amount Selection
// ==========================================================================

function initStep1(): void {
  // Donation type toggle
  $$('.donation-type-toggle .toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.donation-type-toggle .toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      donationData.frequency = btn.dataset.type as 'one-time' | 'monthly';
    });
  });

  // Amount buttons
  $$('.donation-amounts .amount-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.donation-amounts .amount-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const amount = btn.dataset.amount;
      const customWrapper = $('#custom-amount-wrapper');

      if (amount === 'other') {
        if (customWrapper) customWrapper.style.display = 'block';
        const customInput = $('#custom-amount') as HTMLInputElement;
        customInput?.focus();
      } else {
        if (customWrapper) customWrapper.style.display = 'none';
        donationData.amount = parseInt(amount || '100');
      }
    });
  });

  // Custom amount input
  const customInput = $('#custom-amount') as HTMLInputElement;
  customInput?.addEventListener('input', () => {
    const value = parseInt(customInput.value);
    if (value && value > 0) {
      donationData.amount = value;
    }
  });

  // Fund selection
  const fundSelect = $('#fund-select') as HTMLSelectElement;
  fundSelect?.addEventListener('change', () => {
    donationData.fund = fundSelect.value;
  });

  // Tribute type
  const tributeType = $('#tribute-type') as HTMLSelectElement;
  const tributeNameWrapper = $('#tribute-name-wrapper');

  tributeType?.addEventListener('change', () => {
    donationData.tributeType = tributeType.value as 'none' | 'in_honor' | 'in_memory';
    if (tributeNameWrapper) {
      tributeNameWrapper.style.display = tributeType.value !== 'none' ? 'block' : 'none';
    }
  });

  // Tribute name
  const tributeName = $('#tribute-name') as HTMLInputElement;
  tributeName?.addEventListener('input', () => {
    donationData.tributeName = tributeName.value;
  });

  // Anonymous checkbox
  const anonymousCheckbox = $('#anonymous-checkbox') as HTMLInputElement;
  anonymousCheckbox?.addEventListener('change', () => {
    donationData.anonymous = anonymousCheckbox.checked;
  });

  // Continue button
  $('#step1-next')?.addEventListener('click', () => {
    // Validate custom amount if selected
    const otherBtn = $('.amount-btn[data-amount="other"]');
    if (otherBtn?.classList.contains('active')) {
      const customValue = parseInt((customInput as HTMLInputElement)?.value || '0');
      if (!customValue || customValue < 1) {
        setFormStatus('Please enter a valid donation amount.');
        customInput?.focus();
        return;
      }
      donationData.amount = customValue;
    }

    updateSummaries();
    goToStep(2);
  });
}

// ==========================================================================
// Step 2: Donor Information
// ==========================================================================

function initStep2(): void {
  // Collect donor info on input
  const fields: { id: string; key: keyof DonorInfo }[] = [
    { id: 'donor-first-name', key: 'firstName' },
    { id: 'donor-last-name', key: 'lastName' },
    { id: 'donor-email', key: 'email' },
    { id: 'donor-address', key: 'address' },
    { id: 'donor-address2', key: 'address2' },
    { id: 'donor-city', key: 'city' },
    { id: 'donor-state', key: 'state' },
    { id: 'donor-zip', key: 'zip' },
    { id: 'donor-phone', key: 'phone' },
    { id: 'donor-org', key: 'organization' },
  ];

  fields.forEach(({ id, key }) => {
    const input = $(`#${id}`) as HTMLInputElement;
    input?.addEventListener('input', () => {
      donorInfo[key] = input.value;
    });
  });

  // Back button
  $('#step2-back')?.addEventListener('click', () => {
    goToStep(1);
  });

  // Continue button
  $('#step2-next')?.addEventListener('click', () => {
    // Validate required fields
    const required = ['firstName', 'lastName', 'email', 'address', 'city', 'state', 'zip'];
    for (const key of required) {
      if (!donorInfo[key as keyof DonorInfo]) {
        setFormStatus('Please fill in all required fields.');
        return;
      }
    }

    // Basic email validation
    if (!donorInfo.email.includes('@')) {
      setFormStatus('Please enter a valid email address.');
      return;
    }

    updateSummaries();
    goToStep(3);
  });

  // Edit link
  $$('.edit-link[data-goto="1"]').forEach((link) => {
    link.addEventListener('click', () => goToStep(1));
  });
}

// ==========================================================================
// Step 3: Payment
// ==========================================================================

async function initializePayment(): Promise<void> {
  const submitBtn = $('#submit-payment') as HTMLButtonElement;
  const errorsEl = $('#payment-errors');

  try {
    // Initialize Stripe
    stripe = Stripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder');

    // Create PaymentIntent on server
    const response = await fetch(`${API_URL}/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: donationData.amount,
        frequency: donationData.frequency,
        fund: donationData.fund,
        tributeType: donationData.tributeType,
        tributeName: donationData.tributeName,
        anonymous: donationData.anonymous,
        donorEmail: donorInfo.email,
        donorName: `${donorInfo.firstName} ${donorInfo.lastName}`,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create payment intent');
    }

    const { clientSecret } = (await response.json()) as PaymentIntentResponse;

    // Create Elements
    elements = stripe.elements({
      clientSecret,
      appearance: {
        theme: 'night',
        variables: {
          colorPrimary: '#3b8fc2',
          colorBackground: '#1e3a4c',
          colorText: '#e8f4f8',
          colorDanger: '#ff6b6b',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          borderRadius: '8px',
        },
      },
    });

    // Create Payment Element
    paymentElement = elements.create('payment', {
      layout: 'tabs',
    });

    paymentElement.mount('#payment-element');

    paymentElement.on('ready', () => {
      if (submitBtn) submitBtn.disabled = false;
    });

    paymentElement.on('change', (event: { error?: { message?: string } }) => {
      if (errorsEl) {
        errorsEl.textContent = event.error?.message || '';
      }
    });
  } catch (error) {
    console.error('Payment initialization error:', error);
    if (errorsEl) {
      errorsEl.textContent = 'Failed to initialize payment. Please refresh and try again.';
    }
  }
}

function initStep3(): void {
  // Back button
  $('#step3-back')?.addEventListener('click', () => {
    goToStep(2);
  });

  // Submit payment
  $('#submit-payment')?.addEventListener('click', handlePaymentSubmit);
}

async function handlePaymentSubmit(): Promise<void> {
  if (!stripe || !elements) return;

  const submitBtn = $('#submit-payment') as HTMLButtonElement;
  const btnText = submitBtn?.querySelector('.btn-text') as HTMLElement;
  const btnSpinner = submitBtn?.querySelector('.btn-spinner') as HTMLElement;
  const errorsEl = $('#payment-errors');

  // Show loading state
  if (submitBtn) submitBtn.disabled = true;
  if (btnText) btnText.style.display = 'none';
  if (btnSpinner) btnSpinner.style.display = 'inline-flex';

  try {
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href, // Not used, we handle redirect ourselves
        receipt_email: donorInfo.email,
        payment_method_data: {
          billing_details: {
            name: `${donorInfo.firstName} ${donorInfo.lastName}`,
            email: donorInfo.email,
            phone: donorInfo.phone || undefined,
            address: {
              line1: donorInfo.address,
              line2: donorInfo.address2 || undefined,
              city: donorInfo.city,
              state: donorInfo.state,
              postal_code: donorInfo.zip,
              country: 'US',
            },
          },
        },
      },
      redirect: 'if_required',
    });

    if (error) {
      if (errorsEl) errorsEl.textContent = error.message || 'Payment failed. Please try again.';
      if (submitBtn) submitBtn.disabled = false;
      if (btnText) btnText.style.display = 'inline';
      if (btnSpinner) btnSpinner.style.display = 'none';
      return;
    }

    if (paymentIntent?.status === 'succeeded') {
      // Store receipt data
      receiptData = {
        date: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        amount: donationData.amount,
        frequency: donationData.frequency,
        fund: donationData.fund,
        tributeType: donationData.tributeType,
        tributeName: donationData.tributeName,
        transactionId: paymentIntent.id,
        donor: { ...donorInfo },
      };

      showSuccess();
    }
  } catch (error) {
    console.error('Payment error:', error);
    if (errorsEl) errorsEl.textContent = 'An unexpected error occurred. Please try again.';
    if (submitBtn) submitBtn.disabled = false;
    if (btnText) btnText.style.display = 'inline';
    if (btnSpinner) btnSpinner.style.display = 'none';
  }
}

// ==========================================================================
// Step 4: Success & Receipt
// ==========================================================================

function showSuccess(): void {
  if (!receiptData) return;

  // Update success page content
  const finalAmount = $('#final-amount');
  const finalEmail = $('#final-email');
  const finalFrequencyText = $('#final-frequency-text');
  const receiptDate = $('#receipt-date');
  const receiptAmount = $('#receipt-amount');
  const receiptFund = $('#receipt-fund');
  const receiptTributeRow = $('#receipt-tribute-row');
  const receiptTributeLabel = $('#receipt-tribute-label');
  const receiptTributeName = $('#receipt-tribute-name');
  const receiptTransactionId = $('#receipt-transaction-id');

  if (finalAmount) finalAmount.textContent = `$${receiptData.amount}`;
  if (finalEmail) finalEmail.textContent = receiptData.donor.email;
  if (finalFrequencyText) {
    finalFrequencyText.textContent =
      receiptData.frequency === 'monthly'
        ? 'Your monthly donation has been set up successfully.'
        : '';
  }

  if (receiptDate) receiptDate.textContent = receiptData.date;
  if (receiptAmount) receiptAmount.textContent = `$${receiptData.amount.toFixed(2)}`;
  if (receiptFund) receiptFund.textContent = receiptData.fund;
  if (receiptTransactionId) receiptTransactionId.textContent = receiptData.transactionId;

  // Show tribute info if applicable
  if (receiptData.tributeType !== 'none' && receiptData.tributeName) {
    if (receiptTributeRow) receiptTributeRow.style.display = 'flex';
    if (receiptTributeLabel) {
      receiptTributeLabel.textContent =
        receiptData.tributeType === 'in_honor' ? 'In honor of' : 'In memory of';
    }
    if (receiptTributeName) receiptTributeName.textContent = receiptData.tributeName;
  }

  goToStep(4);
}

function initStep4(): void {
  // Download PDF
  $('#download-receipt')?.addEventListener('click', generatePDF);

  // Print receipt
  $('#print-receipt')?.addEventListener('click', () => {
    window.print();
  });
}

// ==========================================================================
// PDF Generation
// ==========================================================================

function generatePDF(): void {
  if (!receiptData) return;

  const { jsPDF } = jspdf;
  const doc = new jsPDF();

  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  // Header
  doc.setFontSize(24);
  doc.setTextColor(59, 143, 194); // Bay Tides blue
  doc.text('Bay Tides', pageWidth / 2, y, { align: 'center' });

  y += 10;
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text('Protecting the San Francisco Bay', pageWidth / 2, y, { align: 'center' });

  y += 20;
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text('Donation Receipt', pageWidth / 2, y, { align: 'center' });

  // Divider
  y += 10;
  doc.setDrawColor(200, 200, 200);
  doc.line(20, y, pageWidth - 20, y);

  // Receipt details
  y += 15;
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);

  const leftCol = 25;
  const rightCol = 80;
  const lineHeight = 8;

  // Date
  doc.setFont('helvetica', 'bold');
  doc.text('Date:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(receiptData.date, rightCol, y);
  y += lineHeight;

  // Transaction ID
  doc.setFont('helvetica', 'bold');
  doc.text('Transaction ID:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(receiptData.transactionId, rightCol, y);
  y += lineHeight * 2;

  // Donor info
  doc.setFont('helvetica', 'bold');
  doc.text('Donor:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  y += lineHeight;

  const donorName = `${receiptData.donor.firstName} ${receiptData.donor.lastName}`;
  doc.text(donorName, leftCol, y);
  y += lineHeight;
  doc.text(receiptData.donor.address, leftCol, y);
  y += lineHeight;
  if (receiptData.donor.address2) {
    doc.text(receiptData.donor.address2, leftCol, y);
    y += lineHeight;
  }
  doc.text(
    `${receiptData.donor.city}, ${receiptData.donor.state} ${receiptData.donor.zip}`,
    leftCol,
    y
  );
  y += lineHeight * 2;

  // Donation details
  doc.setFont('helvetica', 'bold');
  doc.text('Donation Amount:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`$${receiptData.amount.toFixed(2)}`, rightCol, y);
  y += lineHeight;

  doc.setFont('helvetica', 'bold');
  doc.text('Donation Type:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(receiptData.frequency === 'monthly' ? 'Monthly Recurring' : 'One-Time', rightCol, y);
  y += lineHeight;

  doc.setFont('helvetica', 'bold');
  doc.text('Fund Designation:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(receiptData.fund, rightCol, y);
  y += lineHeight;

  // Tribute info
  if (receiptData.tributeType !== 'none' && receiptData.tributeName) {
    doc.setFont('helvetica', 'bold');
    const tributeLabel = receiptData.tributeType === 'in_honor' ? 'In Honor Of:' : 'In Memory Of:';
    doc.text(tributeLabel, leftCol, y);
    doc.setFont('helvetica', 'normal');
    doc.text(receiptData.tributeName, rightCol, y);
    y += lineHeight;
  }

  // Divider
  y += 10;
  doc.line(20, y, pageWidth - 20, y);

  // Tax statement
  y += 15;
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);

  const taxText = [
    'Bay Tides is a registered 501(c)(3) nonprofit organization.',
    'EIN: 93-3889081',
    '',
    'This donation is tax-deductible to the fullest extent allowed by law.',
    'No goods or services were provided in exchange for this contribution.',
  ];

  taxText.forEach((line) => {
    doc.text(line, pageWidth / 2, y, { align: 'center' });
    y += 6;
  });

  // Footer
  y = doc.internal.pageSize.getHeight() - 20;
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Bay Tides | baytides.org | info@baytides.org', pageWidth / 2, y, { align: 'center' });

  // Save
  const filename = `BayTides_Receipt_${receiptData.transactionId.slice(-8)}.pdf`;
  doc.save(filename);
}

// ==========================================================================
// Initialization
// ==========================================================================

function init(): void {
  initStep1();
  initStep2();
  initStep3();
  initStep4();

  // Check for URL params (e.g., returning from redirect)
  const params = new URLSearchParams(window.location.search);
  const step = params.get('step');
  if (step) {
    goToStep(parseInt(step));
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
