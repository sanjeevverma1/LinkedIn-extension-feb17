// content.js — Extracts job posting data from LinkedIn job pages
// KEY FINDING (Feb 2025): LinkedIn renders its entire page inside an
// iframe[src*="/preload/"]. All DOM queries must target the iframe's
// contentDocument, not the top-level document.
(function () {
  "use strict";
  if (window.__linkedinResumeExtLoaded) return;
  window.__linkedinResumeExtLoaded = true;

  // ─── Get the real document (inside LinkedIn's iframe) ───────────────────────

  function getDoc() {
    // LinkedIn wraps its content in an iframe. Try to get its document.
    const iframe = document.querySelector('iframe[src*="preload"]');
    if (iframe) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc && iframeDoc.body && iframeDoc.body.innerText.length > 100) {
          return iframeDoc;
        }
      } catch (e) { /* cross-origin — fall through */ }
    }
    // Fallback: main document (in case LinkedIn changes architecture)
    return document;
  }

  // ─── Helper: query with partial class match ─────────────────────────────────

  function qpc(partial, root) {
    return root.querySelector(`[class*="${partial}"]`);
  }

  // ─── Main extraction ────────────────────────────────────────────────────────

  function extractJobData() {
    const doc = getDoc();
    const result = {
      title: "", company: "", companyUrl: "", location: "", description: "",
      salary: "", datePosted: "", employmentType: "", remote: false,
      requirements: "", benefits: "", applyUrl: "", seniority: "",
      workplaceType: "", industry: "", jobFunction: "", applicants: "",
      source: "linkedin",
    };

    // ── Title ──
    // Known classes: .t-24 (main title heading), h1, [class*="top-card__job-title"]
    const titleEl =
      doc.querySelector("h1.t-24") ||
      doc.querySelector("h1.t-20") ||
      qpc("top-card__job-title", doc) ||
      qpc("topcard__title", doc) ||
      doc.querySelector("h1");
    if (titleEl) result.title = titleEl.textContent.trim();

    // ── Company ──
    // The company name is inside a link to /company/
    const companyLink =
      doc.querySelector('.job-details-jobs-unified-top-card__company-name a') ||
      doc.querySelector('.jobs-unified-top-card__company-name a') ||
      qpc("top-card__company-name", doc)?.querySelector("a") ||
      (function () {
        // Find company links within the top card area only
        const topCard = qpc("unified-top-card", doc) || qpc("top-card", doc);
        if (topCard) {
          const link = topCard.querySelector('a[href*="/company/"]');
          if (link) return link;
        }
        // Broader fallback
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

    // ── Location & meta from primary description container ──
    // .job-details-jobs-unified-top-card__primary-description-container
    const primaryDesc =
      qpc("primary-description-container", doc) ||
      qpc("primary-description", doc);
    if (primaryDesc) {
      // The primary description has nested spans. We want direct-ish child spans
      // separated by · dots. Get the raw text and split by ·
      const rawText = primaryDesc.textContent.trim();
      const parts = rawText.split("·").map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 1) result.location = parts[0];
      if (parts.length >= 2) result.datePosted = parts[1];
      if (parts.length >= 3) result.applicants = parts[2];
    }
    // Fallback location
    if (!result.location) {
      const locEl = qpc("bullet", doc) || qpc("topcard__flavor--bullet", doc);
      if (locEl) result.location = locEl.textContent.trim();
    }

    // ── Salary & workplace pills ──
    // These are buttons/items in .job-details-fit-level-preferences
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
          // Extract just the employment type keyword, not surrounding tooltip text
          const match = t.match(/(full-?time|part-?time|contract|internship)/i);
          result.employmentType = match ? match[1] : t;
        }
      }
    }
    // Also check insight spans for workplace/employment
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

    // ── Description (THE KEY ELEMENT) ──
    // Known selectors (inside iframe): #job-details, .jobs-description__content,
    // .jobs-description-content__text--stretch, .jobs-box__html-content
    const descEl =
      doc.querySelector("#job-details") ||
      doc.querySelector(".jobs-description__content") ||
      doc.querySelector(".jobs-description-content__text") ||
      qpc("jobs-description", doc) ||
      qpc("description__content", doc) ||
      qpc("jobs-box__html-content", doc);

    if (descEl) {
      // Click any "See more" / "Show more" button within the description
      const showMoreBtn = descEl.querySelector('button[class*="show-more"], button[aria-label*="Show more"]') ||
        descEl.parentElement?.querySelector('button[class*="show-more"], button[aria-label*="Show more"]');
      if (showMoreBtn) {
        try { showMoreBtn.click(); } catch (e) { /* ignore */ }
      }

      result.description = descEl.innerText.trim();
    }

    // ── Fallback: largest text block in the detail pane ──
    if (!result.description || result.description.length < 100) {
      const detailPane =
        qpc("scaffold-layout__detail", doc) ||
        qpc("job-details", doc) ||
        doc.querySelector("main");
      if (detailPane) {
        // Walk children to find the description block
        const divs = detailPane.querySelectorAll("div, section, article");
        let best = "";
        for (const d of divs) {
          const t = d.innerText?.trim() || "";
          // Look for a div that's long enough to be the description but not the entire page
          if (t.length > best.length && t.length > 200 && t.length < 20000) {
            best = t;
          }
        }
        if (best.length > (result.description?.length || 0)) {
          result.description = best;
        }
      }
    }

    // ── Job criteria (seniority, industry, function) ──
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

    // ── Parse requirements & benefits from description text ──
    if (result.description) {
      const parsed = parseDescriptionSections(result.description);
      result.requirements = parsed.requirements;
      result.benefits = parsed.benefits;
    }

    // ── Apply URL ──
    result.applyUrl = window.location.href;

    return result;
  }

  // ─── Section parser ─────────────────────────────────────────────────────────

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

  // ─── Extract and send ───────────────────────────────────────────────────────

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

  // ─── Message listener ──────────────────────────────────────────────────────

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
