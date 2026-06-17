# TORIUM

TORIUM is an experimental AI intelligence system for real estate opportunity analysis.

The long-term vision is to build an Urban Operating System capable of combining public property data, expert knowledge, scraped information, and AI reasoning into a decision-support layer for real estate investors and operators.

At the current stage, TORIUM is intentionally much smaller.

The first goal is to build a practical intelligence MVP that can take a property, enrich it with available data, retrieve relevant expert knowledge, and generate a structured investment brief.

---

## Current MVP

The current version of TORIUM is based on a simple pipeline:

```text
Apify Scraper 1
Apify Scraper 2
        ↓
Raw property data
        ↓
OpenAPI enrichment
        ↓
WhatsApp expert corpus
        ↓
RAG retrieval
        ↓
GPT + Gemini + Claude in parallel
        ↓
Deal brief / risk brief / opportunity score
```

The system does not try to automate real estate investing.

It tries to produce a better first analysis than a human operator could produce manually in a short amount of time.

---

## Inputs

TORIUM may use:

- Property listings
- Scraped real estate data
- Publicly available property information
- WhatsApp conversations with experienced operators
- Investor notes
- Renovation and construction heuristics
- Legal, technical, and commercial red flags

---

## Outputs

The MVP should generate a structured brief containing:

- Property summary
- Opportunity assessment
- Technical red flags
- Legal and condominium red flags
- Transformation hypotheses
- Questions for due diligence
- Risk assessment
- Confidence score
- Model comparison across GPT, Gemini, and Claude

---

## What TORIUM Is Not Yet

TORIUM is not yet:

- A full Urban OS
- A predictive investment engine
- A complete due diligence platform
- A construction risk model
- A legal decision system
- A replacement for architects, surveyors, engineers, or lawyers

At this stage, TORIUM is an intelligence assistant.

---

## Core Principle

Most real estate tools store information.

TORIUM should transform fragmented information into actionable intelligence.

The MVP is successful if, given a property, it can generate a clear, useful, and operationally relevant report that helps decide whether the opportunity deserves further human investigation.

---

## Initial Repository Structure

```text
torium/
├── README.md
├── docs/
│   └── mvp-scope.md
├── data/
│   ├── raw/
│   ├── processed/
│   └── whatsapp/
├── scrapers/
│   └── apify/
├── enrichment/
│   └── openapi/
├── rag/
│   ├── chunking/
│   ├── retrieval/
│   └── prompts/
├── outputs/
│   ├── deal-briefs/
│   └── risk-reports/
└── evals/
    └── model-comparison.md
```

---

## Status

Early-stage prototype.

The current priority is to build the first intelligence pipeline before expanding into deeper datasets, causal graphs, technical failure libraries, or operational acquisition workflows.
