// sidepanel.js — v2.0: Full-featured side panel
(function () {
  "use strict";

  // ═══════════ State ═══════════
  let currentJobData = null;
  let profile = {};
  let savedJobs = [];       // { id, ...jobData }
  let savedDocs = [];       // { id, jobId, type: 'resume'|'cover', markdown, latex, company, title, createdAt }
  let gdriveToken = null;
  let gdriveFolderId = null;
  let navHistory = ["home"];

  // raw AI text (before HTML conversion) — kept for downloads
  let currentResumeMarkdown = "";
  let currentCoverMarkdown = "";
  // LaTeX versions
  let currentResumeLatex = "";
  let currentCoverLatex = "";
  let extractionInFlight = false;
  let jobsSearchQuery = "";
  let builtinResumeTemplates = [];
  let customResumeTemplates = [];
  let defaultResumeTemplateId = "business-development";

  const PROFILE_SEED_VERSION = 1;
  const RESUME_TEMPLATE_INDEX_PATH = "templates/resume-types/index.json";
  const DEFAULT_SANJEEV_PROFILE = {
    name: "Sanjeev Verma",
    location: "San Francisco, CA",
    title: "Vice President, Strategy & Partnerships",
    years: "12",
    expertise: "Payments, GTM strategy, business development, product strategy, enterprise partnerships",
    companies: "J.P. Morgan, Deloitte, Mastercard",
    experience: `J.P. Morgan | Vice President, Strategy & Partnerships | Sep 2024 - Present | San Francisco, CA
• Lead strategic initiatives across payments and enterprise partnership workflows.
• Drive cross-functional planning, stakeholder alignment, and execution across business and technology teams.
• Deploy Generative AI tools to synthesize market intelligence and improve strategic decision-making.

Deloitte | Director | Aug 2022 - Aug 2024 | San Francisco, CA
• Led cross-functional engagement with 75 client stakeholders to modernize a $24B platform.
• Delivered roadmap and execution strategy that drove $50M in annual savings.

Mastercard | Director / Manager / Senior Consultant, Advisors | Aug 2016 - Aug 2022 | New York, NY
• Led payments and advisory work across enterprise clients and global stakeholders.
• Drove initiatives across fraud prevention, payment optimization, and digital wallet strategy.`,
    education: "Reed College, Bachelor of Arts, May 2016",
    additional: 'Publications: "The Role of Generative AI in Payments"; Languages: German (conversational)',
  };
  const FIXED_LATEX_IDENTITY = {
    firstName: "Sanjeev",
    lastName: "Verma",
    mobile: "+1 (856) 316-8440",
    email: "sanjeevverma1@me.com",
    homepage: "linkedin.com/in/sanjeev-verma",
  };
  const EXACT_MODERNCV_PREAMBLE = String.raw`\documentclass[11pt,a4paper]{moderncv}
\usepackage[english]{babel}
\moderncvstyle{banking}
\moderncvcolor{black}
\renewcommand*{\firstnamestyle}[1]{{\namefont\textcolor{black}{#1}}}
\renewcommand{\familydefault}{\rmdefault}
\nopagenumbers{}
\usepackage{kpfonts}
\usepackage{soul}
\usepackage[utf8]{inputenc}
\usepackage{color}
\usepackage{CJKutf8}
\usepackage[top=.35in, bottom=.35in, left=.55in, right=.55in]{geometry}
\setlength{\hintscolumnwidth}{1cm}
\usepackage{import}`;
  const FIXED_PUBLICATIONS_BULLET_LATEX = "\\item[\\textbullet] Publications:  ``Generative AI in Financial Services'' (JP Morgan 2025); ``The Role of Generative AI in Payments'' (Deloitte 2024); ``The Impact of Digital Wallets on Consumer Spending'' (Mastercard 2023)";
  const FIXED_PUBLICATIONS_ITEMIZE_LATEX = `\\begin{itemize}\n${FIXED_PUBLICATIONS_BULLET_LATEX}\n\\end{itemize}`;
  const FIXED_PUBLICATIONS_TEXT = `Publications: "Generative AI in Financial Services" (JP Morgan 2025); "The Role of Generative AI in Payments" (Deloitte 2024); "The Impact of Digital Wallets on Consumer Spending" (Mastercard 2023)`;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════════

  function navigate(viewName, pushHistory = true) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    const target = $(`#view-${viewName}`);
    if (target) target.classList.add("active");

    // Bottom nav highlighting
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === viewName));

    // Back button
    if (pushHistory) navHistory.push(viewName);
    $("#btn-back").classList.toggle("hidden", navHistory.length <= 1);

    // Update header title
    const titles = {
      home: "Resume Tailor", extract: "Extract Job", resume: "Resume",
      cover: "Cover Letter", "saved-jobs": "Saved Jobs", "saved-docs": "Documents",
      gdrive: "Google Drive", profile: "Profile",
    };
    $("#header-title span").textContent = titles[viewName] || "Resume Tailor";
  }

  // Bottom nav
  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.view));
  });

  // Back
  $("#btn-back").addEventListener("click", () => {
    if (navHistory.length > 1) {
      navHistory.pop();
      navigate(navHistory[navHistory.length - 1], false);
    }
  });

  // Settings → Profile
  $("#btn-settings").addEventListener("click", () => navigate("profile"));

  // Home action buttons
  $("#home-extract").addEventListener("click", () => { navigate("extract"); requestExtraction(); });
  $("#home-saved-jobs").addEventListener("click", () => navigate("saved-jobs"));
  $("#home-saved-docs").addEventListener("click", () => navigate("saved-docs"));
  $("#home-gdrive").addEventListener("click", () => navigate("gdrive"));

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE
  // ═══════════════════════════════════════════════════════════════════════════

  function mergeProfileDefaults(current = {}) {
    const merged = { ...current };
    Object.keys(DEFAULT_SANJEEV_PROFILE).forEach((key) => {
      if (!merged[key]) merged[key] = DEFAULT_SANJEEV_PROFILE[key];
    });
    return merged;
  }

  async function loadAll() {
    const data = await chrome.storage.local.get([
      "profile",
      "savedJobs",
      "savedDocs",
      "gdriveToken",
      "gdriveFolderId",
      "profileSeedVersion",
      "customResumeTemplates",
    ]);
    profile = data.profile || {};
    savedJobs = data.savedJobs || [];
    savedDocs = data.savedDocs || [];
    gdriveToken = data.gdriveToken || null;
    gdriveFolderId = data.gdriveFolderId || null;
    customResumeTemplates = Array.isArray(data.customResumeTemplates)
      ? data.customResumeTemplates
        .filter((item) => item && item.id && item.name && item.content)
        .map((item) => ({
          id: String(item.id),
          name: String(item.name),
          description: String(item.description || ""),
          content: String(item.content || ""),
          source: "custom",
          createdAt: item.createdAt || new Date().toISOString(),
        }))
      : [];

    if (!data.profileSeedVersion) {
      profile = mergeProfileDefaults(profile);
      await chrome.storage.local.set({ profile, profileSeedVersion: PROFILE_SEED_VERSION });
    }

    // Backward compatibility: migrate old single-key field to OpenAI key.
    if (profile.apikey && !profile.openaikey) {
      profile.openaikey = profile.apikey;
      await chrome.storage.local.set({ profile });
    }
    if (!profile.provider) profile.provider = "openai";
  }

  async function saveCustomResumeTemplates() {
    await chrome.storage.local.set({ customResumeTemplates });
  }

  async function saveJobs() {
    await chrome.storage.local.set({ savedJobs });
  }

  async function saveDocs() {
    await chrome.storage.local.set({ savedDocs });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFILE
  // ═══════════════════════════════════════════════════════════════════════════

  const profileFields = [
    "prof-name", "prof-email", "prof-phone", "prof-linkedin", "prof-location",
    "prof-title", "prof-years", "prof-expertise", "prof-companies",
    "prof-experience", "prof-education", "prof-additional",
    "prof-provider", "prof-openaikey", "prof-anthropickey",
  ];

  function loadProfileUI() {
    profileFields.forEach((id) => {
      const el = $(`#${id}`);
      const key = id.replace("prof-", "");
      if (el && profile[key]) el.value = profile[key];
    });
  }

  async function saveProfile() {
    profileFields.forEach((id) => {
      const el = $(`#${id}`);
      const key = id.replace("prof-", "");
      if (el) profile[key] = el.value.trim();
    });
    await chrome.storage.local.set({ profile });
    const s = $("#save-status");
    s.textContent = "Profile saved!";
    s.className = "save-status success";
    s.classList.remove("hidden");
    setTimeout(() => s.classList.add("hidden"), 2500);
  }

  $("#btn-save-profile").addEventListener("click", saveProfile);

  $("#gen-provider").addEventListener("change", () => {
    const provider = $("#gen-provider").value === "anthropic" ? "anthropic" : "openai";
    profile.provider = provider;
  });

  async function persistProfile() {
    await chrome.storage.local.set({ profile });
  }

  async function loadBuiltinResumeTemplates() {
    try {
      const indexResp = await fetch(chrome.runtime.getURL(RESUME_TEMPLATE_INDEX_PATH));
      if (!indexResp.ok) throw new Error(`Template index fetch failed (${indexResp.status})`);
      const indexData = await indexResp.json();
      const listedTemplates = Array.isArray(indexData?.templates) ? indexData.templates : [];
      if (indexData?.defaultTemplateId) defaultResumeTemplateId = indexData.defaultTemplateId;

      const loaded = await Promise.all(
        listedTemplates.map(async (item) => {
          if (!item?.id || !item?.name || !item?.file) return null;
          try {
            const fileResp = await fetch(chrome.runtime.getURL(`templates/resume-types/${item.file}`));
            if (!fileResp.ok) throw new Error(`Template file missing (${item.file})`);
            const content = await fileResp.text();
            return {
              id: String(item.id),
              name: String(item.name),
              description: String(item.description || ""),
              content: String(content || ""),
              source: "builtin",
            };
          } catch (err) {
            console.warn("Failed loading template file", item.file, err);
            return null;
          }
        })
      );

      builtinResumeTemplates = loaded.filter(Boolean);
    } catch (err) {
      console.warn("Failed loading builtin resume templates", err);
      builtinResumeTemplates = [];
    }
  }

  function getAllResumeTemplates() {
    return [...builtinResumeTemplates, ...customResumeTemplates];
  }

  function getSelectedResumeTemplateId() {
    if (profile.resumeTemplateId) return profile.resumeTemplateId;
    const selectedFromUI = $("#resume-template-select")?.value;
    if (selectedFromUI) return selectedFromUI;
    return defaultResumeTemplateId;
  }

  function getSelectedResumeTemplate() {
    const selectedId = getSelectedResumeTemplateId();
    return getAllResumeTemplates().find((t) => t.id === selectedId) || null;
  }

  function inferTemplateDescription(template = {}) {
    if (template.description) return template.description;
    const firstLine = String(template.content || "").split("\n").find((line) => line.trim());
    return firstLine ? firstLine.slice(0, 140) : "No description";
  }

  async function ensureSelectedResumeTemplate() {
    const all = getAllResumeTemplates();
    if (all.length === 0) return;
    const valid = all.some((t) => t.id === profile.resumeTemplateId);
    if (!valid) {
      const fallback = all.find((t) => t.id === defaultResumeTemplateId) || all[0];
      profile.resumeTemplateId = fallback.id;
      await persistProfile();
    }
  }

  function renderResumeTemplateSelector() {
    const select = $("#resume-template-select");
    if (!select) return;
    const templates = getAllResumeTemplates();
    if (templates.length === 0) {
      select.innerHTML = '<option value="">No templates found</option>';
      select.disabled = true;
      $("#resume-template-hint").textContent = "No templates available. Add one in Profile.";
      return;
    }

    select.disabled = false;
    select.innerHTML = templates
      .map((t) => `<option value="${escHtml(t.id)}">${escHtml(t.name)}${t.source === "custom" ? " (Custom)" : ""}</option>`)
      .join("");

    const selected = getSelectedResumeTemplateId();
    select.value = templates.some((t) => t.id === selected) ? selected : templates[0].id;
    const selectedTemplate = templates.find((t) => t.id === select.value);
    if (selectedTemplate) {
      $("#resume-template-hint").textContent = `${selectedTemplate.name}: ${inferTemplateDescription(selectedTemplate)}`;
    }
  }

  function renderTemplateLibraryUI() {
    const container = $("#template-library-list");
    if (!container) return;
    const templates = getAllResumeTemplates();
    if (templates.length === 0) {
      container.innerHTML = '<p class="empty-hint">No templates available.</p>';
      return;
    }

    const selectedId = getSelectedResumeTemplateId();
    container.innerHTML = templates.map((t) => {
      const selectedTag = t.id === selectedId ? '<span class="badge-pill builtin">Selected</span>' : "";
      const sourceTag = `<span class="badge-pill ${t.source === "custom" ? "custom" : "builtin"}">${t.source === "custom" ? "Custom" : "Built-in"}</span>`;
      const actions = t.source === "custom"
        ? `<div class="template-actions"><button class="btn btn-sm template-use" data-id="${escHtml(t.id)}">Use</button><button class="btn btn-sm btn-danger template-delete" data-id="${escHtml(t.id)}">Delete</button></div>`
        : '<div class="template-actions"><button class="btn btn-sm template-use" data-id="' + escHtml(t.id) + '">Use</button></div>';

      return `
        <div class="template-library-item">
          <div class="template-library-top">
            <div class="template-library-name">${escHtml(t.name)}</div>
            ${sourceTag}
          </div>
          <div class="template-library-meta">${escHtml(inferTemplateDescription(t))}</div>
          <div class="template-library-top" style="margin-top:6px;">
            ${selectedTag || "<span></span>"}
            ${actions}
          </div>
        </div>`;
    }).join("");
  }

  async function selectResumeTemplate(templateId) {
    const exists = getAllResumeTemplates().some((t) => t.id === templateId);
    if (!exists) return;
    profile.resumeTemplateId = templateId;
    await persistProfile();
    renderResumeTemplateSelector();
    renderTemplateLibraryUI();
  }

  function showTemplateStatus(message, type = "success") {
    const el = $("#template-save-status");
    if (!el) return;
    el.textContent = message;
    el.className = `save-status ${type}`;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 2500);
  }

  async function addCustomTemplate() {
    const name = $("#tmpl-name").value.trim();
    const description = $("#tmpl-description").value.trim();
    const content = $("#tmpl-content").value.trim();

    if (!name) {
      showTemplateStatus("Template name is required.", "error");
      return;
    }
    if (!content) {
      showTemplateStatus("Template content is required.", "error");
      return;
    }

    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    customResumeTemplates.unshift({
      id,
      name,
      description,
      content,
      source: "custom",
      createdAt: new Date().toISOString(),
    });
    await saveCustomResumeTemplates();
    await selectResumeTemplate(id);
    $("#tmpl-name").value = "";
    $("#tmpl-description").value = "";
    $("#tmpl-content").value = "";
    showTemplateStatus("Custom template added.");
  }

  async function removeCustomTemplate(templateId) {
    const target = customResumeTemplates.find((t) => t.id === templateId);
    if (!target) return;
    customResumeTemplates = customResumeTemplates.filter((t) => t.id !== templateId);
    await saveCustomResumeTemplates();
    await ensureSelectedResumeTemplate();
    renderResumeTemplateSelector();
    renderTemplateLibraryUI();
    showTemplateStatus(`Removed "${target.name}".`);
  }

  $("#btn-manage-templates").addEventListener("click", () => navigate("profile"));
  $("#resume-template-select").addEventListener("change", async () => {
    const selectedId = $("#resume-template-select").value;
    await selectResumeTemplate(selectedId);
  });
  $("#btn-add-template").addEventListener("click", addCustomTemplate);
  $("#template-library-list").addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const templateId = target.dataset.id;
    if (!templateId) return;
    if (target.classList.contains("template-delete")) {
      await removeCustomTemplate(templateId);
      return;
    }
    if (target.classList.contains("template-use")) {
      await selectResumeTemplate(templateId);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HOME PAGE
  // ═══════════════════════════════════════════════════════════════════════════

  function refreshHome() {
    $("#stat-jobs").textContent = savedJobs.length;
    $("#stat-resumes").textContent = savedDocs.filter((d) => d.type === "resume").length;
    $("#stat-covers").textContent = savedDocs.filter((d) => d.type === "cover").length;

    // Recent activity — combine jobs + docs, sort by date, show last 8
    const activities = [
      ...savedJobs.map((j) => ({ type: "extract", text: `Extracted: ${j.title} @ ${j.company}`, time: j.extractedAt })),
      ...savedDocs.map((d) => ({ type: "generate", text: `Generated ${d.type}: ${d.title} @ ${d.company}`, time: d.createdAt })),
    ]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 8);

    const container = $("#recent-activity");
    if (activities.length === 0) {
      container.innerHTML = '<p class="empty-hint">No activity yet. Extract your first job posting to get started!</p>';
      return;
    }
    container.innerHTML = activities
      .map((a) => `
        <div class="activity-item">
          <div class="activity-dot ${a.type}"></div>
          <span>${escHtml(a.text)}</span>
          <span class="activity-time">${timeAgo(a.time)}</span>
        </div>`)
      .join("");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTRACTION & JOB DISPLAY
  // ═══════════════════════════════════════════════════════════════════════════

  function normalizeJobData(data = {}) {
    const normalized = { ...data };
    const url = normalized.pageUrl || normalized.applyUrl || "";
    if (url) {
      normalized.pageUrl = url;
      normalized.applyUrl = normalized.applyUrl || url;
    }
    normalized.extractedAt = normalized.extractedAt || new Date().toISOString();
    return normalized;
  }

  function displayJobData(data) {
    const normalized = normalizeJobData(data);
    currentJobData = normalized;
    $("#no-job").classList.add("hidden");
    $("#job-details").classList.remove("hidden");
    $("#job-title").textContent = normalized.title || "Untitled Position";
    $("#job-company").textContent = normalized.company || "Unknown Company";
    $("#job-location").textContent = normalized.location || "Location not specified";
    $("#job-type").textContent = normalized.employmentType || "";

    const sal = $("#job-salary");
    if (normalized.salary) { sal.textContent = normalized.salary; sal.classList.remove("hidden"); } else sal.classList.add("hidden");
    $("#job-remote").classList.toggle("hidden", !normalized.remote);

    // Show source badge
    const srcEl = $("#job-source");
    if (srcEl) {
      if (normalized.source) {
        srcEl.textContent = getSourceLabel(normalized.source);
        srcEl.classList.remove("hidden");
      } else {
        srcEl.classList.add("hidden");
      }
    }

    const desc = normalized.description || "No description available.";
    $("#job-description").textContent = desc;
    $("#job-requirements").textContent = normalized.requirements || "See description.";
    $("#job-benefits").textContent = normalized.benefits || "See description.";
    $("#btn-generate-resume").disabled = false;
    $("#btn-generate-cover").disabled = false;

    // Auto-save the job
    const isNew = saveJobData(normalized);
    setExtractStatus(isNew ? "Job extracted and saved. You can extract the next job now." : "Job already saved. You can extract the next job now.", "success");
  }

  function saveJobData(data) {
    const normalized = normalizeJobData(data);
    const exists = savedJobs.find((j) => j.pageUrl === normalized.pageUrl && j.title === normalized.title);
    if (!exists) {
      const job = { id: genId(), ...normalized };
      savedJobs.unshift(job);
      if (savedJobs.length > 200) savedJobs = savedJobs.slice(0, 200);
      saveJobs();
      addActivity("extract", `Extracted: ${normalized.title} @ ${normalized.company}`);
      refreshHome();
      refreshSavedJobs();
      refreshExtractRecentJobs();
      return true;
    }
    refreshExtractRecentJobs();
    return false;
  }

  function setExtractStatus(text, tone = "") {
    const status = $("#extract-status");
    status.textContent = text;
    status.className = "extract-status";
    if (tone) status.classList.add(tone);
  }

  function setExtractionLoading(isLoading) {
    extractionInFlight = isLoading;
    const extractButtons = ["#btn-extract", "#btn-re-extract", "#btn-extract-next"];
    extractButtons.forEach((sel) => {
      const btn = $(sel);
      if (btn) btn.disabled = isLoading;
    });
    const mainBtn = $("#btn-extract");
    if (!mainBtn) return;
    if (isLoading) {
      mainBtn.dataset.originalText = mainBtn.textContent;
      mainBtn.textContent = "Extracting...";
      setExtractStatus("Reading current job posting...", "");
    } else {
      mainBtn.textContent = mainBtn.dataset.originalText || "Extract Current Job Posting";
    }
  }

  // List of supported job board domains for URL validation
  const SUPPORTED_JOB_DOMAINS = [
    "linkedin.com", "indeed.com", "glassdoor.com", "glassdoor.co",
    "greenhouse.io", "lever.co", "myworkdayjobs.com", "myworkday.com",
    "workday.com", "ziprecruiter.com", "simplyhired.com", "monster.com",
    "careerbuilder.com", "wellfound.com", "angel.co", "builtin.com",
    "dice.com", "remoteok.com", "weworkremotely.com", "flexjobs.com",
  ];

  function isJobBoardUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    // Check known domains
    if (SUPPORTED_JOB_DOMAINS.some((d) => lower.includes(d))) return true;
    // Also allow any URL with job/career keywords
    if (lower.includes("/job") || lower.includes("/career") || lower.includes("/position") || lower.includes("/opening")) return true;
    return false;
  }

  function getSourceLabel(source) {
    const labels = {
      linkedin: "LinkedIn", indeed: "Indeed", glassdoor: "Glassdoor",
      greenhouse: "Greenhouse", lever: "Lever", workday: "Workday",
      ziprecruiter: "ZipRecruiter", simplyhired: "SimplyHired",
      monster: "Monster", careerbuilder: "CareerBuilder",
      wellfound: "Wellfound", builtin: "Built In", dice: "Dice",
      remoteok: "RemoteOK", weworkremotely: "WeWorkRemotely",
      flexjobs: "FlexJobs", generic: "Job Board",
    };
    return labels[source] || source || "Job Board";
  }

  async function extractFromActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      throw new Error("No active tab found. Open a job posting and try again.");
    }

    // Try sending message to existing content script first
    let response;
    try {
      response = await Promise.race([
        new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, { action: "extractJob" }, (payload) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(payload);
          });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
      ]);
    } catch (e) {
      // Content script not injected yet — dynamically inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["js/content.js"],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["css/content.css"],
        });
      } catch (injectErr) {
        throw new Error("Could not access this page. Make sure you're on a job posting and try again.");
      }

      // Wait a moment for the script to initialize, then retry
      await new Promise((r) => setTimeout(r, 500));
      response = await Promise.race([
        new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, { action: "extractJob" }, (payload) => {
            if (chrome.runtime.lastError) {
              reject(new Error("Could not extract from this tab. Refresh the page and try again."));
              return;
            }
            resolve(payload);
          });
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Extraction timed out. Refresh the page and try again.")), 8000)),
      ]);
    }

    if (!response?.success || !response.data) {
      throw new Error("Could not find job details. Open a specific job posting and retry.");
    }
    return response.data;
  }

  async function requestExtraction() {
    if (extractionInFlight) return;
    setExtractionLoading(true);
    try {
      const data = await extractFromActiveTab();
      displayJobData(data);
      navigate("extract");
    } catch (e) {
      setExtractStatus(e.message || "Extraction failed.", "error");
      alert(e.message || "Extraction failed.");
    } finally {
      setExtractionLoading(false);
    }
  }

  $("#btn-extract").addEventListener("click", requestExtraction);
  $("#btn-re-extract").addEventListener("click", requestExtraction);
  $("#btn-extract-next").addEventListener("click", requestExtraction);
  $("#btn-open-saved-jobs").addEventListener("click", () => navigate("saved-jobs"));
  $("#btn-save-for-later").addEventListener("click", () => {
    if (!currentJobData) return;
    saveJobData(currentJobData);
    navigate("saved-jobs");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVED JOBS LIST
  // ═══════════════════════════════════════════════════════════════════════════

  function refreshExtractRecentJobs() {
    const container = $("#extract-recent-list");
    if (!container) return;
    const recentJobs = savedJobs.slice(0, 8);
    if (recentJobs.length === 0) {
      container.innerHTML = '<p class="empty-hint">No extracted jobs yet.</p>';
      return;
    }

    container.innerHTML = recentJobs
      .map((j) => `
        <div class="saved-card">
          <div class="saved-card-title">${escHtml(j.title || "Untitled Position")}</div>
          <div class="saved-card-sub">${escHtml(j.company || "Unknown Company")}${j.source ? " · " + escHtml(getSourceLabel(j.source)) : ""} · ${timeAgo(j.extractedAt)}</div>
          <div class="saved-card-actions">
            <button class="btn btn-sm extract-load" data-id="${j.id}">Load</button>
            <button class="btn btn-sm extract-generate" data-id="${j.id}">Open for Generation</button>
          </div>
        </div>`)
      .join("");

    container.querySelectorAll(".extract-load").forEach((btn) => {
      btn.addEventListener("click", () => {
        const job = savedJobs.find((j) => j.id === btn.dataset.id);
        if (job) displayJobData(job);
      });
    });
    container.querySelectorAll(".extract-generate").forEach((btn) => {
      btn.addEventListener("click", () => {
        const job = savedJobs.find((j) => j.id === btn.dataset.id);
        if (!job) return;
        displayJobData(job);
        navigate("extract");
      });
    });
  }

  function refreshSavedJobs() {
    const container = $("#saved-jobs-list");
    const q = jobsSearchQuery.trim().toLowerCase();
    const filteredJobs = q
      ? savedJobs.filter((j) => {
        const haystack = `${j.title || ""} ${j.company || ""} ${j.location || ""}`.toLowerCase();
        return haystack.includes(q);
      })
      : savedJobs;

    $("#jobs-total-count").textContent = String(savedJobs.length);
    $("#jobs-filter-status").textContent = q
      ? `Showing ${filteredJobs.length} of ${savedJobs.length} jobs`
      : `Showing all ${savedJobs.length} jobs`;

    if (filteredJobs.length === 0) {
      container.innerHTML = `<p class="empty-hint">${q ? "No saved jobs match your search." : "No saved jobs yet."}</p>`;
      return;
    }

    container.innerHTML = filteredJobs
      .map((j) => `
        <div class="saved-card" data-job-id="${j.id}">
          <div class="saved-card-title">${escHtml(j.title)}</div>
          <div class="saved-card-sub">${escHtml(j.company)}${j.location ? " · " + escHtml(j.location) : ""}</div>
          <div class="saved-card-meta">
            ${j.source ? `<span class="meta-tag source">${escHtml(getSourceLabel(j.source))}</span>` : ""}
            ${j.salary ? `<span class="meta-tag salary">${escHtml(j.salary)}</span>` : ""}
            ${j.remote ? '<span class="meta-tag remote">Remote</span>' : ""}
            ${j.employmentType ? `<span class="meta-tag">${escHtml(j.employmentType)}</span>` : ""}
            <span class="meta-tag">${timeAgo(j.extractedAt)}</span>
          </div>
          <div class="saved-card-actions">
            <button class="btn btn-sm btn-primary job-load" data-id="${j.id}">Open Job</button>
            ${j.pageUrl ? `<button class="btn btn-sm job-open-posting" data-url="${escAttr(j.pageUrl)}">Open Posting</button>` : ""}
            <button class="btn btn-sm job-delete" data-id="${j.id}">Delete</button>
          </div>
        </div>`)
      .join("");

    // Bind events
    container.querySelectorAll(".saved-card[data-job-id]").forEach((card) => {
      card.addEventListener("click", () => {
        const job = savedJobs.find((j) => j.id === card.dataset.jobId);
        if (job) { displayJobData(job); navigate("extract"); }
      });
    });
    container.querySelectorAll(".job-load").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const job = savedJobs.find((j) => j.id === btn.dataset.id);
        if (job) { displayJobData(job); navigate("extract"); }
      });
    });
    container.querySelectorAll(".job-open-posting").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        if (!url) return;
        chrome.tabs.create({ url });
      });
    });
    container.querySelectorAll(".job-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        savedJobs = savedJobs.filter((j) => j.id !== btn.dataset.id);
        saveJobs();
        refreshSavedJobs();
        refreshExtractRecentJobs();
        refreshHome();
      });
    });
  }

  $("#btn-clear-jobs").addEventListener("click", () => {
    if (confirm("Delete all saved jobs?")) {
      savedJobs = [];
      saveJobs();
      refreshSavedJobs();
      refreshExtractRecentJobs();
      refreshHome();
    }
  });

  $("#btn-download-jobs-text").addEventListener("click", () => {
    if (savedJobs.length === 0) {
      alert("No saved jobs to download yet.");
      return;
    }
    const content = buildSavedJobsTextExport(savedJobs);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(content, `saved_jobs_${stamp}.txt`, "text/plain;charset=utf-8");
  });

  $("#jobs-search").addEventListener("input", (e) => {
    jobsSearchQuery = e.target.value || "";
    refreshSavedJobs();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SAVED DOCS LIST
  // ═══════════════════════════════════════════════════════════════════════════

  function refreshSavedDocs() {
    const container = $("#saved-docs-list");
    if (savedDocs.length === 0) {
      container.innerHTML = '<p class="empty-hint">No documents generated yet.</p>';
      return;
    }
    container.innerHTML = savedDocs
      .map((d) => `
        <div class="saved-card" data-doc-id="${d.id}">
          <div class="saved-card-title">${d.type === "resume" ? "📄 Resume" : "✉️ Cover Letter"}: ${escHtml(d.title)}</div>
          <div class="saved-card-sub">${escHtml(d.company)} · ${timeAgo(d.createdAt)}</div>
          ${d.type === "resume" && d.templateName ? `<div class="saved-card-sub">Template: ${escHtml(d.templateName)}</div>` : ""}
          <div class="saved-card-actions">
            <button class="btn btn-sm doc-view" data-id="${d.id}">View</button>
            <button class="btn btn-sm doc-dl-md" data-id="${d.id}">↓ MD</button>
            <button class="btn btn-sm doc-dl-tex" data-id="${d.id}">↓ LaTeX</button>
            <button class="btn btn-sm btn-overleaf doc-overleaf" data-id="${d.id}">↗ Overleaf</button>
            <button class="btn btn-sm doc-delete" data-id="${d.id}">Delete</button>
          </div>
        </div>`)
      .join("");

    // Bind
    container.querySelectorAll(".doc-view").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const doc = savedDocs.find((d) => d.id === btn.dataset.id);
        if (!doc) return;
        if (doc.type === "resume") {
          currentResumeMarkdown = doc.markdown;
          currentResumeLatex = sanitizeLatex(doc.latex || "");
          $("#resume-text").innerHTML = markdownToHtml(doc.markdown);
          $("#resume-empty").classList.add("hidden");
          $("#resume-loading").classList.add("hidden");
          $("#resume-content").classList.remove("hidden");
          navigate("resume");
        } else {
          currentCoverMarkdown = doc.markdown;
          currentCoverLatex = sanitizeLatex(doc.latex || "");
          $("#cover-text").innerHTML = markdownToHtml(doc.markdown);
          $("#cover-empty").classList.add("hidden");
          $("#cover-loading").classList.add("hidden");
          $("#cover-content").classList.remove("hidden");
          navigate("cover");
        }
      });
    });
    container.querySelectorAll(".doc-dl-md").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const doc = savedDocs.find((d) => d.id === btn.dataset.id);
        if (doc) downloadFile(doc.markdown, `${doc.type}_${doc.company}_${doc.title}.md`.replace(/\s+/g, "_"));
      });
    });
    container.querySelectorAll(".doc-dl-tex").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const doc = savedDocs.find((d) => d.id === btn.dataset.id);
        if (doc?.latex) downloadFile(sanitizeLatex(doc.latex), `${doc.type}_${doc.company}_${doc.title}.tex`.replace(/\s+/g, "_"), "application/x-tex");
        else alert("No LaTeX version available for this document.");
      });
    });
	    container.querySelectorAll(".doc-overleaf").forEach((btn) => {
	      btn.addEventListener("click", (e) => {
	        e.stopPropagation();
	        const doc = savedDocs.find((d) => d.id === btn.dataset.id);
	        if (doc?.latex) openInOverleaf(sanitizeLatex(doc.latex), buildOverleafFilename(doc.type, doc.company, doc.title));
	        else alert("No LaTeX version available for this document.");
	      });
	    });
    container.querySelectorAll(".doc-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        savedDocs = savedDocs.filter((d) => d.id !== btn.dataset.id);
        saveDocs();
        refreshSavedDocs();
        refreshHome();
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AI GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  function extractOpenAIText(payload) {
    if (!payload) return "";
    if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
    const output = Array.isArray(payload.output) ? payload.output : [];
    const parts = [];
    output.forEach((item) => {
      const content = Array.isArray(item?.content) ? item.content : [];
      content.forEach((c) => {
        if (typeof c?.text === "string") parts.push(c.text);
      });
    });
    return parts.join("\n").trim();
  }

  async function callOpenAIAPI(prompt) {
    const apiKey = profile.openaikey || profile.apikey;
    if (!apiKey) throw new Error("No OpenAI API key. Add it in Profile.");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt,
        max_output_tokens: 4096,
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      let apiMessage = err;
      try {
        const parsed = JSON.parse(err);
        apiMessage = parsed?.error?.message || err;
      } catch (_) {
        // keep raw text fallback
      }

      if (response.status === 401) throw new Error("Invalid OpenAI API key.");
      if (/insufficient_quota|quota|billing|credit balance|rate limit reached for requests|exceeded your current quota/i.test(apiMessage)) {
        throw new Error("OpenAI credits/quota are insufficient. Add billing credits or upgrade your OpenAI plan, then retry.");
      }
      if (response.status === 429) {
        throw new Error("OpenAI rate limit reached. Wait a minute and retry.");
      }
      throw new Error(`API error (${response.status}): ${apiMessage}`);
    }
    const data = await response.json();
    const text = extractOpenAIText(data);
    if (!text) throw new Error("OpenAI returned an empty response.");
    return text;
  }

  async function callAnthropicAPI(prompt) {
    const apiKey = profile.anthropickey;
    if (!apiKey) throw new Error("No Anthropic API key. Add it in Profile.");
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-opus-4-1-20250805",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      let apiMessage = err;
      try {
        const parsed = JSON.parse(err);
        apiMessage = parsed?.error?.message || err;
      } catch (_) {
        // keep raw text fallback
      }
      if (response.status === 401) throw new Error("Invalid Anthropic API key.");
      if (/credit balance is too low|upgrade or purchase credits|insufficient|quota|billing/i.test(apiMessage)) {
        throw new Error("Anthropic credits/quota are insufficient. Add credits or upgrade plan, then retry.");
      }
      if (response.status === 429) throw new Error("Anthropic rate limit reached. Wait and retry.");
      throw new Error(`API error (${response.status}): ${apiMessage}`);
    }

    const data = await response.json();
    const text = (data?.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("Anthropic returned an empty response.");
    return text;
  }

	  function selectedProvider() {
	    const fromGenerateUI = $("#gen-provider")?.value;
	    if (fromGenerateUI === "anthropic" || fromGenerateUI === "openai") return fromGenerateUI;
	    return profile.provider === "anthropic" ? "anthropic" : "openai";
	  }

  function hasProviderApiKey() {
    const provider = selectedProvider();
    if (provider === "anthropic") return !!profile.anthropickey;
    return !!(profile.openaikey || profile.apikey);
  }

	  async function callLLMAPI(prompt) {
	    return selectedProvider() === "anthropic"
	      ? callAnthropicAPI(prompt)
	      : callOpenAIAPI(prompt);
	  }

  function hasPlaceholderToken(text) {
    return /\[PLACEHOLDER\]/i.test(text || "");
  }

  async function fillPlaceholdersWithClaude(content, formatLabel) {
    if (!hasPlaceholderToken(content)) return content;
    return callAnthropicAPI(
      `Rewrite this ${formatLabel} content by replacing every [PLACEHOLDER] token with specific, concrete values.
Rules:
- Preserve all existing structure and formatting.
- Do not leave any [PLACEHOLDER] token in the output.
- Return only the rewritten ${formatLabel}.

${content}`
    );
  }

	  async function generateResume() {
	    navigate("resume");
	    $("#resume-empty").classList.add("hidden");
	    $("#resume-content").classList.add("hidden");
	    $("#resume-loading").classList.remove("hidden");
	    try {
      if (!profile.anthropickey) throw new Error("Resume generation requires an Anthropic API key. Add it in Profile.");
	      const selectedTemplate = getSelectedResumeTemplate();
	      let md = await callAnthropicAPI(buildResumePrompt(currentJobData, profile, selectedTemplate));
      md = await fillPlaceholdersWithClaude(md, "markdown");
	      currentResumeMarkdown = md;
	      // Generate LaTeX version
	      let latex = await callAnthropicAPI(buildLatexResumePrompt(currentJobData, profile, md));
      latex = await fillPlaceholdersWithClaude(latex, "LaTeX");
      currentResumeLatex = sanitizeLatex(latex);
	      $("#resume-text").innerHTML = markdownToHtml(md);
	      $("#resume-loading").classList.add("hidden");
	      $("#resume-content").classList.remove("hidden");
	      // Save
      const doc = {
        id: genId(), jobId: currentJobData?.pageUrl || "", type: "resume",
        markdown: md, latex: currentResumeLatex,
        company: currentJobData?.company || "", title: currentJobData?.title || "",
        templateId: selectedTemplate?.id || "",
        templateName: selectedTemplate?.name || "",
        createdAt: new Date().toISOString(),
      };
      savedDocs.unshift(doc);
      if (savedDocs.length > 200) savedDocs = savedDocs.slice(0, 200);
      await saveDocs();
      addActivity("generate", `Generated resume: ${doc.title} @ ${doc.company}`);
      refreshHome();
      refreshSavedDocs();
    } catch (err) {
      $("#resume-loading").classList.add("hidden");
      $("#resume-empty").classList.remove("hidden");
      $("#resume-empty").querySelector("h3").textContent = "Generation failed";
      $("#resume-empty").querySelector("p").textContent = err.message;
    }
  }

  async function generateCoverLetter() {
    navigate("cover");
    $("#cover-empty").classList.add("hidden");
    $("#cover-content").classList.add("hidden");
    $("#cover-loading").classList.remove("hidden");
    try {
      const md = await callLLMAPI(buildCoverLetterPrompt(currentJobData, profile));
      currentCoverMarkdown = md;
      currentCoverLatex = sanitizeLatex(await callLLMAPI(buildLatexCoverPrompt(currentJobData, profile, md)));
      $("#cover-text").innerHTML = markdownToHtml(md);
      $("#cover-loading").classList.add("hidden");
      $("#cover-content").classList.remove("hidden");
      const doc = {
        id: genId(), jobId: currentJobData?.pageUrl || "", type: "cover",
        markdown: md, latex: currentCoverLatex,
        company: currentJobData?.company || "", title: currentJobData?.title || "",
        createdAt: new Date().toISOString(),
      };
      savedDocs.unshift(doc);
      if (savedDocs.length > 200) savedDocs = savedDocs.slice(0, 200);
      await saveDocs();
      addActivity("generate", `Generated cover letter: ${doc.title} @ ${doc.company}`);
      refreshHome();
      refreshSavedDocs();
    } catch (err) {
      $("#cover-loading").classList.add("hidden");
      $("#cover-empty").classList.remove("hidden");
      $("#cover-empty").querySelector("h3").textContent = "Generation failed";
      $("#cover-empty").querySelector("p").textContent = err.message;
    }
  }

  function canGenerateForCurrentJob(docType = "resume") {
	    if (!currentJobData) return false;
	    if (!getSelectedResumeTemplate()) {
	      alert("No resume base template available. Add one in Profile.");
	      navigate("profile");
	      return false;
	    }
    if (docType === "resume" && !profile.anthropickey) {
      alert("Add your Anthropic API key in Profile. Resume generation always uses Anthropic Claude.");
      navigate("profile");
      return false;
    }
	    if (docType !== "resume" && !hasProviderApiKey()) {
	      const providerLabel = selectedProvider() === "anthropic" ? "Anthropic" : "OpenAI";
	      alert(`Add your ${providerLabel} API key in Profile.`);
	      navigate("profile");
	      return false;
	    }
    if (!profile.experience && !profile.expertise) { alert("Fill in your work experience in Profile."); navigate("profile"); return false; }
    return true;
  }

	  $("#btn-generate-resume").addEventListener("click", async () => {
	    if (!canGenerateForCurrentJob("resume")) return;
	    await generateResume();
	  });

  $("#btn-generate-cover").addEventListener("click", async () => {
    if (!canGenerateForCurrentJob("cover")) return;
    await generateCoverLetter();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMPTS
  // ═══════════════════════════════════════════════════════════════════════════

	  function buildResumePrompt(job, prof, selectedTemplate) {
    const templateName = selectedTemplate?.name || "General";
    const templateDescription = inferTemplateDescription(selectedTemplate || {});
    const templateContent = selectedTemplate?.content || "";
    return `You are an expert resume writer. Create a TAILORED resume for the candidate below, optimized for this specific job.

## TAILORING PHILOSOPHY
Every resume is a tailored sales document. Apply these 5 layers:
1. Role Identity Reframing — Retitle positions to match the target role's function (use em dash for qualifiers)
2. Summary Rewriting — 3-4 sentences: identity+tenure+companies, domain depth, proof, optional differentiator
3. Bullet Point Rewriting — Same facts reframed for this role. XYZ formula: Accomplished [X] as measured by [Y], by doing [Z]
4. GenAI Bullet — "Deploy Generative AI tools to [action], [action], and [action]" tailored to function
5. Section Customization — Additional section matches target domain

## WRITING RULES
- Strong action verbs only (never "Responsible for")
- Quantify: revenue, %, team size, stakeholders, geographic scope, transactions
- 5 bullets current role, 3-5 previous, 1-2 oldest
- No personal pronouns. Present tense current role, past for previous
- Mirror the JD's exact terminology
- Standard headings: Summary, Experience, Education, Additional
- Target 1 page
- Never output [PLACEHOLDER]. If details are uncertain, infer the best concrete value from context and keep it realistic.
- In Additional, include this exact publications text: ${FIXED_PUBLICATIONS_TEXT}

## JOB POSTING
**Title:** ${job.title}
**Company:** ${job.company}
**Location:** ${job.location || "N/A"}
**Type:** ${job.employmentType || "N/A"}
**Salary:** ${job.salary || "N/A"}
**Remote:** ${job.remote ? "Yes" : "No"}

**Description:**
${(job.description || "").slice(0, 12000)}

${job.requirements ? `**Requirements:**\n${job.requirements.slice(0, 5000)}` : ""}

## CANDIDATE
**Name:** ${prof.name || "[NAME]"} | **Email:** ${prof.email || "[EMAIL]"} | **Phone:** ${prof.phone || "[PHONE]"} | **LinkedIn:** ${prof.linkedin || "[LINKEDIN]"} | **Location:** ${prof.location || "[LOCATION]"}
**Title:** ${prof.title || "[TITLE]"} | **Years:** ${prof.years || "[YEARS]"} | **Expertise:** ${prof.expertise || "[EXPERTISE]"} | **Companies:** ${prof.companies || "[COMPANIES]"}

**Experience:**
${prof.experience || "[No experience provided]"}

**Education:** ${prof.education || "[EDUCATION]"}
**Additional:** ${prof.additional || ""}

## BASE RESUME TEMPLATE
**Type:** ${templateName}
**Template Intent:** ${templateDescription}
Use this as a structural and stylistic baseline, then tailor aggressively to the target job.

${templateContent ? `**Base Template Source (LaTeX):**\n${templateContent.slice(0, 18000)}\n` : ""}

## OUTPUT
Generate a complete resume in clean markdown with: Header (name centered, contact on one line), SUMMARY, EXPERIENCE (reverse chron, retitled, bullets with •), EDUCATION, ADDITIONAL.
Do not include [PLACEHOLDER] anywhere.
In ADDITIONAL, always include this Publications line exactly:
${FIXED_PUBLICATIONS_TEXT}`;
	  }

  function buildCoverLetterPrompt(job, prof) {
    return `Write a compelling, tailored cover letter.

## PRINCIPLES
- Hook opening with specific connection to company/role
- Body tells a STORY connecting accomplishments to role needs
- Mirror JD language. Quantify achievements. Confident but not arrogant.
- 3-4 paragraphs, one page. Modern format (no addresses).

## JOB
**Title:** ${job.title} | **Company:** ${job.company} | **Location:** ${job.location || "N/A"}
**Description:**
${(job.description || "").slice(0, 10000)}

## CANDIDATE
**Name:** ${prof.name || "[NAME]"} | **Title:** ${prof.title || "[TITLE]"} | **Years:** ${prof.years || ""}
**Expertise:** ${prof.expertise || ""} | **Companies:** ${prof.companies || ""}
**Experience:**
${prof.experience || "[No experience provided]"}
**Education:** ${prof.education || ""}

## OUTPUT
Date, "Dear Hiring Manager,", 3-4 paragraphs, professional closing with name.`;
  }

	  function buildLatexResumePrompt(job, prof, markdownResume) {
	    const firstName = FIXED_LATEX_IDENTITY.firstName;
	    const lastName = FIXED_LATEX_IDENTITY.lastName;
	    const linkedInHandle = FIXED_LATEX_IDENTITY.homepage;

    return `Convert this resume into a LaTeX file using the moderncv banking style. Follow this EXACT template structure:

${EXACT_MODERNCV_PREAMBLE}

\\firstname{${escLatex(firstName)}}
\\familyname{${escLatex(lastName)}}
\\mobile{${escLatex(FIXED_LATEX_IDENTITY.mobile)}}
\\email{${escLatex(FIXED_LATEX_IDENTITY.email)}}
\\homepage{${escLatex(linkedInHandle)}}

\\begin{document}

\\makecvtitle
\\vspace{-45pt}

\\section{\\textsc{Summary}}
\\vspace{-7pt}
[summary paragraph]

\\vspace{-7pt}
\\section{\\textsc{Experience}}

\\begin{itemize}
\\item[]{\\cventry{[dates]}{[role title]}{[company]}{[location]}{}{}{
\\vspace{1pt}
\\begin{itemize}
\\item[\\textbullet] [bullet]
\\end{itemize} }}
\\end{itemize}

\\vspace{-8pt}
\\section{\\textsc{Education}}
\\vspace{-3pt}
\\begin{itemize}
\\item[]{\\cventry{[graduation]}{[degree]}{[school]}{[location]}{}{}}
\\end{itemize}
\\vspace{-12pt}

\\section{\\textsc{Additional}}
\\vspace{-3pt}
\\begin{itemize}
${FIXED_PUBLICATIONS_BULLET_LATEX}
\\end{itemize}

\\end{document}

## RESUME CONTENT TO CONVERT:
${markdownResume}

## CRITICAL OUTPUT RULES
- Output ONLY raw LaTeX source (no markdown fences, no explanation text)
- Keep the EXACT preamble package set and ordering shown above
- Keep the EXACT section names/order/spacing commands shown above
- Use \\vspace values exactly as shown above
- Do NOT add any extra \\vspace commands beyond those shown above
- Do NOT add any extra sections or rename section titles
- Keep experience entries in \\cventry blocks with inner \\begin{itemize} bullets
- For progressive roles in same company, leave company/location empty on sub-roles
- Use ASCII-safe LaTeX (no unicode bullets/quotes/dashes)
- Escape LaTeX special characters in plain text (&, $, %, #, _, {, }, ~, ^, \\)
- Do not include [PLACEHOLDER] anywhere in the LaTeX output
- Set the Additional section to exactly this bullet:
  ${FIXED_PUBLICATIONS_BULLET_LATEX}

Output ONLY the complete .tex file.`;
  }

  function buildLatexCoverPrompt(job, prof, markdownCover) {
    return `Convert this cover letter into a clean LaTeX file. Use a simple, professional format:

${EXACT_MODERNCV_PREAMBLE}
\\firstname{${escLatex(FIXED_LATEX_IDENTITY.firstName)}}
\\familyname{${escLatex(FIXED_LATEX_IDENTITY.lastName)}}
\\mobile{${escLatex(FIXED_LATEX_IDENTITY.mobile)}}
\\email{${escLatex(FIXED_LATEX_IDENTITY.email)}}
\\homepage{${escLatex(FIXED_LATEX_IDENTITY.homepage)}}
\\begin{document}
\\makecvtitle
\\vspace{-45pt}
\\section{\\textsc{Cover Letter}}
\\vspace{-7pt}

## COVER LETTER CONTENT:
${markdownCover}

## CRITICAL OUTPUT RULES
- Output ONLY raw LaTeX source (no markdown fences, no explanation text)
- Include a full compilable file with \\begin{document} and \\end{document}
- Use the EXACT preamble shown above
- Use ASCII-safe LaTeX where possible (avoid unicode bullets/quotes/dashes)
- Escape LaTeX special characters in plain text (&, $, %, #, _, {, }, ~, ^, \\)

Output ONLY the complete .tex file.`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOOLBAR BUTTONS (Resume & Cover Letter views)
  // ═══════════════════════════════════════════════════════════════════════════

  // Copy
  $("#btn-copy-resume").addEventListener("click", () => copyBtn(currentResumeMarkdown, $("#btn-copy-resume")));
  $("#btn-copy-cover").addEventListener("click", () => copyBtn(currentCoverMarkdown, $("#btn-copy-cover")));

  // Download MD
  $("#btn-dl-resume-md").addEventListener("click", () => {
    const fn = `Resume_${(currentJobData?.company || "Co").replace(/\s+/g, "_")}_${(currentJobData?.title || "Role").replace(/\s+/g, "_").slice(0, 25)}.md`;
    downloadFile(currentResumeMarkdown, fn);
  });
  $("#btn-dl-cover-md").addEventListener("click", () => {
    const fn = `CoverLetter_${(currentJobData?.company || "Co").replace(/\s+/g, "_")}_${(currentJobData?.title || "Role").replace(/\s+/g, "_").slice(0, 25)}.md`;
    downloadFile(currentCoverMarkdown, fn);
  });

  // Download LaTeX
  $("#btn-dl-resume-tex").addEventListener("click", () => {
    if (!currentResumeLatex) { alert("No LaTeX version. Generate a resume first."); return; }
    const fn = `Resume_${(currentJobData?.company || "Co").replace(/\s+/g, "_")}.tex`;
    downloadFile(sanitizeLatex(currentResumeLatex), fn, "application/x-tex");
  });
  $("#btn-dl-cover-tex").addEventListener("click", () => {
    if (!currentCoverLatex) { alert("No LaTeX version. Generate a cover letter first."); return; }
    const fn = `CoverLetter_${(currentJobData?.company || "Co").replace(/\s+/g, "_")}.tex`;
    downloadFile(sanitizeLatex(currentCoverLatex), fn, "application/x-tex");
  });

  // Overleaf
  $("#btn-overleaf-resume").addEventListener("click", () => {
    if (!currentResumeLatex) { alert("No LaTeX version available."); return; }
    openInOverleaf(sanitizeLatex(currentResumeLatex), buildOverleafFilename("resume", currentJobData?.company, currentJobData?.title));
  });
  $("#btn-overleaf-cover").addEventListener("click", () => {
    if (!currentCoverLatex) { alert("No LaTeX version available."); return; }
    openInOverleaf(sanitizeLatex(currentCoverLatex), buildOverleafFilename("cover", currentJobData?.company, currentJobData?.title));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // OVERLEAF INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════

  function buildOverleafFilename(docType, company, title) {
    const clean = (value) => (value || "").toString().trim().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");
    const safeCompany = clean(company) || "Co";
    const safeTitle = clean(title) || "Role";
    if (docType === "resume") return `Resume_${safeCompany}_${safeTitle}.tex`;
    if (docType === "cover") return `CoverLetter_${safeCompany}_${safeTitle}.tex`;
    return `${clean(docType) || "Document"}_${safeCompany}_${safeTitle}.tex`;
  }

  function openInOverleaf(latexContent, filename) {
    // Overleaf supports opening projects via POST form to /docs
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "https://www.overleaf.com/docs";
    form.target = "_blank";

    const snipInput = document.createElement("input");
    snipInput.type = "hidden";
    snipInput.name = "snip_uri";
    // Use a data URI with the LaTeX content
    snipInput.value = "data:application/x-tex;base64," + btoa(unescape(encodeURIComponent(latexContent)));
    form.appendChild(snipInput);

    const nameInput = document.createElement("input");
    nameInput.type = "hidden";
    nameInput.name = "snip_name";
    nameInput.value = filename;
    form.appendChild(nameInput);

    // Engine
    const engineInput = document.createElement("input");
    engineInput.type = "hidden";
    engineInput.name = "engine";
    engineInput.value = "pdflatex";
    form.appendChild(engineInput);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GOOGLE DRIVE INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════

  function getOauthClientId() {
    return chrome.runtime.getManifest()?.oauth2?.client_id || "";
  }

  function hasConfiguredGoogleOAuth() {
    const clientId = getOauthClientId();
    return !!clientId && !clientId.includes("REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID");
  }

  function buildDriveFilesSearchUrl(q, fields = "files(id,name)") {
    const params = new URLSearchParams({ q, fields });
    return `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
  }

  function updateGdriveUI() {
    const connected = !!gdriveToken;
    $(".status-dot").className = `status-dot ${connected ? "connected" : "disconnected"}`;
    $(".status-dot").nextElementSibling.textContent = connected ? "Connected" : "Not connected";
    $("#btn-gdrive-connect").classList.toggle("hidden", connected);
    $("#btn-gdrive-disconnect").classList.toggle("hidden", !connected);
    $("#gdrive-sync-status").classList.toggle("hidden", !connected);
  }

  $("#btn-gdrive-connect").addEventListener("click", async () => {
    if (!hasConfiguredGoogleOAuth()) {
      alert("Google Drive is not configured yet.\n\nSet oauth2.client_id in manifest.json to your real Google OAuth Client ID (Chrome Extension type), then reload the extension.");
      return;
    }

    try {
      const token = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(token);
        });
      });
      if (!token) {
        throw new Error("No auth token returned. Check your OAuth client ID and extension ID in Google Cloud.");
      }
      gdriveToken = token;
      await chrome.storage.local.set({ gdriveToken: token });
      // Find or create folder
      gdriveFolderId = await getOrCreateDriveFolder();
      await chrome.storage.local.set({ gdriveFolderId });
      updateGdriveUI();
    } catch (err) {
      alert("Google Drive connection failed: " + err.message + "\n\nMake sure you've set up your Google Cloud OAuth client ID in manifest.json.");
    }
  });

  $("#btn-gdrive-disconnect").addEventListener("click", async () => {
    if (gdriveToken) {
      chrome.identity.removeCachedAuthToken({ token: gdriveToken }, () => {});
    }
    gdriveToken = null;
    gdriveFolderId = null;
    await chrome.storage.local.remove(["gdriveToken", "gdriveFolderId"]);
    updateGdriveUI();
  });

  async function gdriveApiFetch(url, options = {}) {
    if (!gdriveToken) throw new Error("Not connected to Google Drive");
    const resp = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${gdriveToken}`, ...options.headers },
    });
    if (resp.status === 401) {
      // Token expired — try to refresh
      gdriveToken = null;
      await chrome.storage.local.remove(["gdriveToken"]);
      updateGdriveUI();
      throw new Error("Google Drive session expired. Please reconnect.");
    }
    return resp;
  }

  async function getOrCreateDriveFolder() {
    const folderName = "Job Apps - Chrome Extension";
    // Search for existing folder
    const searchUrl = buildDriveFilesSearchUrl(
      `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const resp = await gdriveApiFetch(searchUrl);
    const data = await resp.json();
    if (data.files && data.files.length > 0) return data.files[0].id;

    // Create folder
    const createResp = await gdriveApiFetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }),
    });
    const folder = await createResp.json();
    return folder.id;
  }

  async function uploadToDrive(filename, content, mimeType = "text/plain", subfolder = null) {
    let parentId = gdriveFolderId;
    if (subfolder) {
      parentId = await getOrCreateSubfolder(subfolder);
    }

    const metadata = { name: filename, parents: [parentId] };
    const boundary = "---hcext" + Date.now();
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;

    await gdriveApiFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  async function getOrCreateSubfolder(name) {
    const searchUrl = buildDriveFilesSearchUrl(
      `name='${name.replace(/'/g, "\\'")}' and '${gdriveFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      "files(id)"
    );
    const resp = await gdriveApiFetch(searchUrl);
    const data = await resp.json();
    if (data.files?.length > 0) return data.files[0].id;

    const createResp = await gdriveApiFetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [gdriveFolderId] }),
    });
    return (await createResp.json()).id;
  }

  // Sync all
  $("#btn-gdrive-sync-all").addEventListener("click", syncAllToDrive);
  $("#btn-sync-jobs-gdrive").addEventListener("click", syncAllToDrive);
  $("#btn-sync-docs-gdrive").addEventListener("click", syncAllToDrive);

  async function syncAllToDrive() {
    if (!gdriveToken || !gdriveFolderId) {
      alert("Connect to Google Drive first.");
      navigate("gdrive");
      return;
    }

    const syncBtn = $("#btn-gdrive-sync-all");
    const origText = syncBtn.innerHTML;
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Syncing...';

    try {
      // Sync saved jobs as JSON
      if (savedJobs.length > 0) {
        const jobsJson = JSON.stringify(savedJobs, null, 2);
        await uploadToDrive("saved_jobs.json", jobsJson, "application/json", "Job Extractions");
        // Also save individual job summaries as readable text
        for (const job of savedJobs.slice(0, 50)) {
          const txt = `${job.title}\n${job.company}\n${job.location || ""}\n${job.salary || ""}\n${job.employmentType || ""}\n\n${job.description || ""}`;
          const fn = `${(job.company || "Co").replace(/[^\w]/g, "_")}_${(job.title || "Role").replace(/[^\w]/g, "_").slice(0, 40)}.txt`;
          await uploadToDrive(fn, txt, "text/plain", "Job Extractions");
        }
      }

      // Sync docs
      for (const doc of savedDocs.slice(0, 100)) {
        const subfolder = doc.type === "resume" ? "Resumes" : "Cover Letters";
        const base = `${(doc.company || "Co").replace(/[^\w]/g, "_")}_${(doc.title || "Role").replace(/[^\w]/g, "_").slice(0, 30)}`;
        // Markdown
        await uploadToDrive(`${base}.md`, doc.markdown, "text/markdown", subfolder);
        // LaTeX
        if (doc.latex) {
          await uploadToDrive(`${base}.tex`, sanitizeLatex(doc.latex), "application/x-tex", subfolder);
        }
      }

      const now = new Date().toLocaleString();
      $("#gdrive-last-sync").textContent = `Last synced: ${now}`;
      syncBtn.innerHTML = "✓ Synced!";
      syncBtn.classList.add("copied");
      addActivity("sync", "Synced all files to Google Drive");
      refreshHome();
      setTimeout(() => { syncBtn.innerHTML = origText; syncBtn.disabled = false; syncBtn.classList.remove("copied"); }, 2000);
    } catch (err) {
      alert("Sync failed: " + err.message);
      syncBtn.innerHTML = origText;
      syncBtn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function escHtml(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escAttr(s) { return escHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  function escLatex(s) { return (s || "").replace(/[&$%#_{}~^\\]/g, (c) => "\\" + c); }

  function normalizeResumeLatexLayout(latex) {
    let out = latex;
    if (!/\\documentclass(?:\[[^\]]*\])?\{moderncv\}/.test(out)) return out;

    // Ensure babel package is present for your template.
    if (!/\\usepackage\[english\]\{babel\}/.test(out)) {
      out = out.replace(/(\\documentclass(?:\[[^\]]*\])?\{moderncv\}\s*)/, "$1\n\\\\usepackage[english]{babel}\n");
    }

    // Force makecvtitle spacing.
    out = out.replace(/\\makecvtitle(?:\s*\\vspace\{[^}]*\})?/g, "\\makecvtitle\n\\vspace{-45pt}");

    // Force section spacing/layout to match template.
    out = out.replace(/\\section\{\\textsc\{Summary\}\}\s*(?:\\vspace\{[^}]*\})?/g, "\\section{\\textsc{Summary}}\n\\vspace{-7pt}");
    out = out.replace(/(?:\\vspace\{[^}]*\}\s*)?\\section\{\\textsc\{Experience\}\}/g, "\\vspace{-7pt}\n\\section{\\textsc{Experience}}");
    out = out.replace(/(?:\\vspace\{[^}]*\}\s*)?\\section\{\\textsc\{Education\}\}\s*(?:\\vspace\{[^}]*\})?/g, "\\vspace{-8pt}\n\\section{\\textsc{Education}}\n\\vspace{-3pt}");
    out = out.replace(/(?:\\vspace\{[^}]*\}\s*)?\\section\{\\textsc\{Additional\}\}\s*(?:\\vspace\{[^}]*\})?/g, "\\vspace{-12pt}\n\\section{\\textsc{Additional}}\n\\vspace{-3pt}");

    return out;
  }

  function extractLatexSectionBody(tex, sectionName) {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const startRe = new RegExp(String.raw`\\section\{\\textsc\{${escaped}\}\}`, "i");
    const startMatch = startRe.exec(tex);
    if (!startMatch) return "";
    const from = startMatch.index + startMatch[0].length;

    const tail = tex.slice(from);
    const endMatch = /\\section\{\\textsc\{[^}]+\}\}|\\end\{document\}/i.exec(tail);
    const body = endMatch ? tail.slice(0, endMatch.index) : tail;
    return body.trim();
  }

  function stripStandaloneVspace(text) {
    return (text || "")
      .replace(/^\s*\\vspace\{[^}]*\}\s*$/gim, "")
      .trim();
  }

  function dedupeConsecutiveVspaces(tex) {
    let out = tex;
    const patterns = ["-7pt", "-3pt", "-8pt", "-12pt"];
    patterns.forEach((val) => {
      const re = new RegExp(String.raw`(?:\s*\\vspace\{${val}\}\s*){2,}`, "g");
      out = out.replace(re, `\n\\vspace{${val}}\n`);
    });
    return out;
  }

  function removeDisallowedExperienceEntries(tex) {
    let out = tex;

    // Remove invented catch-all entries like "Early Career".
    out = out.replace(
      /\\item\[\]\{\s*\\cventry\{[^}]*\}\{[^}]*\}\{[^}]*Early\s*Career[^}]*\}[\s\S]*?\}\s*\}\s*/gi,
      ""
    );
    out = out.replace(
      /\\cventry\{[^}]*\}\{[^}]*\}\{[^}]*Early\s*Career[^}]*\}[\s\S]*?(?=\\item\[\]\{|\\end\{itemize\}|\\section\{|\\end\{document\})/gi,
      ""
    );

    // Remove obvious empty placeholder cventry rows with no date/title/company.
    out = out.replace(
      /\\item\[\]\{\s*\\cventry\{\s*\}\{\s*\}\{\s*\}\{[^}]*\}\{[^}]*\}\{[\s\S]*?\}\s*\}\s*/g,
      ""
    );

    // Clean up any empty itemize blocks left behind.
    out = out.replace(/\\begin\{itemize\}\s*\\end\{itemize\}\s*/g, "");

    return out;
  }

	  function buildStrictResumeTemplateFromLatex(tex) {
    if (!/\\documentclass(?:\[[^\]]*\])?\{moderncv\}/.test(tex)) return tex;

    const firstName = escLatex(FIXED_LATEX_IDENTITY.firstName);
    const lastName = escLatex(FIXED_LATEX_IDENTITY.lastName);
    const mobile = escLatex(FIXED_LATEX_IDENTITY.mobile);
    const email = escLatex(FIXED_LATEX_IDENTITY.email);
    const homepage = escLatex(FIXED_LATEX_IDENTITY.homepage);

    const summaryRaw = extractLatexSectionBody(tex, "Summary");
    const experienceRaw = extractLatexSectionBody(tex, "Experience");
	    const educationRaw = extractLatexSectionBody(tex, "Education");

    const summary = stripStandaloneVspace(summaryRaw)
      .replace(/^\\vspace\{[^}]*\}\s*/i, "")
      .replace(/^\\begin\{itemize\}[\s\S]*?\\end\{itemize\}\s*$/i, "")
      .trim() || escLatex(profile.expertise || "Summary to be added.");

    const experienceBody = stripStandaloneVspace(experienceRaw);
    const experience = experienceBody.includes("\\begin{itemize}")
      ? experienceBody
      : "\\begin{itemize}\n\\item[]{} \n\\end{itemize}";

    const educationBody = stripStandaloneVspace(educationRaw);
    const education = educationBody.includes("\\begin{itemize}")
      ? educationBody
      : "\\begin{itemize}\n\\item[]{\\cventry{[Graduation]}{[Degree]}{[School]}{[Location]}{}{}}\n\\end{itemize}";

	    const additional = FIXED_PUBLICATIONS_ITEMIZE_LATEX;

    return `${EXACT_MODERNCV_PREAMBLE}

\\firstname{${firstName}}
\\familyname{${lastName}}
\\mobile{${mobile}}
\\email{${email}}
\\homepage{${homepage}}

\\begin{document}

\\makecvtitle
\\vspace{-45pt}

\\section{\\textsc{Summary}}
\\vspace{-7pt}
${summary}

\\vspace{-7pt}
\\section{\\textsc{Experience}}

${experience}

\\vspace{-8pt}
\\section{\\textsc{Education}}
\\vspace{-3pt}
${education}
\\vspace{-12pt}

\\section{\\textsc{Additional}}
\\vspace{-3pt}
${additional}

\\end{document}
`;
	  }

  function sanitizeLatex(input) {
    if (!input) return "";
    let out = String(input).trim();

    // Strip markdown code fences anywhere if model wraps or annotates output.
    // Handles cases like "Here is the LaTeX:" followed by fenced blocks.
    out = out
      .replace(/^\s*```(?:latex)?\s*$/gim, "")
      .replace(/```latex/gi, "")
      .replace(/```/g, "")
      .trim();

    // Keep only the TeX document content if wrapper text leaked in.
    const docClassIndex = out.indexOf("\\documentclass");
    if (docClassIndex > 0) out = out.slice(docClassIndex).trim();

    // Remove invisible/control chars that can break compilers.
    out = out.replace(/\uFEFF/g, "").replace(/[\u200B-\u200D\u2060]/g, "");

    // Normalize common Unicode punctuation/symbols to safer LaTeX/text forms.
    const replacements = [
      [/“|”/g, "\""],
      [/‘|’/g, "'"],
      [/—/g, "---"],
      [/–/g, "--"],
      [/•/g, "\\\\textbullet{} "],
      [/…/g, "..."],
      [/\u00A0/g, " "],
    ];
    replacements.forEach(([pattern, value]) => { out = out.replace(pattern, value); });

    const hasModerncvDocClass = /(^|[\r\n])\s*\\documentclass(?:\[[^\]]*\])?\{moderncv\}/m.test(out);
    const hasRealBeginDoc = /(^|[\r\n])\s*\\begin\s*\{\s*document\s*\}/m.test(out);
    const hasRealEndDoc = /(^|[\r\n])\s*\\end\s*\{\s*document\s*\}/m.test(out);

    // Force your exact preamble on all LaTeX outputs.
    if (!hasModerncvDocClass) {
      if (hasRealBeginDoc) {
        const beginIdx = out.search(/(^|[\r\n])\s*\\begin\s*\{\s*document\s*\}/m);
        const body = beginIdx >= 0 ? out.slice(beginIdx).trimStart() : out;
        out = `${EXACT_MODERNCV_PREAMBLE}\n\n${body}`;
      } else {
        out = `${EXACT_MODERNCV_PREAMBLE}\n\n${out}`;
      }
    } else {
      // Replace whatever moderncv preamble the model produced with your exact one.
      out = out.replace(/\\documentclass[\s\S]*?\\usepackage\{import\}/, EXACT_MODERNCV_PREAMBLE);
    }

    // Ensure document wrapper exists for compilable output.
    if (!hasRealBeginDoc) {
      const bodyStart = out.search(
        /\\makecvtitle|\\section\{|\\begin\{letter\}|\\opening\{|\\closing\{|\\begin\{itemize\}|\\cventry|\\item(?:\[| )/
      );
      if (bodyStart > -1) {
        out = `${out.slice(0, bodyStart).trimEnd()}\n\n\\begin{document}\n${out.slice(bodyStart).trimStart()}`;
      } else {
        out = `${out}\n\n\\begin{document}\n`;
      }
    }
    if (!hasRealEndDoc) {
      out = `${out}\n\\end{document}\n`;
    }
    out = out.replace(/(\\end\s*\{\s*document\s*\})[\s\S]*$/, "\\end{document}\n");
    out = normalizeResumeLatexLayout(out);
    out = buildStrictResumeTemplateFromLatex(out);
    out = dedupeConsecutiveVspaces(out);
    out = removeDisallowedExperienceEntries(out);

    return out;
  }

  function timeAgo(dateStr) {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  function markdownToHtml(md) {
    if (!md) return "";
    return md
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^---$/gm, "<hr>")
      .replace(/^[•\-\*]\s+(.+)$/gm, "<li>$1</li>")
      .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
      .replace(/\n\n/g, "<br><br>")
      .replace(/\n/g, "<br>");
  }

  function copyBtn(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = orig; btn.classList.remove("copied"); }, 1500);
    });
  }

  function downloadFile(content, filename, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function buildSavedJobsTextExport(jobs) {
    const lines = [
      "LinkedIn Resume Tailor - Saved Jobs Export",
      `Exported: ${new Date().toLocaleString()}`,
      `Total jobs: ${jobs.length}`,
      "",
    ];

    jobs.forEach((job, i) => {
      lines.push(`========== Job ${i + 1} of ${jobs.length} ==========`);
      lines.push(`Title: ${job.title || "N/A"}`);
      lines.push(`Company: ${job.company || "N/A"}`);
      lines.push(`Location: ${job.location || "N/A"}`);
      lines.push(`Employment Type: ${job.employmentType || "N/A"}`);
      lines.push(`Salary: ${job.salary || "N/A"}`);
      lines.push(`Remote: ${job.remote ? "Yes" : "No"}`);
      lines.push(`Date Posted: ${job.datePosted || "N/A"}`);
      lines.push(`Applicants: ${job.applicants || "N/A"}`);
      lines.push(`Extracted At: ${job.extractedAt ? new Date(job.extractedAt).toLocaleString() : "N/A"}`);
      lines.push(`Job URL: ${job.pageUrl || job.applyUrl || "N/A"}`);
      lines.push("");
      lines.push("Description:");
      lines.push((job.description || "N/A").trim());
      lines.push("");
      lines.push("Requirements:");
      lines.push((job.requirements || "N/A").trim());
      lines.push("");
      lines.push("Benefits:");
      lines.push((job.benefits || "N/A").trim());
      lines.push("");
    });

    return lines.join("\n");
  }

  function addActivity(type, text) {
    // Activity is derived from saved data, no separate storage needed
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE LISTENERS
  // ═══════════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "jobDataExtracted" && msg.data) {
      setExtractionLoading(false);
      displayJobData(msg.data);
      const sourceLabel = getSourceLabel(msg.data.source);
      setExtractStatus(`Job extracted from ${sourceLabel} and saved.`, "success");
      navigate("extract");
    }
  });

  chrome.storage.session.get("pendingJobData", (data) => {
    if (data.pendingJobData?.action === "jobDataExtracted") {
      setExtractionLoading(false);
      displayJobData(data.pendingJobData.data);
      setExtractStatus("Loaded pending extracted job.", "success");
      chrome.storage.session.remove("pendingJobData");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  loadAll().then(async () => {
    await loadBuiltinResumeTemplates();
    await ensureSelectedResumeTemplate();
    loadProfileUI();
    renderResumeTemplateSelector();
    renderTemplateLibraryUI();
    refreshHome();
    refreshSavedJobs();
    refreshExtractRecentJobs();
    refreshSavedDocs();
    updateGdriveUI();
    setExtractStatus("Ready to extract.", "");
    $("#gen-provider").value = profile.provider === "anthropic" ? "anthropic" : "openai";
    $("#btn-generate-resume").disabled = !currentJobData;
    $("#btn-generate-cover").disabled = !currentJobData;

    // If no profile, prompt
    if (!profile.name && !profile.experience) {
      navigate("profile");
    }
  });
})();
