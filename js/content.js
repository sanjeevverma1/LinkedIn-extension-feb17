// content.js — Universal job posting extractor
// Supports: LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, Workday, and generic job pages
(function () {
  "use strict";
  if (window.__jobResumeExtLoaded) return;
  window.__jobResumeExtLoaded = true;

  // ─── Detect which site we're on ───────────────────────────────────────────

  function detectSite() {
    const host = window.location.hostname.toLowerCase();
    const url = window.location.href.toLowerCase();
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("indeed.com")) return "indeed";
    if (host.includes("glassdoor.com") || host.includes("glassdoor.co")) return "glassdoor";
    if (host.includes("greenhouse.io")) return "greenhouse";
    if (host.includes("lever.co")) return "lever";
    if (host.includes("myworkdayjobs.com") || host.includes("myworkday.com") || host.includes("workday.com")) return "workday";
    if (host.includes("ziprecruiter.com")) return "ziprecruiter";
    if (host.includes("simplyhired.com")) return "simplyhired";
    if (host.includes("monster.com")) return "monster";
    if (host.includes("careerbuilder.com")) return "careerbuilder";
    if (host.includes("wellfound.com") || host.includes("angel.co")) return "wellfound";
    if (host.includes("builtin.com")) return "builtin";
    if (host.includes("dice.com")) return "dice";
    if (host.includes("remoteok.com")) return "remoteok";
    if (host.includes("weworkremotely.com")) return "weworkremotely";
    if (host.includes("flexjobs.com")) return "flexjobs";
    if (url.includes("job") || url.includes("career") || url.includes("position") || url.includes("opening")) return "generic";
    return "generic";
  }

  // ─── Shared helpers ───────────────────────────────────────────────────────

  function qpc(partial, root) {
    return root.querySelector(`[class*="${partial}"]`);
  }

  function getText(el) {
    return el ? el.textContent.trim() : "";
  }

  function getMetaContent(name, doc) {
    const el = doc.querySelector(`meta[name="${name}"], meta[property="${name}"], meta[itemprop="${name}"]`);
    return el ? (el.getAttribute("content") || "").trim() : "";
  }

  function emptyResult(source) {
    return {
      title: "", company: "", companyUrl: "", location: "", description: "",
      salary: "", datePosted: "", employmentType: "", remote: false,
      requirements: "", benefits: "", applyUrl: "", seniority: "",
      workplaceType: "", industry: "", jobFunction: "", applicants: "",
      source: source || "generic",
    };
  }

  // ─── JSON-LD extraction (works on many sites) ────────────────────────────

  function extractFromJsonLd(doc) {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        let data = JSON.parse(script.textContent);
        // Handle arrays
        if (Array.isArray(data)) {
          data = data.find((d) => d["@type"] === "JobPosting") || data[0];
        }
        // Handle @graph
        if (data["@graph"]) {
          data = data["@graph"].find((d) => d["@type"] === "JobPosting") || data;
        }
        if (data["@type"] === "JobPosting") {
          const result = emptyResult("jsonld");
          result.title = data.title || "";
          if (data.hiringOrganization) {
            result.company = data.hiringOrganization.name || "";
            result.companyUrl = data.hiringOrganization.sameAs || data.hiringOrganization.url || "";
          }
          if (data.jobLocation) {
            const loc = Array.isArray(data.jobLocation) ? data.jobLocation[0] : data.jobLocation;
            if (loc.address) {
              const addr = loc.address;
              result.location = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
                .filter(Boolean).join(", ");
            } else if (typeof loc === "string") {
              result.location = loc;
            }
          }
          result.description = data.description || "";
          // Strip HTML tags from description
          if (result.description.includes("<")) {
            const div = document.createElement("div");
            div.innerHTML = result.description;
            result.description = div.innerText.trim();
          }
          if (data.baseSalary) {
            const sal = data.baseSalary;
            if (sal.value) {
              const v = sal.value;
              const currency = sal.currency || "USD";
              if (v.minValue && v.maxValue) {
                result.salary = `${currency} ${v.minValue.toLocaleString()} - ${v.maxValue.toLocaleString()} ${v.unitText || ""}`.trim();
              } else if (v.value) {
                result.salary = `${currency} ${v.value.toLocaleString()} ${v.unitText || ""}`.trim();
              }
            }
          }
          result.datePosted = data.datePosted || "";
          result.employmentType = Array.isArray(data.employmentType)
            ? data.employmentType.join(", ")
            : (data.employmentType || "");
          if (data.jobLocationType === "TELECOMMUTE" || data.applicantLocationRequirements) {
            result.remote = true;
            result.workplaceType = "Remote";
          }
          result.industry = data.industry || "";
          return result;
        }
      } catch (e) { /* ignore parse errors */ }
    }
    return null;
  }

  // ─── Section parser (shared) ──────────────────────────────────────────────

  function parseDescriptionSections(text) {
    const sections = { requirements: "", benefits: "" };
    let cur = null;
    const reqPatterns = [
      /\b(requirements?|qualifications?|what you.?ll need|what we.?re looking for|must have|who you are|about you|your background|minimum qualifications|basic qualifications|preferred qualifications|required skills|experience\s*(&|and)\s*skills)\b/i,
    ];
    const benPatterns = [
      /\b(benefits|perks|what we offer|why join|compensation\s*(and|&)\s*benefits|our offer|we provide|total rewards|featured benefits)\b/i,
    ];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (reqPatterns.some((r) => r.test(t))) { cur = "requirements"; continue; }
      if (benPatterns.some((r) => r.test(t))) { cur = "benefits"; continue; }
      if (cur && t) sections[cur] += t + "\n";
    }
    return sections;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SITE-SPECIFIC EXTRACTORS
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── LinkedIn ─────────────────────────────────────────────────────────────

  function getLinkedInDoc() {
    const iframe = document.querySelector('iframe[src*="preload"]');
    if (iframe) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc && iframeDoc.body && iframeDoc.body.innerText.length > 100) {
          return iframeDoc;
        }
      } catch (e) { /* cross-origin */ }
    }
    return document;
  }

  function extractLinkedIn() {
    const doc = getLinkedInDoc();
    const result = emptyResult("linkedin");

    // Title
    const titleEl =
      doc.querySelector("h1.t-24") ||
      doc.querySelector("h1.t-20") ||
      qpc("top-card__job-title", doc) ||
      qpc("topcard__title", doc) ||
      doc.querySelector("h1");
    if (titleEl) result.title = titleEl.textContent.trim();

    // Company
    const companyLink =
      doc.querySelector('.job-details-jobs-unified-top-card__company-name a') ||
      doc.querySelector('.jobs-unified-top-card__company-name a') ||
      qpc("top-card__company-name", doc)?.querySelector("a") ||
      (function () {
        const topCard = qpc("unified-top-card", doc) || qpc("top-card", doc);
        if (topCard) {
          const link = topCard.querySelector('a[href*="/company/"]');
          if (link) return link;
        }
        const links = doc.querySelectorAll('a[href*="/company/"]');
        for (const l of links) {
          const text = l.textContent.trim();
          if (text && text.length < 80 && !text.includes("alumni")) return l;
        }
        return null;
      })();
    if (companyLink) {
      result.company = companyLink.textContent.trim();
      result.companyUrl = companyLink.href || "";
    }

    // Location & meta from primary description container
    const primaryDesc =
      qpc("primary-description-container", doc) ||
      qpc("primary-description", doc);
    if (primaryDesc) {
      const rawText = primaryDesc.textContent.trim();
      const parts = rawText.split("\u00B7").map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 1) result.location = parts[0];
      if (parts.length >= 2) result.datePosted = parts[1];
      if (parts.length >= 3) result.applicants = parts[2];
    }
    if (!result.location) {
      const locEl = qpc("bullet", doc) || qpc("topcard__flavor--bullet", doc);
      if (locEl) result.location = locEl.textContent.trim();
    }

    // Salary & workplace pills
    const prefContainer =
      qpc("fit-level-preferences", doc) ||
      qpc("preferences-and-skills", doc);
    if (prefContainer) {
      const items = prefContainer.querySelectorAll("button, li, span");
      for (const item of items) {
        const t = item.textContent.trim();
        if (t.match(/\$[\d,]+/) || t.match(/salary/i)) result.salary = t;
        else if (t.match(/remote/i)) { result.remote = true; result.workplaceType = t; }
        else if (t.match(/hybrid/i)) result.workplaceType = t;
        else if (t.match(/on-?site/i)) result.workplaceType = t;
        else if (t.match(/full-?time|part-?time|contract|internship/i)) {
          const match = t.match(/(full-?time|part-?time|contract|internship)/i);
          result.employmentType = match ? match[1] : t;
        }
      }
    }
    const insightEls = doc.querySelectorAll('[class*="insight"] span, [class*="workplace-type"]');
    for (const el of insightEls) {
      const t = el.textContent.trim().toLowerCase();
      if (!result.workplaceType && (t.includes("remote") || t.includes("hybrid") || t.includes("on-site"))) {
        result.workplaceType = el.textContent.trim();
        if (t.includes("remote")) result.remote = true;
      }
      if (!result.employmentType && t.match(/full-?time|part-?time|contract|internship/)) {
        result.employmentType = el.textContent.trim();
      }
    }

    // Description
    const descEl =
      doc.querySelector("#job-details") ||
      doc.querySelector(".jobs-description__content") ||
      doc.querySelector(".jobs-description-content__text") ||
      qpc("jobs-description", doc) ||
      qpc("description__content", doc) ||
      qpc("jobs-box__html-content", doc);

    if (descEl) {
      const showMoreBtn = descEl.querySelector('button[class*="show-more"], button[aria-label*="Show more"]') ||
        descEl.parentElement?.querySelector('button[class*="show-more"], button[aria-label*="Show more"]');
      if (showMoreBtn) {
        try { showMoreBtn.click(); } catch (e) { /* ignore */ }
      }
      result.description = descEl.innerText.trim();
    }

    // Fallback: largest text block
    if (!result.description || result.description.length < 100) {
      const detailPane =
        qpc("scaffold-layout__detail", doc) ||
        qpc("job-details", doc) ||
        doc.querySelector("main");
      if (detailPane) {
        const divs = detailPane.querySelectorAll("div, section, article");
        let best = "";
        for (const d of divs) {
          const t = d.innerText?.trim() || "";
          if (t.length > best.length && t.length > 200 && t.length < 20000) {
            best = t;
          }
        }
        if (best.length > (result.description?.length || 0)) {
          result.description = best;
        }
      }
    }

    // Job criteria
    const criteriaItems = doc.querySelectorAll(
      '[class*="job-criteria"] li, .description__job-criteria-list li'
    );
    for (const li of criteriaItems) {
      const header = li.querySelector("h3, [class*='subheader']");
      const value = li.querySelector("span:last-child, [class*='body']");
      if (!header || !value) continue;
      const h = header.textContent.trim().toLowerCase();
      const v = value.textContent.trim();
      if (h.includes("seniority")) result.seniority = v;
      if (h.includes("employment type") || h.includes("job type")) result.employmentType = result.employmentType || v;
      if (h.includes("industry")) result.industry = v;
      if (h.includes("function")) result.jobFunction = v;
    }

    // Parse sections
    if (result.description) {
      const parsed = parseDescriptionSections(result.description);
      result.requirements = parsed.requirements;
      result.benefits = parsed.benefits;
    }

    result.applyUrl = window.location.href;
    return result;
  }

  // ─── Indeed ───────────────────────────────────────────────────────────────

  function extractIndeed() {
    const doc = document;
    const result = emptyResult("indeed");

    // Try JSON-LD first
    const jsonLd = extractFromJsonLd(doc);
    if (jsonLd && jsonLd.title) {
      Object.assign(result, jsonLd);
      result.source = "indeed";
    }

    // Title
    if (!result.title) {
      const titleEl =
        doc.querySelector('[class*="jobsearch-JobInfoHeader-title"]') ||
        doc.querySelector('h1[class*="JobTitle"]') ||
        doc.querySelector('h1.jobTitle') ||
        doc.querySelector('[data-testid="jobsearch-JobInfoHeader-title"]') ||
        doc.querySelector("h1");
      result.title = getText(titleEl);
    }

    // Company
    if (!result.company) {
      const compEl =
        doc.querySelector('[data-testid="inlineHeader-companyName"]') ||
        doc.querySelector('[class*="CompanyName"]') ||
        doc.querySelector('[data-company-name]') ||
        doc.querySelector('[class*="jobsearch-InlineCompanyRating"] a') ||
        doc.querySelector('[class*="companyName"]');
      result.company = getText(compEl);
    }

    // Location
    if (!result.location) {
      const locEl =
        doc.querySelector('[data-testid="inlineHeader-companyLocation"]') ||
        doc.querySelector('[data-testid="job-location"]') ||
        doc.querySelector('[class*="CompanyLocation"]') ||
        doc.querySelector('[class*="companyLocation"]');
      result.location = getText(locEl);
    }

    // Salary
    if (!result.salary) {
      const salEl =
        doc.querySelector('[id="salaryInfoAndJobType"]') ||
        doc.querySelector('[class*="salary-snippet"]') ||
        doc.querySelector('[class*="SalaryInfo"]') ||
        doc.querySelector('[class*="attribute_snippet"]');
      if (salEl) {
        const salText = salEl.textContent.trim();
        if (salText.match(/\$|salary|hour|year|annual/i)) {
          result.salary = salText;
        }
      }
    }

    // Employment type
    if (!result.employmentType) {
      const typeEl = doc.querySelector('[class*="jobsearch-JobMetadataHeader-item"]');
      if (typeEl) {
        const t = typeEl.textContent.trim();
        if (t.match(/full-?time|part-?time|contract|temporary|internship/i)) {
          result.employmentType = t;
        }
      }
    }

    // Description
    if (!result.description || result.description.length < 50) {
      const descEl =
        doc.querySelector("#jobDescriptionText") ||
        doc.querySelector('[id="jobDescriptionText"]') ||
        doc.querySelector('[class*="jobsearch-JobComponent-description"]') ||
        doc.querySelector('[class*="jobDescription"]');
      if (descEl) result.description = descEl.innerText.trim();
    }

    // Remote
    if (result.location?.toLowerCase().includes("remote") ||
        result.title?.toLowerCase().includes("remote")) {
      result.remote = true;
      result.workplaceType = "Remote";
    }

    if (result.description) {
      const parsed = parseDescriptionSections(result.description);
      result.requirements = parsed.requirements;
      result.benefits = parsed.benefits;
    }

    result.applyUrl = window.location.href;
    return result;
  }

  // ─── Glassdoor ────────────────────────────────────────────────────────────

  function extractGlassdoor() {
    const doc = document;
    const result = emptyResult("glassdoor");

    // Try JSON-LD
    const jsonLd = extractFromJsonLd(doc);
    if (jsonLd && jsonLd.title) {
      Object.assign(result, jsonLd);
      result.source = "glassdoor";
    }

    // Title
    if (!result.title) {
      const titleEl =
        doc.querySelector('[data-test="job-title"]') ||
        doc.querySelector('[class*="JobTitle"]') ||
        doc.querySelector('[class*="job-title"]') ||
        doc.querySelector('h1');
      result.title = getText(titleEl);
    }

    // Company
    if (!result.company) {
      const compEl =
        doc.querySelector('[data-test="employer-name"]') ||
        doc.querySelector('[class*="EmployerName"]') ||
        doc.querySelector('[class*="employer-name"]') ||
        doc.querySelector('[class*="companyName"]');
      result.company = getText(compEl);
    }

    // Location
    if (!result.location) {
      const locEl =
        doc.querySelector('[data-test="job-location"]') ||
        doc.querySelector('[class*="JobLocation"]') ||
        doc.querySelector('[class*="location"]');
      result.location = getText(locEl);
    }

    // Salary
    if (!result.salary) {
      const salEl =
        doc.querySelector('[data-test="detailSalary"]') ||
        doc.querySelector('[class*="SalaryEstimate"]') ||
        doc.querySelector('[class*="salary"]');
      if (salEl) {
        const t = salEl.textContent.trim();
        if (t.match(/\$|salary|hour|year|k/i)) result.salary = t;
      }
    }

    // Description
    if (!result.description || result.description.length < 50) {
      const descEl =
        doc.querySelector('[class*="JobDesc"]') ||
        doc.querySelector('[class*="jobDescription"]') ||
        doc.querySelector('[class*="desc"]') ||
        doc.querySelector('#JobDescriptionContainer') ||
        doc.querySelector('[data-test="description"]');
      if (descEl) result.description = descEl.innerText.trim();
    }

    if (result.description) {
      const parsed = parseDescriptionSections(result.description);
      result.requirements = parsed.requirements;
      result.benefits = parsed.benefits;
    }

    result.applyUrl = window.location.href;
    return result;
  }

  // ─── Greenhouse ───────────────────────────────────────────────────────────

  function extractGreenhouse() {
    const doc = document;
    const result = emptyResult("greenhouse");

    // Greenhouse boards have a clean structure
    const titleEl =
      doc.querySelector(".app-title") ||
      doc.querySelector('[class*="job-title"]') ||
      doc.querySelector("h1");
    result.title = getText(titleEl);

    // Company - often in the page title or header
    const compEl =
      doc.querySelector('[class*="company-name"]') ||
      doc.querySelector('.company-name');
    if (compEl) {
      result.company = getText(compEl);
    } else {
      // Try from page title "Job Title at Company"
      const pageTitle = document.title;
      const atMatch = pageTitle.match(/at\s+(.+?)(?:\s*[-|]|$)/i);
      if (atMatch) result.company = atMatch[1].trim();
    }

    // Location
    const locEl =
      doc.querySelector(".location") ||
      doc.querySelector('[class*="location"]');
    result.location = getText(locEl);

    // Description
    const descEl =
      doc.querySelector("#content") ||
      doc.querySelector('[class*="job-description"]') ||
      doc.querySelector('[class*="content"]') ||
      doc.querySelector(".body");
    if (descEl) result.description = descEl.innerText.trim();

    // Try JSON-LD fallback
    if (!result.title || !result.description) {
      const jsonLd = extractFromJsonLd(doc);
      if (jsonLd) {
        if (!result.title && jsonLd.title) result.title = jsonLd.title;
        if (!result.company && jsonLd.company) result.company = jsonLd.company;
        if (!result.location && jsonLd.location) result.location = jsonLd.location;
        if (!result.description && jsonLd.description) result.description = jsonLd.description;
        if (jsonLd.salary) result.salary = jsonLd.salary;
        if (jsonLd.employmentType) result.employmentType = jsonLd.employmentType;
        if (jsonLd.remote) { result.remote = true; result.workplaceType = "Remote"; }
      }
    }

    if (result.description) {
      const parsed = parseDescriptionSections(result.description);
      result.requirements = parsed.requirements;
      result.benefits = parsed.benefits;
    }

    result.applyUrl = window.location.href;
    return result;
  }

  // ─── Lever ────────────────────────────────────────────────────────────────

  function extractLever() {
    const doc = document;
    const result = emptyResult("lever");

    // Lever has a very consistent layout
    const titleEl =
      doc.querySelector(".posting-headline h2") ||
      doc.querySelector('[class*="posting-title"]') ||
      doc.querySelector("h2");
    result.title = getText(titleEl);

    // Location - Lever uses posting-categories
    const categories = doc.querySelectorAll(".posting-categories .sort-by-time, .posting-categories .posting-category");
    for (const cat of categories) {
      const t = cat.textContent.trim();
      if (!result.location && t && !t.match(/full-?time|part-?time|contract|remote|engineering|sales|marketing/i)) {
        result.location = t;
      }
      if (t.match(/full-?time|part-?time|contract|internship/i)) {
        result.employmentType = t;
      }
      if (t.match(/remote/i)) {
        result.remote = true;
        result.workplaceType = "Remote";
      }
    }

    // Also check the work-type element
    const workTypeEl = doc.querySelector('.posting-categories [class*="workplaceType"]');
    if (workTypeEl) {
      const wt = getText(workTypeEl);
      if (wt) {
        result.workplaceType = wt;
        if (wt.toLowerCase().includes("remote")) result.remote = true;
      }
    }

    // Company from the page
    const compEl = doc.querySelector('[class*="main-header-logo"] img');
    if (compEl) {
      result.company = compEl.alt || "";
    }
    if (!result.company) {
      // Try from URL: jobs.lever.co/companyname/
      const urlMatch = window.location.pathname.match(/^\/([^/]+)/);
      if (urlMatch) {
        result.company = urlMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }

    // Description - Lever wraps sections in .section
    const sections = doc.querySelectorAll(".section.page-centered");
    const descParts = [];
    for (const sec of sections) {
      descParts.push(sec.innerText.trim());
    }
    result.description = descParts.join("\n\n");

    // Fallback - try the entire content area
    if (!result.description || result.description.length < 50) {
      const contentEl = doc.querySelector(".content") || doc.querySelector('[class*="posting-page"]');
      if (contentEl) result.description = contentEl.innerText.trim();
    }

    if (result.description) {
      const parsed = parseDescriptionSections(result.description);
      result.requirements = parsed.requirements;
      result.benefits = parsed.benefits;
    }

    result.applyUrl = window.location.href;
    return result;
  }

  // ─── Workday ──────────────────────────────────────────────────────────────

  function extractWorkday() {
    const doc = document;
    const result = emptyResult("workday");

    // Workday has dynamic rendering, selectors may vary
    const titleEl =
      doc.querySelector('[data-automation-id="jobPostingHeader"] h2') ||
      doc.querySelector('[data-automation-id="jobTitle"]') ||
      doc.querySelector('[class*="job-title"]') ||
      doc.querySelector("h2");
    result.title = getText(titleEl);

    // Company
    const compEl =
      doc.querySelector('[data-automation-id="jobPostingCompanyName"]') ||
      doc.querySelector('[class*="company"]');
    if (compEl) {
      result.company = getText(compEl);
    } else {
      // Extract from hostname: company.myworkdayjobs.com
      const hostMatch = window.location.hostname.match(/^([^.]+)\./);
      if (hostMatch && hostMatch[1] !== "www") {
        result.company = hostMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }

    // Location
    const locEl =
      doc.querySelector('[data-automation-id="locations"]') ||
      doc.querySelector('[class*="location"]');
    result.location = getText(locEl);

    // Date posted
    const dateEl =
      doc.querySelector('[data-automation-id="postedOn"]') ||
      doc.querySelector('[class*="posted"]');
    result.datePosted = getText(dateEl);

    // Description
    const descEl =
      doc.querySelector('[data-automation-id="jobPostingDescription"]') ||
      doc.querySelector('[class*="job-description"]') ||
      doc.querySelector('[class*="jobDescription"]');
    if (descEl) result.description = descEl.innerText.trim();

    // Fallback to main content
    if (!result.description || result.description.length < 50) {
      const mainEl = doc.querySelector("main") || doc.querySelector('[role="main"]');
      if (mainEl) {
        const divs = mainEl.querySelectorAll("div, section");
        let best = "";
        for (const d of divs) {
          const t = d.innerText?.trim() || "";
          if (t.length > best.length && t.length > 200 && t.length < 20000) {
            best = t;
          }
        }
        if (best.length > (result.description?.length || 0)) {
          result.description = best;
        }
      }
    }

    // Try JSON-LD
    if (!result.title || !result.description) {
      const jsonLd = extractFromJsonLd(doc);
      if (jsonLd) {
        if (!result.title && jsonLd.title) result.title = jsonLd.title;
        if (!result.company && jsonLd.company) result.company = jsonLd.company;
        if (!result.location && jsonLd.location) result.location = jsonLd.location;
        if (!result.description && jsonLd.description) result.description = jsonLd.description;
        if (jsonLd.salary) result.salary = jsonLd.salary;
        if (jsonLd.employmentType) result.employmentType = jsonLd.employmentType;
        if (jsonLd.remote) { result.remote = true; result.workplaceType = "Remote"; }
      }
    }

    if (result.description) {
      const parsed = parseDescriptionSections(result.description);
      result.requirements = parsed.requirements;
      result.benefits = parsed.benefits;
    }

    result.applyUrl = window.location.href;
    return result;
  }

  // ─── ZipRecruiter ─────────────────────────────────────────────────────────

  function extractZipRecruiter() {
    const doc = document;
    const result = emptyResult("ziprecruiter");

    const jsonLd = extractFromJsonLd(doc);
    if (jsonLd && jsonLd.title) {
      Object.assign(result, jsonLd);
      result.source = "ziprecruiter";
    }

    if (!result.title) {
      const titleEl =
        doc.querySelector('[class*="job_title"]') ||
        doc.querySelector('h1[class*="Title"]') ||
        doc.querySelector("h1");
      result.title = getText(titleEl);
    }

    if (!result.company) {
      const compEl =
        doc.querySelector('[class*="hiring_company"]') ||
        doc.querySelector('[class*="CompanyName"]') ||
        doc.querySelector('[data-testid="CompanyName"]');
      result.company = getText(compEl);
    }

    if (!result.location) {
      const locEl = doc.querySelector('[class*="location"]') || doc.querySelector('[class*="Location"]');
      result.location = getText(locEl);
    }

    if (!result.description || result.description.length < 50) {
      const descEl =
        doc.querySelector('[class*="job_description"]') ||
        doc.querySelector('[class*="jobDescriptionSection"]') ||
        doc.querySelector('[class*="Description"]');
      if (descEl) result.description = descEl.innerText.trim();
    }

    if (result.description) {
      const parsed = parseDescriptionSections(result.description);
      result.requirements = parsed.requirements;
      result.benefits = parsed.benefits;
    }

    result.applyUrl = window.location.href;
    return result;
  }

  // ─── Generic / fallback extractor ─────────────────────────────────────────

  function extractGeneric() {
    const doc = document;
    const result = emptyResult("generic");

    // 1. Try JSON-LD (most reliable)
    const jsonLd = extractFromJsonLd(doc);
    if (jsonLd && jsonLd.title) {
      Object.assign(result, jsonLd);
      result.source = detectSite();
      if (result.source === "generic") {
        // Try to get a more descriptive source from the hostname
        const host = window.location.hostname.replace(/^www\./, "");
        result.source = host.split(".")[0] || "generic";
      }
    }

    // 2. Try meta tags
    if (!result.title) {
      result.title = getMetaContent("og:title", doc) ||
        getMetaContent("twitter:title", doc) ||
        getText(doc.querySelector("h1")) ||
        document.title.split(/[-|]/)[0].trim();
    }

    if (!result.description) {
      result.description = getMetaContent("og:description", doc) ||
        getMetaContent("description", doc) || "";
    }

    if (!result.company) {
      result.company = getMetaContent("og:site_name", doc) || "";
    }

    // 3. Try to find description from page content
    if (!result.description || result.description.length < 100) {
      const descCandidates = [
        '[class*="job-description"]', '[class*="jobDescription"]',
        '[class*="job_description"]', '[class*="job-details"]',
        '[class*="posting-description"]', '[class*="description"]',
        '[id*="job-description"]', '[id*="jobDescription"]',
        '[data-testid*="description"]', 'article', 'main',
        '[role="main"]',
      ];

      for (const selector of descCandidates) {
        const el = doc.querySelector(selector);
        if (el) {
          const text = el.innerText.trim();
          if (text.length > 100 && text.length > (result.description?.length || 0)) {
            result.description = text;
            break;
          }
        }
      }
    }

    // 4. Try to find company from the page
    if (!result.company) {
      const compCandidates = [
        '[class*="company-name"]', '[class*="companyName"]',
        '[class*="company_name"]', '[class*="employer"]',
        '[data-testid*="company"]',
      ];
      for (const selector of compCandidates) {
        const el = doc.querySelector(selector);
        if (el) {
          const t = getText(el);
          if (t && t.length < 100) { result.company = t; break; }
        }
      }
    }

    // 5. Location
    if (!result.location) {
      const locCandidates = [
        '[class*="location"]', '[class*="Location"]',
        '[data-testid*="location"]', '[itemprop="jobLocation"]',
      ];
      for (const selector of locCandidates) {
        const el = doc.querySelector(selector);
        if (el) {
          const t = getText(el);
          if (t && t.length < 100) { result.location = t; break; }
        }
      }
    }

    // 6. Salary
    if (!result.salary) {
      const salCandidates = [
        '[class*="salary"]', '[class*="Salary"]', '[class*="compensation"]',
        '[data-testid*="salary"]', '[itemprop="baseSalary"]',
      ];
      for (const selector of salCandidates) {
        const el = doc.querySelector(selector);
        if (el) {
          const t = getText(el);
          if (t && t.match(/\$|salary|hour|year|k/i)) { result.salary = t; break; }
        }
      }
    }

    // Parse sections from description
    if (result.description) {
      const parsed = parseDescriptionSections(result.description);
      result.requirements = parsed.requirements;
      result.benefits = parsed.benefits;
    }

    // Remote detection
    if (result.location?.toLowerCase().includes("remote") ||
        result.title?.toLowerCase().includes("remote")) {
      result.remote = true;
      result.workplaceType = "Remote";
    }

    result.applyUrl = window.location.href;
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN EXTRACTION DISPATCHER
  // ═══════════════════════════════════════════════════════════════════════════

  function extractJobData() {
    const site = detectSite();
    let result;

    switch (site) {
      case "linkedin":
        result = extractLinkedIn();
        break;
      case "indeed":
        result = extractIndeed();
        break;
      case "glassdoor":
        result = extractGlassdoor();
        break;
      case "greenhouse":
        result = extractGreenhouse();
        break;
      case "lever":
        result = extractLever();
        break;
      case "workday":
        result = extractWorkday();
        break;
      case "ziprecruiter":
        result = extractZipRecruiter();
        break;
      case "simplyhired":
      case "monster":
      case "careerbuilder":
      case "wellfound":
      case "builtin":
      case "dice":
      case "remoteok":
      case "weworkremotely":
      case "flexjobs":
      default:
        result = extractGeneric();
        break;
    }

    // Ensure source is set
    if (!result.source || result.source === "jsonld") {
      result.source = site;
    }

    return result;
  }

  // ─── Extract and send ───────────────────────────────────────────────────

  function extractAndSend() {
    const jobData = extractJobData();
    if (jobData && (jobData.title || jobData.description)) {
      jobData.pageUrl = window.location.href;
      jobData.extractedAt = new Date().toISOString();
      chrome.runtime.sendMessage({ action: "jobDataExtracted", data: jobData });
    } else {
      chrome.runtime.sendMessage({ action: "extractionFailed", url: window.location.href });
    }
  }

  // ─── Message listener ──────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "extractJob") {
      // Give a moment for any show-more clicks to resolve
      setTimeout(() => {
        const jobData = extractJobData();
        if (jobData) {
          jobData.pageUrl = window.location.href;
          jobData.extractedAt = new Date().toISOString();
        }
        sendResponse({ success: !!(jobData?.title || jobData?.description), data: jobData });
      }, 300);
      return true; // keep channel open for async
    }
    if (msg.action === "getPageUrl") {
      sendResponse({ url: window.location.href });
      return true;
    }
  });

})();
