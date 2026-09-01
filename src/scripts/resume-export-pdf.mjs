/**
 * resume-export-pdf.mjs
 *
 * Created by Alexander Gusarov on 04.03.2026.
 * @spartan121
 *
 * Reads src/content/cv/en.yaml and ru.yaml,
 * builds a clean two-column print HTML and exports PDF via Playwright.
 * Also renders a second, single-column ATS-safe PDF from the same data —
 * see htmlAts() below.
 *
 * Usage:
 *   npm run resume:pdf
 *
 * Output (per lang[_spec] found in public/cv/, e.g. en, en_devops, ru):
 *   public/downloads/resume_{suffix}.pdf       — two-column, for humans
 *   public/downloads/resume_{suffix}_ats.pdf   — single-column, for ATS parsers
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { chromium } from 'playwright';

const ROOT       = path.resolve('.');
const CONTENT    = path.join(ROOT, 'src/content/cv');
const OUTPUT_DIR = path.join(ROOT, 'public/downloads');

const FILES = [
  { yaml: 'en.yaml', suffix: 'en' },
  { yaml: 'ru.yaml', suffix: 'ru' },
];

const T = {
  en: {
    about:        'About me',
    achievements: 'Key Achievements',
    skills:       'Skills',
    experience:   'Experience',
    education:    'Education',
    languages:    'Languages',
    salary:       'Salary',
    employment:   'Employment',
    workFormat:   'Work format',
    location:     'Location',
  },
  ru: {
    about:        'Обо мне',
    achievements: 'Ключевые достижения',
    skills:       'Навыки',
    experience:   'Опыт',
    education:    'Образование',
    languages:    'Языки',
    salary:       'Зарплата',
    employment:   'Занятость',
    workFormat:   'Формат работы',
    location:     'Местоположение',
  },
};

// Escape user data before interpolating into HTML — a stray < or & in a
// company name / bullet / URL would otherwise break or inject into the PDF.
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function formatContactDisplay(c) {
  const rawUrl = c.url ?? '';
  if (/^tel:/i.test(rawUrl)) {
    return rawUrl.replace(/^tel:/i, '');
  }
  if (/^mailto:/i.test(rawUrl)) {
    return rawUrl.replace(/^mailto:/i, '');
  }
  return rawUrl
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/$/, '');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadYaml(filename) {
  const raw = fs.readFileSync(path.join(ROOT, 'public/cv', filename), 'utf8');
  return parse(raw);
}

function cleanPeriod(period = '') {
  return String(period ?? '')
    .replace(/—\s*undefined/g, '')
    .replace(/—\s*$/,          '')
    .trim();
}

function html(cv, lang = 'en') {
  const tr = T[lang] ?? T.en;

  /* ── Personal & Job details (gender, birthdate, location, salary, employment, work format) ── */
  const personalParts = [cv.gender, cv.birthdate].filter(Boolean);
  const personalHtml = personalParts.length ? `
    <div class="meta-personal">${esc(personalParts.join(', '))}</div>
  ` : '';

  const jobDetails = [
    cv.location    ? `<div class="detail-row"><span class="detail-label">${esc(tr.location)}:</span> <span class="detail-val">${esc(cv.location)}</span></div>` : '',
    cv.salary      ? `<div class="detail-row"><span class="detail-label">${esc(tr.salary)}:</span> <span class="detail-val highlight">${esc(cv.salary)}</span></div>` : '',
    cv.employment  ? `<div class="detail-row"><span class="detail-label">${esc(tr.employment)}:</span> <span class="detail-val">${esc(cv.employment)}</span></div>` : '',
    cv.work_format ? `<div class="detail-row"><span class="detail-label">${esc(tr.workFormat)}:</span> <span class="detail-val">${esc(cv.work_format)}</span></div>` : '',
  ].filter(Boolean).join('');

  const detailsHtml = jobDetails ? `
    <div class="sidebar-details">
      ${jobDetails}
    </div>
  ` : '';

  /* ── Contacts: label + real display text as link ── */
  const contactsHtml = (cv.contacts ?? [])
    .map(c => {
      const display = formatContactDisplay(c);
      return `<div class="contact-row"><a href="${esc(c.url)}"><span class="contact-label">${esc(c.label)}:</span> <span class="contact-value">${esc(display)}</span></a></div>`;
    })
    .join('');

  /* ── Education ── */
  const educationHtml = (cv.education ?? []).length ? `
    <div class="sidebar-section">
      <div class="sidebar-divider"></div>
      <h3>${tr.education}</h3>
      ${(cv.education ?? []).map(e => `
        <div class="edu-item">
          <div class="edu-institution">${esc(e.institution)}</div>
          ${e.period ? `<div class="edu-period">${esc(e.period)}</div>` : ''}
          ${e.degree ? `<div class="edu-degree">${esc(e.degree)}</div>` : ''}
          ${e.field  ? `<div class="edu-field">${esc(e.field)}</div>`   : ''}
        </div>
      `).join('')}
    </div>` : '';

  /* ── Skills ── */
  const skillsHtml = (cv.skills ?? []).length ? `
    <div class="sidebar-section">
      <div class="sidebar-divider"></div>
      <h3>${tr.skills}</h3>
      ${(cv.skills ?? []).map(s => {
        const groupName = typeof s === 'string' ? null : (s.group ?? null);
        const items = typeof s === 'string' ? [s] : (s.items ?? []);
        return `
        <div class="skill-group-block">
          ${groupName ? `<div class="skill-group-name">${esc(groupName)}</div>` : ''}
          <div class="skill-items">${items.map(esc).join(' · ')}</div>
        </div>`;
      }).join('')}
    </div>` : '';

  /* ── Languages ── */
  const languagesHtml = (cv.languages ?? []).length ? `
    <div class="sidebar-section">
      <div class="sidebar-divider"></div>
      <h3>${tr.languages}</h3>
      ${(cv.languages ?? []).map(l => `
        <div class="lang-row">
          <div class="lang-name">${esc(l.language)}</div>
          <div class="lang-level">${esc(l.level)}</div>
        </div>
      `).join('')}
    </div>` : '';

  /* ── About / Summary ── */
  const aboutHtml = cv.summary ? `
    <section class="content-section">
      <h2>${tr.about}</h2>
      <p class="summary-text">${esc(cv.summary)}</p>
    </section>` : '';

  /* ── Achievements ── */
  const achievementsHtml = (cv.achievements ?? []).length ? `
    <section class="content-section">
      <h2>${tr.achievements}</h2>
      <ul class="bullets">
        ${(cv.achievements ?? []).map(a => `<li>${esc(a)}</li>`).join('')}
      </ul>
    </section>` : '';

  /* ── Experience ── */
  const experienceHtml = (cv.experience ?? []).length ? `
    <section class="content-section">
      <h2>${tr.experience}</h2>
      ${(cv.experience ?? []).map(exp => {
        const desc = Array.isArray(exp.description) ? exp.description.filter(Boolean) : [];
        return `
        <div class="exp-entry">
          <div class="exp-lead">
            <div class="exp-header">
              <div class="exp-company">${esc(exp.company)}${exp.role ? ` <span class="exp-role">— ${esc(exp.role)}</span>` : ''}</div>
              <div class="exp-period">${esc(cleanPeriod(exp.period))}</div>
            </div>
          </div>
          ${desc.length ? `<ul class="bullets">${desc.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
          ${exp.stack?.length ? `<div class="exp-stack">${exp.stack.map(esc).join(', ')}</div>` : ''}
        </div>`;
      }).join('')}
    </section>` : '';

  /* ── Avatar (top of sidebar) — base64-embedded so the PDF is self-contained
     and the URL in CV YAML (e.g. /avatar.jpg on GitHub Pages under /cv_hub/)
     doesn't have to resolve at render time. ── */
  let avatarDataUri = null;
  if (cv.image) {
    const imgPath = path.join(ROOT, 'public', cv.image.replace(/^\//, ''));
    if (fs.existsSync(imgPath)) {
      const buf  = fs.readFileSync(imgPath);
      const mime = imgPath.toLowerCase().endsWith('.png') ? 'image/png'
                 : imgPath.toLowerCase().endsWith('.jpg') || imgPath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg'
                 : 'application/octet-stream';
      avatarDataUri = `data:${mime};base64,${buf.toString('base64')}`;
    }
  }

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --accent:     #1F439B;
      --text:       #1a1a1a;
      --muted:      #555555;
      --light:      #888888;
      --sidebar-bg: #F5F5F5;
      --divider:    #1a1a1a;
    }

    html, body {
      width: 210mm;
      height: 297mm;
    }

    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 9.5pt;
      font-weight: 400;
      color: var(--text);
      background: #fff;
      display: grid;
      grid-template-columns: 66mm 1fr;
      line-height: 1.5;
    }

    a { color: inherit; text-decoration: none; }

    /* ─────────────────────────────────────────
       SIDEBAR
       ───────────────────────────────────────── */
    .sidebar {
      background: var(--sidebar-bg);
      padding: 13mm 7mm 13mm 8mm;
      display: flex;
      flex-direction: column;
    }

    .cv-avatar {
      width: 36mm;
      height: 36mm;
      border-radius: 50%;
      object-fit: cover;
      margin-bottom: 8px;
      align-self: flex-start;
    }

    .cv-name {
      font-size: 18pt;
      font-weight: 600;
      line-height: 1.15;
      color: var(--text);
      margin-bottom: 3px;
    }

    /* General role — black, lighter weight */
    .cv-title {
      font-size: 9.5pt;
      font-weight: 400;
      color: var(--text);
      margin-bottom: 6px;
      line-height: 1.35;
    }

    .meta-personal {
      font-size: 8pt;
      color: var(--muted);
      margin-bottom: 8px;
      line-height: 1.35;
    }

    .sidebar-details {
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #d0d0d0;
    }

    .detail-row {
      font-size: 8pt;
      line-height: 1.4;
      margin-bottom: 2px;
      color: var(--text);
    }

    .detail-label {
      color: var(--muted);
      font-weight: 500;
    }

    .detail-val {
      color: var(--text);
    }

    .detail-val.highlight {
      font-weight: 600;
      color: var(--accent);
    }

    /* Contacts: label and display as link */
    .contact-row {
      margin-bottom: 3.5px;
      font-size: 8pt;
      line-height: 1.35;
    }

    .contact-row a {
      color: var(--text);
      text-decoration: none;
      display: block;
      word-break: break-all;
    }

    .contact-row a:hover {
      text-decoration: underline;
    }

    .contact-label {
      font-weight: 600;
      color: var(--text);
    }

    .contact-value {
      color: var(--accent);
      font-weight: 500;
    }

    /* Sidebar sections */
    .sidebar-section { margin-top: 2px; }

    .sidebar-divider {
      border: none;
      border-top: 1px solid #d0d0d0;
      margin: 8px 0 6px;
    }

    .sidebar-section h3 {
      font-size: 8.5pt;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--text);
      margin-bottom: 5px;
    }

    /* Education */
    .edu-item { margin-bottom: 6px; }

    .edu-institution {
      font-weight: 600;
      color: var(--accent);
      font-size: 8pt;
    }

    .edu-period {
      font-size: 7.5pt;
      color: var(--light);
    }

    .edu-degree, .edu-field {
      font-size: 8pt;
      color: var(--muted);
    }

    /* Skills */
    .skill-group-block { margin-bottom: 5px; }

    .skill-group-name {
      font-weight: 600;
      color: var(--accent);
      font-size: 8pt;
      margin-bottom: 1px;
    }

    .skill-items {
      font-size: 8pt;
      color: var(--muted);
      line-height: 1.45;
    }

    /* Languages — stacked, not side-by-side */
    .lang-row {
      margin-bottom: 4px;
    }

    .lang-name {
      font-weight: 600;
      font-size: 8pt;
      color: var(--text);
    }

    .lang-level {
      font-size: 7.5pt;
      color: var(--muted);
    }

    /* ─────────────────────────────────────────
       MAIN CONTENT
       ───────────────────────────────────────── */
    .content {
      padding: 13mm 10mm 13mm 10mm;
      display: flex;
      flex-direction: column;
    }

    .content-section { margin-bottom: 11px; }

    /* Section titles — bigger, black, thicker divider */
    .content-section h2 {
      font-size: 12.5pt;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 5px;
      padding-bottom: 3px;
      border-bottom: 2px solid var(--divider);
    }

    /* Summary */
    .summary-text {
      font-size: 9pt;
      color: #333;
      line-height: 1.55;
    }

    /* Experience */
    .exp-entry { margin-bottom: 9px; }

    /* Only header stays glued to first bullet on page break */
    .exp-lead { break-inside: avoid; }

    .exp-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 2px;
    }

    .exp-company {
      font-size: 9.5pt;
      font-weight: 600;
      color: var(--accent);
      flex: 1;
    }

    /* Role — same color as company */
    .exp-role {
      font-weight: 400;
      color: var(--accent);
      font-size: 9pt;
    }

    .exp-period {
      font-size: 8pt;
      color: var(--light);
      white-space: nowrap;
    }

    /* Stack — indented to align with bullet text, not bullet marker */
    .exp-stack {
      font-size: 7.5pt;
      color: var(--light);
      margin-top: 2px;
      padding-left: 13px;
      font-style: italic;
    }

    /* Bullets */
    .bullets {
      padding-left: 13px;
      margin: 2px 0;
    }

    .bullets li {
      font-size: 8.5pt;
      color: #333;
      margin-bottom: 2px;
      line-height: 1.45;
    }

    .bullets li::marker {
      color: var(--accent);
      font-size: 7.5pt;
    }
  </style>
</head>
<body>

  <!-- SIDEBAR -->
  <div class="sidebar">
    ${avatarDataUri ? `<img class="cv-avatar" src="${avatarDataUri}" alt="${esc(cv.name)}"/>` : ''}
    <div class="cv-name">${esc(cv.name)}</div>
    <div class="cv-title">${esc(cv.title)}</div>
    ${personalHtml}
    ${detailsHtml}

    ${contactsHtml}
    ${educationHtml}
    ${skillsHtml}
    ${languagesHtml}
  </div>

  <!-- CONTENT -->
  <div class="content">
    ${aboutHtml}
    ${achievementsHtml}
    ${experienceHtml}
  </div>

</body>
</html>`;
}

// ATS-safe variant: single linear column, reading order top-to-bottom exactly
// matches DOM order (nothing an ATS text-extractor could re-shuffle across
// columns), standard section headings, no icons, no header/footer regions —
// contacts sit in the normal document flow. Same data, same esc()/tr, laid
// out flat instead of sidebar + content.
function htmlAts(cv, lang = 'en') {
  const tr = T[lang] ?? T.en;

  const contactsHtml = (cv.contacts ?? []).length ? `
    <div class="contacts">
      ${(cv.contacts ?? []).map(c => {
        const display = formatContactDisplay(c);
        return `<a href="${esc(c.url)}"><strong>${esc(c.label)}:</strong> ${esc(display)}</a>`;
      }).join('<span class="sep">·</span>')}
    </div>` : '';

  const personalParts = [cv.gender, cv.birthdate].filter(Boolean);
  const personalLine = personalParts.length ? `
    <p class="meta-line">${esc(personalParts.join(', '))}</p>
  ` : '';

  const detailsList = [
    cv.location    ? `<strong>${esc(tr.location)}:</strong> ${esc(cv.location)}` : '',
    cv.salary      ? `<strong>${esc(tr.salary)}:</strong> ${esc(cv.salary)}` : '',
    cv.employment  ? `<strong>${esc(tr.employment)}:</strong> ${esc(cv.employment)}` : '',
    cv.work_format ? `<strong>${esc(tr.workFormat)}:</strong> ${esc(cv.work_format)}` : '',
  ].filter(Boolean);

  const detailsLine = detailsList.length ? `
    <p class="meta-line">${detailsList.join(' <span class="sep">·</span> ')}</p>
  ` : '';

  const aboutHtml = cv.summary ? `
    <section class="section">
      <h2>${tr.about}</h2>
      <p>${esc(cv.summary)}</p>
    </section>` : '';

  const skillsHtml = (cv.skills ?? []).length ? `
    <section class="section">
      <h2>${tr.skills}</h2>
      ${(cv.skills ?? []).map(s => {
        const groupName = typeof s === 'string' ? null : (s.group ?? null);
        const items = typeof s === 'string' ? [s] : (s.items ?? []);
        return `<p class="skill-line">${groupName ? `<strong>${esc(groupName)}:</strong> ` : ''}${items.map(esc).join(', ')}</p>`;
      }).join('')}
    </section>` : '';

  const achievementsHtml = (cv.achievements ?? []).length ? `
    <section class="section">
      <h2>${tr.achievements}</h2>
      <ul>${(cv.achievements ?? []).map(a => `<li>${esc(a)}</li>`).join('')}</ul>
    </section>` : '';

  const experienceHtml = (cv.experience ?? []).length ? `
    <section class="section">
      <h2>${tr.experience}</h2>
      ${(cv.experience ?? []).map(exp => {
        const desc = Array.isArray(exp.description) ? exp.description.filter(Boolean) : [];
        return `
        <div class="entry">
          <p class="entry-head">
            <strong>${esc(exp.company)}</strong>${exp.role ? ` — ${esc(exp.role)}` : ''}, ${esc(cleanPeriod(exp.period))}
          </p>
          ${desc.length ? `<ul>${desc.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
          ${exp.stack?.length ? `<p class="entry-stack">${exp.stack.map(esc).join(', ')}</p>` : ''}
        </div>`;
      }).join('')}
    </section>` : '';

  const educationHtml = (cv.education ?? []).length ? `
    <section class="section">
      <h2>${tr.education}</h2>
      ${(cv.education ?? []).map(e => `
        <p class="entry-head">
          <strong>${esc(e.institution)}</strong>${e.degree ? `, ${esc(e.degree)}` : ''}${e.period ? `, ${esc(e.period)}` : ''}
        </p>`).join('')}
    </section>` : '';

  const languagesHtml = (cv.languages ?? []).length ? `
    <section class="section">
      <h2>${tr.languages}</h2>
      <p>${(cv.languages ?? []).map(l => `${esc(l.language)} — ${esc(l.level)}`).join(', ')}</p>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11pt;
      font-weight: 400;
      color: #1a1a1a;
      background: #fff;
      line-height: 1.4;
    }

    a { color: inherit; text-decoration: underline; }

    .cv-name {
      font-size: 20pt;
      font-weight: 700;
    }

    .cv-title {
      font-size: 12pt;
      font-weight: 400;
      margin-top: 2px;
    }

    .meta-line {
      font-size: 10pt;
      color: #444;
      margin-top: 3px;
    }

    .contacts {
      margin-top: 8px;
      font-size: 10.5pt;
    }

    .contacts .sep, .meta-line .sep { margin: 0 6px; }

    .section { margin-top: 16px; }

    .section h2 {
      font-size: 13pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid #1a1a1a;
      padding-bottom: 3px;
      margin-bottom: 8px;
    }

    .section p { margin-bottom: 4px; }

    .skill-line { font-size: 11pt; }

    .entry { margin-bottom: 10px; }
    .entry-head { break-inside: avoid; }
    .entry-stack { font-style: italic; color: #333; font-size: 10.5pt; }

    ul { padding-left: 18px; margin: 3px 0 6px; }
    li { font-size: 11pt; margin-bottom: 2px; }
  </style>
</head>
<body>
  <div class="cv-name">${esc(cv.name)}</div>
  <div class="cv-title">${esc(cv.title)}</div>
  ${personalLine}
  ${detailsLine}
  ${contactsHtml}
  ${aboutHtml}
  ${skillsHtml}
  ${achievementsHtml}
  ${experienceHtml}
  ${educationHtml}
  ${languagesHtml}
</body>
</html>`;
}

async function run() {
  ensureDir(OUTPUT_DIR);

  const files = fs.readdirSync(path.join(ROOT, 'public/cv'))
    .filter(f => f.endsWith('.yaml'));

  // On CI use the runner's preinstalled Google Chrome (channel: 'chrome') — it
  // avoids downloading Playwright's chromium, which stalls on cdn.playwright.dev.
  // Locally fall back to Playwright's bundled chromium.
  const browser = await chromium.launch(process.env.CI ? { channel: 'chrome' } : {});
  const page    = await browser.newPage();

  for (const file of files) {
    const suffix  = file.replace('.yaml', '');
    const lang    = suffix.split('_')[0];
    const cv      = loadYaml(file);
    const content = html(cv, lang);

    await page.setContent(content, { waitUntil: 'networkidle' });

    const outPath = path.join(OUTPUT_DIR, `resume_${suffix}.pdf`);
    await page.pdf({
      path:            outPath,
      format:          'A4',
      printBackground: true,
      margin:          { top: '0', right: '0', bottom: '0', left: '0' },
    });

    console.log(`✔ ${outPath}`);

    // ATS variant — flows naturally across as many pages as the content
    // needs (unlike the fixed one-page two-column design above), so it gets
    // real page margins instead of the zero-margin/fixed-height trick.
    const contentAts = htmlAts(cv, lang);
    await page.setContent(contentAts, { waitUntil: 'networkidle' });

    const outPathAts = path.join(OUTPUT_DIR, `resume_${suffix}_ats.pdf`);
    await page.pdf({
      path:            outPathAts,
      format:          'A4',
      printBackground: true,
      margin:          { top: '18mm', right: '18mm', bottom: '18mm', left: '18mm' },
    });

    console.log(`✔ ${outPathAts}`);
  }

  await browser.close();
  console.log('\nDone.');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
