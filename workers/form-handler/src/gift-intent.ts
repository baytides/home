/**
 * "Tell us about your gift" submissions from the Other Ways to Give pages:
 * stock, donor-advised fund, IRA qualified charitable distribution, in-kind,
 * matching, and planned gifts. Builds the staff summary and the donor's
 * confirmation with next steps.
 */

export type GiftType = 'stock' | 'daf' | 'ira' | 'in_kind' | 'matching' | 'planned';

export const GIFT_LABELS: Record<GiftType, string> = {
  stock: 'Stock gift',
  daf: 'Donor-advised fund grant',
  ira: 'IRA qualified charitable distribution',
  in_kind: 'In-kind donation',
  matching: 'Matching gift',
  planned: 'Planned gift',
};

const ORGANIZATION = `Legal name: Bay Tides, a California nonprofit corporation
EIN: 93-3889081
Address: 274 Redwood Shores Pkwy #619, Redwood City, CA 94065`;

export function isGiftType(value: string): value is GiftType {
  return value in GIFT_LABELS;
}

function field(formData: FormData, name: string): string {
  return ((formData.get(name) as string | null) || '').trim();
}

/** The submitted gift details as "Label: value" lines, skipping blanks. */
export function giftDetails(formData: FormData): string {
  const pairs: Array<[string, string]> = [
    ['Security', field(formData, 'security')],
    ['Shares', field(formData, 'shares')],
    ['Institution', field(formData, 'institution')],
    ['Employer', field(formData, 'employer')],
    ['Original gift amount', field(formData, 'original_amount')],
    ['Original gift date', field(formData, 'original_date')],
    ['Match status', field(formData, 'match_status')],
    ['In-kind type', field(formData, 'in_kind_type')],
    ['Description', field(formData, 'description')],
    ['Delivery', field(formData, 'delivery')],
    ['Planned gift type', field(formData, 'planned_type')],
    ['Stage', field(formData, 'planned_stage')],
    ['Recognition', formData.get('recognition_anonymous') === 'true' ? 'Keep anonymous' : ''],
    ['Estimated amount (USD)', field(formData, 'amount')],
    ['Expected date', field(formData, 'expected_date')],
    ['Fund', field(formData, 'fund')],
    ['Notes', field(formData, 'notes')],
  ];
  return pairs
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

/** What the donor should do next, for the confirmation email. */
export function nextSteps(giftType: GiftType): string {
  switch (giftType) {
    case 'stock':
      return `Within two business days, we will email you our brokerage account and DTC details so your broker can transfer the shares. Please let us know when the transfer is initiated. Brokers do not always tell us who sent the shares.

${ORGANIZATION}`;
    case 'daf':
      return `Recommend the grant through your donor-advised fund's website or app using the details below. If your sponsor lets you share your name with the grant, please do, so we can thank you.

${ORGANIZATION}`;
    case 'ira':
      return `Ask your IRA custodian to make the distribution payable directly to Bay Tides and to mark it as a qualified charitable distribution. Checks paid to you do not qualify. We will send an acknowledgment letter for your tax records once it arrives.

${ORGANIZATION}`;
    case 'in_kind':
      return `We will review your offer against our current needs and reply within two business days to confirm and arrange drop-off or pickup. Please do not send items before we confirm.`;
    case 'matching':
      return `If you have not already, submit the match request through your employer's giving portal and search for Bay Tides. When your employer asks us to verify your gift, we will confirm it promptly.

${ORGANIZATION}`;
    case 'planned':
      return `Thank you for thinking of Bay Tides. A member of our team will reach out personally. If you are working with an attorney or financial advisor, they can use the details below.

${ORGANIZATION}`;
  }
}
