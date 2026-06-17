# TORIUM MVP Scope

## Objective

The first version of TORIUM must stay narrow.

The objective is not to build a complete real estate operating system.

The objective is to build a working intelligence pipeline that can analyze a property and produce a structured report useful for early-stage investment screening.

The MVP should answer one practical question:

> Given this property, is it worth spending more human time on it?

---

## MVP Definition

The MVP takes a property as input and produces a deal intelligence brief as output.

The system should combine:

- Scraped property data
- External enrichment through OpenAPI sources
- Expert knowledge extracted from WhatsApp conversations
- Retrieval-Augmented Generation
- Parallel reasoning across GPT, Gemini, and Claude

The final output should synthesize the different model responses into one readable report.

---

## In Scope

### 1. Scraping

Use Apify actors to collect property-related data from selected sources.

The first version should focus only on a small number of sources.

The goal is not exhaustive coverage.

The goal is to create enough structured input for the reasoning layer.

### 2. Data Enrichment

Use OpenAPI-based enrichment to add context to the scraped property data.

Possible enrichment fields:

- Location
- Surface area
- Asking price
- Property type
- Floor
- Building characteristics
- Listing metadata
- Nearby signals
- Publicly available contextual data

### 3. Expert Corpus

Use WhatsApp conversations with experienced operators as the first proprietary knowledge base.

The corpus should be cleaned and transformed into reusable knowledge fragments.

Relevant fragments may include:

- Renovation heuristics
- Investor rules of thumb
- Red flags
- Hidden costs
- Common mistakes
- Due diligence questions
- Transformation constraints
- Deal negotiation patterns

### 4. RAG Layer

The RAG layer should retrieve relevant expert fragments based on the property being analyzed.

The first version should prioritize usefulness over complexity.

A simple retrieval system is acceptable if it returns relevant context for the LLMs.

### 5. Multi-Model Reasoning

Run the same property context through:

- GPT
- Gemini
- Claude

Each model should produce its own structured assessment.

The system should then compare the outputs and generate a consolidated brief.

### 6. Output Brief

The final report should include:

- Property summary
- Opportunity thesis
- Key risks
- Technical red flags
- Legal or condominium red flags
- Possible transformation scenarios
- Missing information
- Questions for a technician or investor
- Risk level
- Confidence score
- Model disagreement notes

---

## Out of Scope

The following features are intentionally excluded from the first MVP:

- Full urban planning automation
- Construction cost prediction engine
- Automated legal due diligence
- Automated purchase recommendations
- Historical deal database
- Causal graph engine
- Technical failure probability model
- Off-market acquisition workflow
- Telegram or WhatsApp operational bot
- Investor dashboard
- User authentication
- Payments
- Team collaboration features

These may become relevant later, but not during the first phase.

---

## MVP Success Criteria

The MVP is successful if it can consistently generate reports that are:

- Clear
- Specific
- Grounded in retrieved information
- Operationally useful
- Better than a generic LLM response
- Good enough to decide whether a property deserves deeper human review

A strong benchmark:

> TORIUM should produce a first-pass property brief better than what Federico could manually produce in 30 minutes using only the raw listing and scattered notes.

---

## First Development Milestones

### Milestone 1 — Repository Setup

Create the basic project structure and documentation.

### Milestone 2 — Scraper Integration

Connect the first Apify actor and store raw property data.

### Milestone 3 — Expert Corpus Preparation

Clean and chunk WhatsApp conversations into reusable knowledge fragments.

### Milestone 4 — First RAG Prototype

Retrieve relevant expert fragments for a given property.

### Milestone 5 — Multi-Model Prompting

Send the same property context to GPT, Gemini, and Claude using comparable prompts.

### Milestone 6 — Report Synthesis

Create a final consolidated brief from the three model outputs.

---

## Guiding Constraint

Whenever a feature increases complexity without improving the first property brief, it should be postponed.

The MVP exists to prove that expert knowledge plus scraped data plus multi-model reasoning can produce useful real estate intelligence.

Everything else comes later.
