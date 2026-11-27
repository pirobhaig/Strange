import { jsPDF } from 'jspdf';
import type { PresentationRecord, ProjectRecord } from '../types';

export function exportProductHandoverPdf(project: ProjectRecord): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let y = 56;

  const ensureSpace = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - 56) {
      doc.addPage();
      y = 56;
    }
  };

  const addHeading = (text: string) => {
    ensureSpace(32);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(14, 116, 144);
    doc.text(text, margin, y);
    y += 18;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y - 6, pageWidth - margin, y - 6);
  };

  const addBody = (text: string, indent = 0) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(text, maxWidth - indent);
    for (const line of lines) {
      ensureSpace(15);
      doc.text(line, margin + indent, y);
      y += 14;
    }
    y += 4;
  };

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text(`STRANGE Product Handover & Testing Guide`, margin, y);
  y += 24;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(71, 85, 105);
  doc.text(`Product: ${project.name} (${project.slug})`, margin, y);
  y += 16;
  doc.text(`Generated: ${new Date().toLocaleString()}  |  Status: ${project.status}`, margin, y);
  y += 28;

  addHeading('1. Product Overview');
  addBody(project.prd?.executiveSummary || project.description);
  addBody(`Target Audience: ${project.prd?.targetAudience || 'Defined in opportunity discovery'}`);
  addBody(`Technology Stack: ${project.techStack}`);
  addBody(`Isolated Workspace Folder: ${project.folderPath}`);
  if (project.previewUrl) addBody(`Local Preview Route: ${project.previewUrl}`);
  if (project.liveUrl) addBody(`Live Deployed URL: ${project.liveUrl}`);

  addHeading('2. Implemented Features');
  if (project.prd?.featureList?.length) {
    for (const feat of project.prd.featureList) {
      addBody(`- [${feat.priority}] ${feat.name}: ${feat.description}`, 8);
    }
  } else {
    addBody('Core MVP features generated in isolated workspace.');
  }

  addHeading('3. Three-Pass Testing Report (Verified Results)');
  if (project.testResults.length === 0) {
    addBody('No testing passes have been executed yet. Run the 3-pass test suite before approving.');
  } else {
    for (const pass of project.testResults) {
      addBody(`${pass.name} — Status: ${pass.status.toUpperCase()} (${pass.executedAt})`);
      addBody(`Summary: ${pass.summary}`, 10);
      for (const chk of pass.checks) {
        addBody(`[${chk.status.toUpperCase()}] ${chk.name}: ${chk.details}`, 16);
      }
    }
  }

  addHeading('4. Setup & Deployment Instructions');
  addBody('1. Review generated source files inside the isolated workspace folder.');
  addBody('2. Run unit tests locally via `npm test` inside the workspace folder.');
  addBody('3. Run full Playwright Chromium E2E tests on Windows 10 via `npx playwright test`.');
  addBody('4. Queue a Vercel deployment approval in STRANGE before pushing to production.');

  addHeading('5. Known Limitations & Risks');
  if (project.prd?.risksAndAssumptions?.length) {
    for (const risk of project.prd.risksAndAssumptions) {
      addBody(`- ${risk}`, 8);
    }
  } else {
    addBody('- Review generated business logic and run Playwright Chromium checks on Windows 10.');
  }

  doc.save(`${project.slug}-handover-guide.pdf`);
}

export function exportPresentationPdf(deck: PresentationRecord): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  deck.slides.forEach((slide, index) => {
    if (index > 0) doc.addPage();

    doc.setFillColor(10, 14, 22);
    doc.rect(0, 0, w, h, 'F');

    // Subtle top accent hairline
    doc.setDrawColor(6, 182, 212);
    doc.setLineWidth(2);
    doc.line(48, 52, w - 48, 52);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text(`${deck.title}  ·  Slide ${slide.slideNumber} of ${deck.slides.length}`, 48, 40);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.setTextColor(241, 245, 249);
    const titleLines = doc.splitTextToSize(slide.title, w - 96);
    doc.text(titleLines, 48, 96);

    let y = 96 + titleLines.length * 32 + 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.setTextColor(203, 213, 225);
    for (const point of slide.keyPoints) {
      const lines = doc.splitTextToSize(`•  ${point}`, w - 120);
      doc.text(lines, 58, y);
      y += lines.length * 20 + 10;
    }

    // Speaker notes strip
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(1);
    doc.line(48, h - 92, w - 48, h - 92);
    doc.setFontSize(9.5);
    doc.setTextColor(148, 163, 184);
    const noteLines = doc.splitTextToSize(`Speaker Notes: ${slide.speakerNotes}`, w - 96);
    doc.text(noteLines.slice(0, 3), 48, h - 72);
  });

  const safeFile = deck.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  doc.save(`${safeFile || 'strange-presentation'}.pdf`);
}
