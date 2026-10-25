# Empirical Site Access & Publication Cadence Report (`2026-10-25`)

Live verification of upstream Texas regulatory portals conducted from the Linux execution environment on `2026-10-25` to validate scraping feasibility, WAF/bot-protection behavior, actual DOM/API contracts, and real-world publication frequency.

---

## 1. Portal Access Matrix & WAF Behavior

| Portal / Endpoint | URL Tested | Live Status | WAF / Bot Protection | Verdict for Gridlock |
| :--- | :--- | :--- | :--- | :--- |
| **TDLR TABS Search API** | `POST https://www.tdlr.texas.gov/TABS/Search/SearchProjects` | `200 OK` | **None** (`CF-Ray: None`) | **Primary MVP Discovery Endpoint**. Accepts `application/x-www-form-urlencoded` DataTables queries and returns structured JSON. |
| **TDLR TABS Project Detail Page** | `GET https://www.tdlr.texas.gov/TABS/Search/Project/{ProjectNumber}` | `200 OK` | **None** (`CF-Ray: None`) | **Primary MVP Detail HTML Endpoint**. Returns ~16.7 KB server-rendered HTML (`~3.5 KB` gzipped) with `<dl class="dl-horizontal">` key-value pairs. |
| **Austin Open Data Permits API** | `GET https://data.austintexas.gov/resource/3syk-w9eu.json` | `200 OK` | **None** (Socrata REST) | **Valid Phase 2 Expansion**. Clean JSON, zero WAF, updates daily. |
| **Austin AB+C Web Portal** | `GET https://abc.austintexas.gov/web/permit/public-search-other` | `200 OK` (Challenge) | **Blocked by Imperva Incapsula** (`/_Incapsula_Resource` iframe) | **Do Not Scrape Directly**. Use `data.austintexas.gov` Socrata API instead. |
| **ERCOT Grid Info** | `GET https://www.ercot.com/gridinfo/generation` | `200 OK` | **None** (`Server: Apache`) | **Valid Phase 2 Expansion**. Direct `.xlsx` and `.docx` report links accessible without challenge. |

> [!IMPORTANT]
> **Correction to Legacy Documentation**: The archived `gridlock-scraper` repository previously assumed TDLR TABS used legacy ASP.NET WebForms (`__VIEWSTATE`, `#ctl00_ContentPlaceHolder1_lblProjectNumber`). Live probing confirmed TDLR TABS actually runs **ASP.NET MVC + jQuery DataTables** (`projectSearchJs`) with semantic `<div class="project-details-project">` and `<dl class="dl-horizontal"><dt>...</dt><dd>...</dd></dl>` markup.

---

## 2. Publication Frequency & Cadence Analysis (TDLR TABS)

### 2.1 Overall Portal Activity
- **Total Registered Projects**: `345,306` statewide commercial/public registrations as of `2026-10-25`.
- **General Portal Update Frequency**: Continuous real-time updates on business days (~100–200 general commercial registrations per business day; latest observed filing `TABS2027004370` registered `2026-10-24T18:09:16`).

### 2.2 Texas Data Center & Compute Infrastructure Velocity
Querying TDLR TABS across verified compute infrastructure filters (`ProjectName="Data Center"`, `ProjectName="Datacenter"`, `FacilityName="Data Center"`, `OwnerName="Datacenter"`, `OwnerName="QTS"`, `OwnerName="CyrusOne"`) yielded **290+ verified data center filings**, plus **54 substation filings** and **20 semiconductor fab filings**.

#### Monthly Data Center Filing Counts (Jan 2025 – Oct 2026)

| Month | Verified New Data Center Filings | Notable Examples |
| :--- | :--- | :--- |
| `2026-10` *(through Oct 24)* | **5** | Compass Datacenters DFWIII-III Bldgs 8, 9, 10 (`$300M` total), DAL130 (`$83M`), EG AI Rice Campus (`$5M`) |
| `2026-09` | **7** | Colovore Alliance (`$430M`), Beacon Point (`$399M`), QTS DFW2-DC7 (`$290M`), Colovore Hutto (`$280M`), CyrusOne DFW8 (`$257M`) |
| `2026-08` | **4** | Pecos County Data Center Bldgs B & C (`$600M` total), TCCD Data Center (`$2M`) |
| `2026-07` | **4** | Statewide campus additions and tenant fit-outs |
| `2026-06` | **9** | Summer peak construction registrations |
| `2026-05` | **3** | Regional facility expansions |
| `2026-04` | **6** | Spring campus registrations |
| `2026-01` – `2026-03` | **8** (`2–3/mo`) | Q1 registrations |
| `2025` *(Full Year)* | **48** (`4.0/mo` avg) | Steady 3–8 filings every month across DFW, Central Texas (Austin/Hutto/Taylor), San Antonio, and West Texas |

### 2.3 Architectural Implications for Cadence & Seeding
1. **Steady 1–2 Filings/Week Velocity (`4–9/month`)**:
   - Data center filings on TDLR TABS occur at a steady pace of **1 to 2 major filings per week** (`4–9 per month`), alongside ongoing status updates (`Project Registered (3008)` $\to$ `Inspection Scheduled (3003)` $\to$ `Inspection Completed (3001)` $\to$ `Project Closed (3007)`).
   - **Cadence Reconfiguration**: Polling every 6 hours (`4x/day`) is unnecessary. A **once-daily weekday sweep** (or twice-weekly schedule) captures 100% of new registrations while keeping >80% of runs as fast SHA-256 no-op short-circuits.
2. **Mandatory Historical Backfill Mode (`--backfill`)**:
   - Because new filings arrive 1–2 times per week, waiting for live daily runs alone would take months to populate a multi-stage timeline.
   - The TDLR TABS Connector must support a **historical backfill mode** that ingests the existing 2024–2026 Texas data center filings in chronological order (`ProjectCreatedOn ASC`) so the **Observation** spine and **Visual Plate Lineage** immediately reflect multi-year Texas infrastructure growth on Day 1.
3. **Query Filter Guardrail (`OwnerName` Tokenization Quirk)**:
   - TDLR's `/TABS/Search/SearchProjects` backend splits multi-word `OwnerName` queries on whitespace (causing `OwnerName="Data Center"` to match `9,445` generic `"Shopping Center"` owners).
   - The TDLR Connector must query `ProjectName="Data Center"`, `ProjectName="Datacenter"`, `FacilityName="Data Center"`, and single-token operator slugs (`QTS`, `CyrusOne`, `Compass`, `Colovore`), followed by a deterministic keyword/scope post-filter on `ScopeOfWork` / `ProjectName` / `FacilityName`.

---

## 3. Live Sample Record & DOM Reference (`TABS2027003697`)

### 3.1 Search Endpoint JSON Row (`POST /TABS/Search/SearchProjects`)
```json
{
  "ProjectCreatedOn": "2026-10-15T14:37:16.93",
  "ProjectId": "8f2a99c1-...",
  "ProjectNumber": "TABS2027003697",
  "DataVersionId": 900001,
  "ProjectName": "Compass Datacenters - DFWIII-III - Building 10 - Interior / Tenant Fit Out",
  "ProjectStatus": 3008,
  "FacilityName": "DFWIII III - Building 10",
  "City": 415,
  "County": 2057,
  "TypeOfWork": 9002,
  "EstimatedCost": 100000000.0,
  "EstimatedStartDate": "2024-12-01T00:00:00",
  "EstimatedEndDate": "2028-08-22T00:00:00"
}
```

### 3.2 Detail Page HTML Snippet (`GET /TABS/Search/Project/TABS2027003697`)
```html
<div class="project-details">
  <div class="project-details-header">
    <h3>Architectural Barriers Project Details Page</h3>
    <p><b>Project #:</b> TABS2027003697 <span class="pull-right"><b>Registration Date:</b> 10/15/2026</span></p>
  </div>
  <div class="project-details-body">
    <div class="project-details-project">
      <h4>PROJECT</h4>
      <dl class="dl-horizontal">
        <dt>Project Name:</dt>
        <dd>Compass Datacenters - DFWIII-III - Building 10 - Interior / Tenant Fit Out</dd>
        <dt>Project Number:</dt>
        <dd>TABS2027003697</dd>
        <dt>Facility Name:</dt>
        <dd>DFWIII III - Building 10</dd>
        <dt>Location Address:</dt>
        <dd>590 Austin Blvd</dd>
        <dd>Red Oak, TX 75154</dd>
        <dt>Location County:</dt>
        <dd>Ellis</dd>
      </dl>
      <dl class="dl-horizontal">
        <dt>Start Date:</dt>
        <dd>12/1/2024</dd>
        <dt>Completion Date:</dt>
        <dd>8/22/2028</dd>
        <dt>Estimated Cost:</dt>
        <dd>$100,000,000</dd>
        <dt>Type of Work:</dt>
        <dd>Renovation/Alteration</dd>
        <dt>Scope of Work:</dt>
        <dd>251,815 sq. ft of Interior / Tenant Fit-Out for construction of a new Data Center on a Data Center Campus.</dd>
        <dt>Square Footage:</dt>
        <dd>251,815 ft <sup>2</sup></dd>
      </dl>
      <dl class="dl-horizontal">
        <dt>Current Status:</dt>
        <dd>Project Registered</dd>
      </dl>
    </div>
    <div class="project-details-owner">
      <h4>OWNER</h4>
      <dl class="dl-horizontal">
        <dt>Owner Name:</dt>
        <dd>COMPASS DATACENTERS DFW III-I LLC</dd>
      </dl>
    </div>
  </div>
</div>
```

---

## 4. Site Access Guardrail: WAF Challenge vs. Selector Anomaly

Because portals like `abc.austintexas.gov` serve HTTP `200 OK` HTML pages containing an Imperva challenge (`/_Incapsula_Resource`), a naive scraper would mistake a WAF block for a "broken CSS selector" and invoke the **Repair Agent** on a CAPTCHA page.

To prevent this:
1. **Pre-Parse Site Access Guard (`verifySiteAccess`)**: Before evaluating `ConnectorConfig` selectors, inspect HTTP status (`403`, `429`, `503`) and known WAF signatures (`_Incapsula_Resource`, `cf-mitigated`, `challenge-platform`, `g-recaptcha`).
2. **Distinct Failure States**:
   - **`blocked_by_waf`**: Halts immediately with `0` Gemini tokens spent and logs an access alert—**never** invokes the **Repair Agent**.
   - **`selector_anomaly`**: Confirmed valid portal document (`<title>TDLR TABS...`) where expected fields failed extraction—invokes the out-of-band **Repair Agent**.

---

## 5. Ethical, Legal & Civic Stewardship Guardrails ("Cause No Harm")

1. **Public-Domain Civic Scope**: Gridlock exclusively ingests non-confidential commercial regulatory records published for public inspection under the **Texas Public Information Act (Texas Government Code Chapter 552)** and official open-government portals, always preferring structured Open Data REST APIs over HTML scraping where available.
2. **Zero Circumvention**: Connectors must **never** bypass, spoof, or defeat `robots.txt` directives, authentication gates, rate limiters (`429` / `Retry-After`), CAPTCHAs, or WAF challenges (such as Imperva Incapsula on `abc.austintexas.gov`). Any access restriction halts the connector (`blocked_by_waf`) immediately.
3. **Transparent Identification & Polite Pacing**: Every outgoing HTTP and Playwright request sends a transparent, contactable `User-Agent` (`GridlockCivicResearchBot/1.0 (+https://samasastudio.com; contact@samasastudio.com)`), runs single-threaded (`maxConcurrency: 1`), waits `>= 1,500ms` with jitter between detail fetches, and enforces a per-run cap (`<= 100` records/run) on a polite once-daily weekday schedule (`0 14 * * 1-5` UTC).
4. **PII Redaction & Privacy Minimization**: Deterministic sanitizers strip incidental personal contact information (individual phone numbers, personal email addresses, residential addresses) before writing `Project` or `Observation` records to Firestore, retaining only corporate entity names (`OwnerName`, `FacilityName`, `DesignFirmName`) and municipal/county location fields.
5. **Cryptographic Provenance & Epistemic Honesty**: All published records link to an immutable SHA-256 `SourceArtifact` and upstream URL, and user-branched `Visual Plates` are explicitly labeled as `"Scenario Branch / Unverified Projection"`.
