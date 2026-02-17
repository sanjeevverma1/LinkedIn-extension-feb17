# LinkedIn Resume Tailor v2.1 — Chrome Extension

A Chrome extension that extracts job postings from **LinkedIn**, generates tailored resumes & cover letters with Claude AI, saves everything locally, syncs to Google Drive, and exports to Overleaf.

## Features

### Core
- **Smart LinkedIn Job Extraction** — Multi-strategy extraction (logged-in job view DOM, JSON-LD, guest view) with partial-class-match selectors for resilience against LinkedIn's frequent DOM changes
- **Auto-expands "Show more"** — Clicks "Show more" on job descriptions before extraction to get the full text
- **AI-Powered Generation** — OpenAI generates tailored resumes & cover letters using the 5-layer tailoring system
- **Resume Base Template Types** — Choose before generation: Business Development, GTM, Business Operations, Product Management, Enterprise Partnerships, Strategy, Consulting, Payments
- **Future-Proof Template Library** — Supports both built-in template files and user-added custom templates

### Home Dashboard
- Quick stats, action cards, recent activity feed

### Persistence
- **Auto-save job extractions** — Every extracted job saved automatically (up to 200)
- **Auto-save documents** — Every resume & cover letter (markdown + LaTeX) saved automatically
- **Saved Jobs browser** — Load any saved job to re-generate
- **Saved Documents browser** — View, download, or open any saved document

### Download Formats
- **Markdown (.md)** — Clean text
- **LaTeX (.tex)** — moderncv banking style (kpfonts, tight margins, `\cventry` structure)

### Integrations
- **Google Drive Sync** — "Job Apps - Chrome Extension" folder with subfolders
- **Overleaf** — One-click "Open in Overleaf" for any LaTeX file

## Installation

1. Download/unzip this extension folder
2. `chrome://extensions/` → enable **Developer mode**
3. **"Load unpacked"** → select the folder
4. Extension icon appears in toolbar

## Setup

1. Click the extension icon on any LinkedIn jobs page
2. Go to **Profile** tab → fill in your details, pick AI provider (OpenAI or Anthropic), and add that provider key
3. Save

## Usage

1. Go to a **LinkedIn job posting** (e.g. `linkedin.com/jobs/view/123456`)
2. Open the extension from the Chrome toolbar
3. Review extracted job details
4. Choose a **Resume Base Template** in the Extract screen
5. Click **"Generate Resume"** or **"Generate Cover Letter"**
6. Download as Markdown, LaTeX, or open directly in Overleaf
7. Browse saved jobs/docs, sync to Google Drive

## Resume Templates

Built-in template files are stored in:
- `templates/resume-types/index.json` (catalog + default)
- `templates/resume-types/*.tex` (base LaTeX templates)

To add more built-in templates in the future:
1. Add a new `.tex` file in `templates/resume-types/`
2. Add an entry to `templates/resume-types/index.json` with `id`, `name`, `description`, and `file`
3. Reload the extension in `chrome://extensions`

You can also add templates at runtime:
1. Open **Profile**
2. Go to **Resume Base Templates**
3. Paste template LaTeX and click **Add Custom Template**

## LinkedIn Selectors

The content script extracts from these LinkedIn DOM patterns:

| Field | Primary Selector | Fallbacks |
|-------|-----------------|-----------|
| Title | `[class*="top-card__job-title"]` | `h1.t-24`, `h1` |
| Company | `[class*="top-card__company-name"]` | `a[href*="/company/"]` |
| Location | `[class*="primary-description-container"] span.tvm__text` | `[class*="bullet"]` |
| Salary | `[class*="fit-level-preferences"] button` | `[class*="salary"]` |
| Description | `.jobs-description__content` | `[class*="description__text"]`, `#job-details` |
| Seniority | `[class*="job-criteria"] li` | `[class*="seniority-level"]` |

LinkedIn changes class names periodically. The extension uses `[class*="partial"]` matching for resilience.

## Google Drive Setup

See the Google Cloud Console steps in the previous README, or:
1. Google Cloud Console → create project → enable Drive API
2. Credentials → OAuth client ID → Chrome Extension type
3. Enter extension ID from `chrome://extensions/`
4. Put client ID in `manifest.json`

## Privacy

- All data stored locally in `chrome.storage.local`
- API key only sent to the provider you select (OpenAI or Anthropic)
- Google Drive is opt-in OAuth
- No third-party servers
