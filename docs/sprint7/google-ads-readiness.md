# Google Ads readiness — strategy only

No account, campaign, billing profile, payment method, bid or ad was created. No money was spent.

## Preconditions before any future launch

1. Sprint 7 backend acquisition events are live and visible in founder analytics.
2. The cPanel release and search-intent pages pass production smoke tests.
3. Privacy/consent handling has been reviewed for the intended countries.
4. Founder approves one maximum budget and one owner who can stop the test.
5. Conversion import into Google Ads is separately designed; do not expose identifiers or replace the first-party privacy boundary by default.

## Keyword plan

Start with exact and phrase match. Do not begin with broad match or the generic term `medical devices`.

### Campaign 1 — Medical Device Tenders

Ad group: Tender platform

- [medical device tender platform]
- “medical device tender platform”
- [medical tender platform]
- “medical procurement platform”

Ad group: European tenders

- [medical device tenders europe]
- “european medical tenders”
- [medical equipment tenders]
- “healthcare tenders europe”

Landing page: `https://medichall.com/medical-device-tenders`

### Campaign 2 — Tender Intelligence

Ad group: Document intelligence

- [ai tender intelligence]
- “medical tender intelligence”
- “tender document analysis ai”
- [medical tender analysis]

Landing page: `https://medichall.com/ai-tender-intelligence`

### Campaign 3 — B2B Partner Discovery

Ad group: Find distributors

- [find medical device distributors]
- “medical device distributors europe”
- [medical equipment distributors europe]

Landing page: `https://medichall.com/find-medical-device-distributors`

Ad group: Medical matchmaking

- [medical device matchmaking]
- “ai medical device matchmaking”
- “find medical device business partners”

Landing page: `https://medichall.com/ai-medical-device-matchmaking`

### Campaign 4 — Marketplace / RFQ (only after demand proof)

- [medical device b2b marketplace]
- “medical device supplier platform”
- [medical device rfq]
- “medical device sourcing platform”

Landing page: `https://medichall.com/medical-device-b2b-marketplace`

## Negative keyword starting list

Apply at campaign level where clearly irrelevant:

- jobs, job, career, careers, salary, internship;
- course, courses, training, certification course, school, university, degree;
- definition, meaning, wikipedia;
- repair, repair manual, service manual, spare parts;
- used, second hand, refurbished (unless MedicHall later supports this market);
- consumer, home use, retail, amazon, ebay;
- free pdf, template, sample tender document;
- veterinary (unless separately supported);
- software developer, source code, github;
- stock price, share price.

Do not automatically exclude `free`: Open Beta users may legitimately search for a free tender tool. Review the actual search-term report before adding it.

## Responsive Search Ad copy bank

Headlines (keep only combinations that remain accurate):

- European Medical Tenders
- Medical Tender Intelligence
- AI-Assisted Tender Analysis
- Find Medical Device Partners
- Medical B2B Matchmaking
- Medical Products and RFQs
- Connect With Medical Companies
- Evidence-Backed Tender Review
- MedicHall Open Beta
- Explore Official-Source Tenders
- Find Medical Distributors
- From Product Search to RFQ
- Structured Partner Discovery
- Review Tender Evidence Faster
- Join the MedicHall Open Beta

Descriptions:

- Discover public medical tenders and follow every opportunity to its official source.
- Move relevant tenders into private, evidence-backed document analysis. Open Beta.
- Explore manufacturers, distributors, suppliers and buyers by real company role.
- Compare structured partner evidence, request a connection and propose a secure meeting.
- Browse medical products, review company context and create a structured quotation request.
- AI assists discovery and review. Your team verifies the documents and makes every decision.

Avoid: “best”, “leading”, “largest”, guaranteed results, savings claims, accuracy percentages or claims that MedicHall submits bids.

## Initial country hypothesis

Evidence: MedTech Europe’s 2025 data identifies Germany, France, the United Kingdom, Italy and Spain as the five largest European medical-technology markets by 2024 market value. That indicates ecosystem size, not advertising performance.

Recommended first English-language test hypothesis:

- Netherlands — English business usability and established medtech/distribution ecosystem; test demand, do not assume low CPC.
- Ireland — English language, EU membership and medical-technology ecosystem; likely smaller search volume.
- Germany — largest European market, but begin with a tightly bounded English ad group only; local-language demand will require native German review and separate landing copy.

Do not launch all Europe. France, Italy and Spain should wait for native-language keyword/landing review. The United Kingdom requires separate confirmation that the tender feed and positioning cover the intended procurement sources.

## Small controlled experiment

- Campaign type: Search only.
- Languages: English only.
- Networks: Google Search only; exclude Display and search partners initially.
- Match: exact + phrase.
- Geography: people in the selected locations, not people merely interested in them.
- Proposed maximum: €15–€25/day for 14 days, total cap €210–€350.
- Do not use the proposed range as authorization to spend.

Primary conversion: qualified sign-up that reaches company/profile activation.
Secondary: connection request or RFQ.
Diagnostic only: click, sign-up start.

Stop conditions:

- any misleading query/claim or unintended consumer traffic;
- broken signup/RFQ/landing flow;
- no sign-up after €150 spend;
- more than 70% irrelevant search terms after the first 30 clicks;
- provider/production incident;
- no reliable conversion measurement;
- founder cannot review leads and feedback promptly.

Early success criteria (hypotheses, not promises):

- at least 3 qualified company sign-ups;
- at least 2 reach a meaningful activation action;
- at least 1 connection request or RFQ;
- search-term relevance of at least 80%;
- a documented cost per activated company that the founder can compare with organic LinkedIn and editorial referral traffic.

Do not scale based only on CTR or low CPC.

## SERP/competitor implications

- distributor-directory results emphasize country/category navigation and explicit verification;
- tender platforms emphasize breadth, alerting, country coverage and procurement intelligence;
- broad medical marketplaces have strong catalog authority;
- MedicHall should own the narrower combined workflow: medical-device-specific tender discovery/intelligence plus structured company/product matchmaking and direct connection.

Source used for country-market context: https://www.medtecheurope.org/datahub/market/
