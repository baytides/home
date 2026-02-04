#!/usr/bin/env node

/**
 * Generate Bay Tides Liability Waiver PDF Template
 * This creates a professional PDF template used as a reference for the waiver form design.
 * The actual online waiver form at /volunteer/waiver uses this layout.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the logo image
const logoPath = join(__dirname, '..', 'public', 'assets', 'images', 'logo-pdf.png');
const logoBytes = readFileSync(logoPath);

async function generateWaiverPDF() {
  const pdfDoc = await PDFDocument.create();

  // Embed fonts
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Embed logo image
  const logoImage = await pdfDoc.embedPng(logoBytes);

  // Colors
  const darkBlue = rgb(0.08, 0.27, 0.43); // #143F6E
  const textColor = rgb(0.2, 0.2, 0.2);

  // Page dimensions
  const pageWidth = 612; // Letter size
  const pageHeight = 792;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  // Helper to add a new page
  function addPage() {
    return pdfDoc.addPage([pageWidth, pageHeight]);
  }

  // Helper to draw text with word wrap
  function drawWrappedText(page, text, x, y, maxWidth, font, fontSize, color, lineHeight = 1.3) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;

    for (const word of words) {
      const testLine = line + (line ? ' ' : '') + word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth > maxWidth && line) {
        page.drawText(line, { x, y: currentY, size: fontSize, font, color });
        line = word;
        currentY -= fontSize * lineHeight;
      } else {
        line = testLine;
      }
    }

    if (line) {
      page.drawText(line, { x, y: currentY, size: fontSize, font, color });
      currentY -= fontSize * lineHeight;
    }

    return currentY;
  }

  // ============ PAGE 1 ============
  let page = addPage();
  let y = pageHeight - margin;

  // Header with logo
  const logoSize = 50; // Display at 50x50
  page.drawImage(logoImage, {
    x: margin,
    y: y - logoSize + 10, // Align with text
    width: logoSize,
    height: logoSize,
  });

  // Title next to logo
  page.drawText('BAY TIDES', {
    x: margin + logoSize + 15,
    y: y - 5,
    size: 28,
    font: helveticaBold,
    color: darkBlue,
  });

  page.drawText('Volunteer Liability Waiver and Release', {
    x: margin + logoSize + 15,
    y: y - 35,
    size: 16,
    font: helveticaBold,
    color: textColor,
  });
  y -= logoSize + 15;

  // Horizontal line
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 2,
    color: darkBlue,
  });
  y -= 25;

  // Introduction
  const introText =
    'This Waiver and Release of Liability ("Waiver") is entered into by and between Bay Tides ("Organization") and the undersigned participant ("Participant"). By signing this Waiver, Participant acknowledges that they have read, understand, and agree to be bound by all terms and conditions set forth herein.';
  y = drawWrappedText(page, introText, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 20;

  // Section 1
  page.drawText('1. ASSUMPTION OF RISK', {
    x: margin,
    y,
    size: 11,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 16;

  const section1Text =
    'I understand that participation in Bay Tides volunteer activities may involve physical activity and exposure to various conditions including, but not limited to: uneven terrain, water hazards, wildlife, weather conditions, use of tools and equipment, and other inherent risks associated with outdoor environmental work. I voluntarily assume all risks associated with my participation, including but not limited to personal injury, illness, death, and property damage, whether caused by my own actions, the actions of others, or conditions at the activity location.';
  y = drawWrappedText(page, section1Text, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 20;

  // Section 2
  page.drawText('2. RELEASE OF LIABILITY', {
    x: margin,
    y,
    size: 11,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 16;

  const section2Text =
    'In consideration of being permitted to participate in Bay Tides volunteer activities, I hereby release, waive, discharge, and covenant not to sue Bay Tides, its officers, directors, employees, volunteers, agents, representatives, successors, and assigns (collectively, "Released Parties") from any and all liability, claims, demands, actions, or causes of action arising out of or related to any loss, damage, or injury, including death, that may be sustained by me while participating in volunteer activities, whether caused by the negligence of the Released Parties or otherwise.';
  y = drawWrappedText(page, section2Text, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 20;

  // Section 3
  page.drawText('3. INDEMNIFICATION', {
    x: margin,
    y,
    size: 11,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 16;

  const section3Text =
    "I agree to indemnify, defend, and hold harmless the Released Parties from any loss, liability, damage, or costs, including attorney's fees, that may be incurred due to my participation in volunteer activities, whether caused by my negligence or otherwise.";
  y = drawWrappedText(page, section3Text, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 20;

  // Section 4
  page.drawText('4. MEDICAL AUTHORIZATION AND FINANCIAL RESPONSIBILITY', {
    x: margin,
    y,
    size: 11,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 16;

  const section4Text =
    'I authorize Bay Tides and its representatives to obtain or provide emergency medical treatment for me in the event of injury or illness during volunteer activities. I understand and agree that I am solely responsible for all costs associated with any medical treatment, emergency services, or hospitalization required as a result of my participation. I certify that I am in good physical health and have no medical conditions that would prevent my safe participation, or I have disclosed such conditions to Bay Tides staff.';
  y = drawWrappedText(page, section4Text, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 20;

  // Section 5
  page.drawText('5. PERSONAL PROPERTY', {
    x: margin,
    y,
    size: 11,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 16;

  const section5Text =
    'I understand that Bay Tides is not responsible for any loss, theft, or damage to my personal property during volunteer activities.';
  y = drawWrappedText(page, section5Text, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 20;

  // Section 6
  page.drawText('6. PHOTOGRAPHY AND MEDIA RELEASE', {
    x: margin,
    y,
    size: 11,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 16;

  const section6Text =
    'I grant Bay Tides permission to photograph, video record, and/or audio record me during volunteer activities and to use such materials for any lawful purpose, including marketing, social media, website, publications, and other promotional purposes. I waive any right to compensation for such use.';
  y = drawWrappedText(page, section6Text, margin, y, contentWidth, helvetica, 10, textColor);

  // Footer
  page.drawText('Page 1 of 2', {
    x: pageWidth / 2 - 25,
    y: 30,
    size: 9,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // ============ PAGE 2 ============
  page = addPage();
  y = pageHeight - margin;

  // Section 7
  page.drawText('7. COMPLIANCE WITH RULES', {
    x: margin,
    y,
    size: 11,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 16;

  const section7Text =
    'I agree to follow all rules, instructions, and safety guidelines provided by Bay Tides staff and event leaders. I understand that failure to comply may result in immediate removal from the activity and termination of my volunteer status.';
  y = drawWrappedText(page, section7Text, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 20;

  // Section 8
  page.drawText('8. GOVERNING LAW', {
    x: margin,
    y,
    size: 11,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 16;

  const section8Text =
    'This Waiver shall be governed by and construed in accordance with the laws of the State of California. Any disputes arising under this Waiver shall be resolved in the courts of California.';
  y = drawWrappedText(page, section8Text, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 20;

  // Section 9
  page.drawText('9. SEVERABILITY', {
    x: margin,
    y,
    size: 11,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 16;

  const section9Text =
    'If any provision of this Waiver is found to be invalid or unenforceable, the remaining provisions shall continue in full force and effect.';
  y = drawWrappedText(page, section9Text, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 20;

  // Section 10
  page.drawText('10. ENTIRE AGREEMENT', {
    x: margin,
    y,
    size: 11,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 16;

  const section10Text =
    'This Waiver constitutes the entire agreement between me and Bay Tides regarding the subject matter hereof and supersedes all prior agreements, understandings, and representations.';
  y = drawWrappedText(page, section10Text, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 35;

  // Horizontal line before signature section
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 1,
    color: darkBlue,
  });
  y -= 25;

  // Signature Section Title
  page.drawText('PARTICIPANT ACKNOWLEDGMENT AND SIGNATURE', {
    x: margin,
    y,
    size: 12,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 25;

  const ackText =
    'By signing below, I acknowledge that I have read this Waiver in its entirety, understand its contents, and agree to be legally bound by its terms. I understand that I am giving up substantial legal rights, including my right to sue. I sign this document voluntarily and of my own free will.';
  y = drawWrappedText(page, ackText, margin, y, contentWidth, helvetica, 10, textColor);
  y -= 35;

  // ===== PARTICIPANT INFO SECTION =====
  page.drawText('PARTICIPANT INFORMATION', {
    x: margin,
    y,
    size: 10,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 18;

  // Row 1: Name and DOB
  page.drawText('Full Name:', {
    x: margin,
    y,
    size: 9,
    font: helveticaBold,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 55, y: y - 2 },
    end: { x: margin + 250, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  page.drawText('Date of Birth:', {
    x: margin + 270,
    y,
    size: 9,
    font: helveticaBold,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 340, y: y - 2 },
    end: { x: margin + 462, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 18;

  // Row 2: Email and Phone
  page.drawText('Email:', {
    x: margin,
    y,
    size: 9,
    font: helveticaBold,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 35, y: y - 2 },
    end: { x: margin + 250, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  page.drawText('Phone:', {
    x: margin + 270,
    y,
    size: 9,
    font: helveticaBold,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 305, y: y - 2 },
    end: { x: margin + 462, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 22;

  // ===== EMERGENCY CONTACT SECTION =====
  page.drawText('EMERGENCY CONTACT', {
    x: margin,
    y,
    size: 10,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 18;

  // Row 1: Contact Name and Phone
  page.drawText('Contact Name:', {
    x: margin,
    y,
    size: 9,
    font: helveticaBold,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 75, y: y - 2 },
    end: { x: margin + 250, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  page.drawText('Phone:', {
    x: margin + 270,
    y,
    size: 9,
    font: helveticaBold,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 305, y: y - 2 },
    end: { x: margin + 462, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 18;

  // Row 2: Relationship
  page.drawText('Relationship:', {
    x: margin,
    y,
    size: 9,
    font: helveticaBold,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 65, y: y - 2 },
    end: { x: margin + 200, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 25;

  // ===== SIGNATURE SECTION =====
  page.drawText('SIGNATURE', {
    x: margin,
    y,
    size: 10,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 18;

  // Signature box
  page.drawText('Sign here:', {
    x: margin,
    y,
    size: 9,
    font: helveticaBold,
    color: textColor,
  });
  page.drawRectangle({
    x: margin + 55,
    y: y - 30,
    width: 220,
    height: 40,
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 1,
  });

  // Date field
  page.drawText('Date:', {
    x: margin + 300,
    y,
    size: 9,
    font: helveticaBold,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 330, y: y - 2 },
    end: { x: margin + 462, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  y -= 55;

  // Minor section (if applicable)
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 20;

  page.drawText('FOR MINOR PARTICIPANTS (if applicable):', {
    x: margin,
    y,
    size: 10,
    font: helveticaBold,
    color: darkBlue,
  });
  y -= 18;

  const minorText =
    'If signing on behalf of a minor, I certify that I am the parent or legal guardian of the minor named below and have full authority to execute this Waiver on their behalf.';
  y = drawWrappedText(page, minorText, margin, y, contentWidth, helvetica, 9, textColor);
  y -= 20;

  // Minor's Name field
  page.drawText("Minor's Name:", {
    x: margin,
    y,
    size: 10,
    font: helvetica,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 80, y: y - 2 },
    end: { x: margin + 220, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  // Minor's DOB field
  page.drawText("Minor's DOB:", {
    x: margin + 250,
    y,
    size: 10,
    font: helvetica,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 325, y: y - 2 },
    end: { x: margin + 420, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });
  y -= 25;

  // Waiver Expiration field (auto-calculated to minor's 18th birthday)
  page.drawText('Waiver Expiration:', {
    x: margin,
    y,
    size: 10,
    font: helvetica,
    color: textColor,
  });
  page.drawLine({
    start: { x: margin + 105, y: y - 2 },
    end: { x: margin + 220, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });
  page.drawText("(Minor's 18th birthday)", {
    x: margin + 225,
    y,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Footer
  page.drawText('Page 2 of 2', {
    x: pageWidth / 2 - 25,
    y: 30,
    size: 9,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  page.drawText('Bay Tides • https://baytides.org • volunteer@baytides.org', {
    x: margin,
    y: 30,
    size: 8,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Save the PDF
  const pdfBytes = await pdfDoc.save();
  const outputPath = join(
    __dirname,
    '..',
    'docs',
    'documenso',
    'templates',
    'liability-waiver.pdf'
  );
  writeFileSync(outputPath, pdfBytes);

  console.log(`✅ Waiver PDF generated: ${outputPath}`);
  console.log('');
  console.log('This PDF serves as the design reference for the online waiver form.');
  console.log('The actual waiver is completed at: https://baytides.org/volunteer/waiver');
}

generateWaiverPDF().catch(console.error);
