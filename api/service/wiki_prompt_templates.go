package service

import "strings"

const WikiSummaryPrompt = `You are a wiki editor. Given the following document content, create a cohesive wiki summary page in Markdown format.

{{if .SourceContext}}<source_context>
{{.SourceContext}}
</source_context>
{{end}}
<document>
<content>
{{.Content}}
</content>
</document>

<available_wiki_pages>
{{.ExtractedSlugs}}
</available_wiki_pages>

<instructions>
1. The FIRST line of your output MUST be: SUMMARY: {one sentence, 15-40 words, describing what this document is about for wiki index listing}
2. The content above may be a stitched selection of windows from a longer document. Keep the response centered on document-level synthesis: treat it as one document and synthesize across the whole thing; do not mirror the window boundaries or write a per-chunk outline.
3. Use the <source_context> block, when present, as framing for tone and document type. Do not quote it verbatim.
4. After the SUMMARY line, write a full wiki article that feels like a distilled encyclopedia page, not a checklist or per-chunk note dump. Start with one opening paragraph that names the subject and the document's main conclusion.
5. Prefer 2-5 major theme sections with narrative paragraphs or dense bullets inside each section. Use short bullets only when they truly improve scanning.
6. Include the key facts, arguments, conclusions, figures, named entities, and any meaningful tensions or tradeoffs. Use domain-specific headings only when the source itself clearly supports them.
7. Keep the prose cohesive and explanatory. Avoid generic bookkeeping sections such as "Overview", "Key Facts", or "Sources" unless the document itself clearly calls for them.
   In Chinese summary pages, especially avoid headings like "概览"、"摘要"、"关键事实"、"来源"、"原始节选" unless the source content itself clearly uses that structure.
8. Whenever a name matches a listed wiki page, use [[slug|display name]] with the exact provided slug.
9. **Image rule**: If the document contains <images> tags with <image> elements, you SHOULD include the relevant images in your summary using the Markdown syntax: ![caption](url). Place the images where they are contextually relevant to the text. The URL inside ![caption](url) is an opaque token; reproduce it EXACTLY and VERBATIM, do not alter, shorten, or normalize it.
10. If the content is empty or non-substantive, output exactly: SUMMARY: No textual content was extractable from this document. Then add a brief explanation.
11. Write in {{.Language}}.
12. Do not turn the page into a per-chunk outline.
13. At the end, include a concise "## Key Takeaways" section with bullet points.
14. Aim for roughly 500-1500 words/characters depending on document length and language; stretch enough to preserve the document's full arc and preserve the document's main arc instead of compressing it into a generic digest.
</instructions>

Output the SUMMARY line first, then the Markdown content. Do not include any other preamble.`

const WikiKnowledgeExtractPrompt = `You are a knowledge extraction system. Analyze the following document and extract all significant entities AND key concepts.

<document>
<content>
{{.Content}}
</content>
</document>

<previous_slugs>
{{.PreviousSlugs}}
</previous_slugs>

<instructions>
Return a JSON object with two arrays: "entities" and "concepts".
**IMPORTANT: Write ALL names, descriptions, and details in {{.Language}}**.

If the <content> block above is empty, contains only image references with no extracted text, or otherwise carries no substantive information, return {"entities": [], "concepts": []}. Do NOT invent entities or concepts from any other source.

### Slug Continuity Rules
If previous slugs are provided above, you MUST follow these rules:
- If an entity or concept from the previous extraction still exists in the current document, **reuse its exact slug** from the previous list. Do NOT generate a new slug for the same thing.
- If an entity or concept no longer appears in the document, **do NOT include it** in the output.
- Only generate new slugs for entities/concepts that are genuinely new (not present in the previous list).
- This ensures slug stability across document updates.

### Entities (people, organizations, products, places, technologies, events, etc.)
Each entity should have:
- "name": The entity name in {{.Language}} (human-readable)
- "slug": URL-friendly slug, format "entity/<lowercase-hyphenated-name>" (use romanized/pinyin form for non-Latin names). **Reuse previous slug if the entity was extracted before.**
- "aliases": An array of strings representing names that refer to THE EXACT SAME entity. Only include: official abbreviations, full/short name variants, translations, and well-known alternate names. Do NOT include parent categories, related products, generic terms, or broader concepts. Provide [] if none.
- "description": **Index listing summary** — one sentence, 15-40 words, in {{.Language}}. Describes WHAT this entity IS and its role in the document. Must be self-contained (understandable without reading the full page). This will be displayed in the wiki index.
- "details": A 2-5 sentence summary in {{.Language}} of key facts from the document. **Image rule**: If the document contains relevant <image> elements in an <images> tag, include them in the details using Markdown syntax: ![caption](url). The URL inside ![caption](url) is an opaque token; reproduce it EXACTLY and VERBATIM, do not alter, shorten, or normalize it.

Only include entities that are substantively discussed (mentioned at least twice or described in detail). Do NOT include generic terms.

### Concepts (topics, themes, methodologies, theories, etc.)
Each concept should have:
- "name": The concept name in {{.Language}} (human-readable)
- "slug": URL-friendly slug, format "concept/<lowercase-hyphenated-name>" (use romanized/pinyin form for non-Latin names). **Reuse previous slug if the concept was extracted before.**
- "aliases": An array of strings representing names that refer to THE EXACT SAME concept. Only include: official abbreviations, full/short name variants, and well-known synonyms used interchangeably in the field. Do NOT include sub-topics, related techniques, broader categories, or implementation details. Provide [] if none.
- "description": **Index listing summary** — one sentence, 15-40 words, in {{.Language}}. Defines WHAT this concept IS. Must be self-contained (understandable without reading the full page). This will be displayed in the wiki index.
- "details": A 2-5 sentence explanation in {{.Language}} as discussed in the document. **Image rule**: If the document contains relevant <image> elements in an <images> tag, include them in the details using Markdown syntax: ![caption](url). The URL inside ![caption](url) is an opaque token; reproduce it EXACTLY and VERBATIM, do not alter, shorten, or normalize it.

Only include concepts that are substantively discussed. Skip trivial or overly generic concepts.

### Deduplication Rules
- If something is a specific named thing (person, company, product, place), put it ONLY in "entities".
- If something is an abstract idea, methodology, or theory, put it ONLY in "concepts".
- Never duplicate items across the two arrays.

### JSON Formatting Rules
- **CRITICAL**: Do NOT use literal newline characters inside JSON string values. If you need a newline in a string, you MUST use the escaped sequence \n.
</instructions>

Output ONLY valid JSON. Example:
{
  "entities": [
    {
      "name": "Acme Corp",
      "slug": "entity/acme-corp",
      "aliases": ["Acme", "Acme Corporation"],
      "description": "A technology company specializing in AI solutions.",
      "details": "Acme Corp was founded in 2020 and has grown to 500 employees. They focus on enterprise AI products and recently launched their flagship RAG platform."
    }
  ],
  "concepts": [
    {
      "name": "Retrieval-Augmented Generation",
      "slug": "concept/retrieval-augmented-generation",
      "aliases": ["RAG"],
      "description": "A technique that combines information retrieval with language model generation.",
      "details": "RAG works by first retrieving relevant documents from a knowledge base using vector similarity search, then feeding those documents as context to an LLM for answer generation."
    }
  ]
}`

const WikiIndexIntroPrompt = `You are a wiki editor. Write a brief introduction for a wiki knowledge base index page.

<document_summaries>
{{.DocumentSummaries}}
</document_summaries>

<instructions>
1. Write a title line starting with "# " that reflects the knowledge domain.
2. Follow with 2-3 sentences describing what this wiki covers, based on the document summaries above.
3. Keep it concise - this is just the header section, the directory listing will be added separately below.
4. Write in {{.Language}}.
</instructions>

Output ONLY the title and introduction paragraph. Do NOT generate any directory listings or page links.`

const WikiIndexIntroUpdatePrompt = `You are a wiki editor. Update the introduction section of a wiki index page to reflect recent changes.

<current_introduction>
{{.ExistingIntro}}
</current_introduction>

<changes>
{{.ChangeDescription}}
</changes>

<document_summaries>
{{.DocumentSummaries}}
</document_summaries>

<instructions>
1. Update the introduction to accurately reflect the current state of the wiki.
2. If documents were added, mention the new topics if they significantly change the wiki's scope.
3. If documents were removed, remove references to those topics if they no longer apply.
4. Keep the same tone, style, and title format as the existing introduction.
5. Keep it concise - 1 title line + 2-3 sentences.
6. Write in {{.Language}}.
</instructions>

Output ONLY the updated title and introduction paragraph. Do NOT generate any directory listings or page links.`

const WikiDeduplicationPrompt = `You are a strict deduplication system. Given a list of newly extracted items and a list of existing wiki pages, determine which new items refer to the **exact same** real-world entity or concept as an existing page.

<new_items>
{{.NewItems}}
</new_items>

<existing_pages>
{{.ExistingPages}}
</existing_pages>

<instructions>
### Merge criteria - ALL must be true:
1. The new item and the existing page refer to the **same real-world thing** (same person, same organization, same specific concept).
2. The match is a **name variation**: abbreviation -> full name, translation, or minor spelling difference.
3. The types are compatible: entities merge with entities, concepts merge with concepts. **Never merge an entity into a concept or vice versa.**

### Examples of CORRECT merges:
- "Acme Corp" -> "Acme Corporation" (same company, abbreviation)
- "RAG" -> "Retrieval-Augmented Generation" (same concept, acronym)
- "苹果公司" -> "Apple Inc." (same entity, translation)

### Examples of INCORRECT merges - do NOT merge these:
- "Hunyuan Model" -> "Qwen Model" (competing products in the same category are DIFFERENT entities, do not merge them)
- "iPhone 15" -> "Huawei Mate 60" (different specific instances in the same category)
- "GPT-4" -> "GPT-3.5" (different versions of a product are distinct entities)
- "AI Safety" -> "Content Review Mechanism" (related topics, but different concepts)
- "Athlete Registration" -> "Degree Verification" (both involve verification, but completely different domains)
- "Competition Categories" -> "Age Groups" (age groups are one aspect of categories, not the same concept)
- "Performance Standard" -> "Competition Rounds" (both relate to competitions, but are different concepts)
- "Machine Learning" -> "Neural Networks" (neural networks are a subset of ML, not the same concept)
- "居民身份证 / Resident ID Card" -> "工作居住证 / Work Residence Permit" (both are government-issued documents but completely different credentials)
- "驾驶证 / Driver's License" -> "行驶证 / Vehicle Registration" (both are car-related certificates but different documents)
- "学位证 / Degree Certificate" -> "毕业证 / Graduation Certificate" (both educational documents but distinct credentials)

### Key principle: **related != same**. Two items sharing a few characters in their name, or belonging to the same domain / document family / industry, is NOT a reason to merge. **ABSOLUTELY DO NOT** merge different products, different companies, different versions, or different certificates/documents just because they belong to the same category. When in doubt, do NOT merge. It is far better to have two separate pages for the same thing than to wrongly merge two different things.

Return a JSON object with a "merges" map. The key is the NEW item's slug, the value is the EXISTING page's slug that it should merge into. Only include items where you are highly confident they are the same thing.

If no items match any existing pages, return: {"merges": {}}

### JSON Formatting Rules
- **CRITICAL**: Do NOT use literal newline characters inside JSON string values. If you need a newline in a string, you MUST use the escaped sequence \n.
</instructions>

Output ONLY valid JSON. Example:
{"merges": {"entity/acme-corporation": "entity/acme-corp", "concept/rag": "concept/retrieval-augmented-generation"}}`

const (
	WikiGranularityGuidanceFocused = `**FOCUSED mode - aggressive pruning.**
Extract ONLY the document's primary subjects: the handful of entities/concepts that this document is fundamentally ABOUT.

INCLUDE:
- The document's main subject(s) - e.g. for a resume: the person and their named projects; for an announcement: the announcing organization and the event/product being announced; for a product page: the product itself and its maker.
- At most 3-7 items total across entities and concepts combined.

EXCLUDE (even if named explicitly):
- Technology stacks / libraries / frameworks mentioned in passing (e.g. a resume listing "Spring Boot, MySQL, Redis" - do NOT extract these).
- Generic concepts and methodologies that are merely referenced (e.g. "microservices", "async processing", "stateless authentication", "streaming response" mentioned as an implementation detail).
- Places, schools, or organizations mentioned only as background (e.g. alma mater of a resume owner, unless the document is ABOUT the school itself).
- Anything that would normally get a one-sentence description because there is not enough content to say more.

If you are unsure whether an item belongs, LEAVE IT OUT. A clean, focused index is more valuable than a comprehensive but noisy one.`

	WikiGranularityGuidanceStandard = `**STANDARD mode - balanced (default).**
Extract the document's main subjects PLUS entities/concepts that are substantively discussed - meaning they have a dedicated paragraph, multiple bullet points, or at least 2-3 sentences of context.

INCLUDE:
- The document's main subject(s).
- Secondary entities/concepts that receive a concrete block of content (a paragraph, a multi-point list, or a dedicated sub-section).
- Named methodologies, architectures, or techniques when the document explains HOW the subject uses them - not merely names them.

EXCLUDE:
- Items mentioned only in a comma-separated list of technologies without any further explanation (e.g. "Tech stack: A, B, C, D" - none of A/B/C/D are extracted unless they each also receive their own paragraph elsewhere).
- One-off mentions, parenthetical references, and generic infrastructure nouns.
- Items whose entire contribution to the document would fit in a single short sentence.

Aim for a tight, curated index. When in doubt about a marginal item, prefer to EXCLUDE it.`

	WikiGranularityGuidanceExhaustive = `**EXHAUSTIVE mode - maximum recall.**
Extract every named entity and every recognizable concept, including technologies, tools, standards, and methodologies mentioned even once by name, provided they are concrete and well-known (not generic terms like "database" or "function").

INCLUDE:
- All main and secondary subjects.
- All named technologies, libraries, frameworks, databases, services, protocols, or standards.
- All recognizable concepts and methodologies that have widely-used names (e.g. RAG, microservices, async processing, SSE, JWT).

EXCLUDE ONLY:
- Truly generic terms (e.g. "server", "function", "data").
- Items that appear only inside URL paths or reference citations.

Use this mode when the knowledge base functions as a technical glossary rather than a curated narrative wiki.`
)

func WikiGranularityGuidance(granularity string) string {
	switch strings.TrimSpace(strings.ToLower(granularity)) {
	case "focused":
		return WikiGranularityGuidanceFocused
	case "exhaustive":
		return WikiGranularityGuidanceExhaustive
	default:
		return WikiGranularityGuidanceStandard
	}
}

const WikiCandidateSlugPrompt = `You are a knowledge extraction system. Analyze the following document and list all significant entities AND key concepts as a lightweight candidate set. Another pass will later attach concrete supporting chunks to each item, so you do NOT need to write exhaustive per-item facts here.

{{if .SourceContext}}<source_context>
{{.SourceContext}}
</source_context>
{{end}}
<document>
<content>
{{.Content}}
</content>
</document>

<previous_slugs>
{{.PreviousSlugs}}
</previous_slugs>

<instructions>
Return a JSON object with two arrays: "entities" and "concepts".
The content above may be a stitched selection of windows from a longer document. Treat it as one document and extract durable wiki topics from the whole thing, not from one local window.
Use the <source_context> block, when present, to understand the document type and extraction framing, but do not quote it verbatim.
Write all names, descriptions, and details in {{.Language}}.
### Extraction Scope (Granularity: {{.Granularity}})
{{.GranularityGuidance}}

Rules:
- Reuse an exact previous slug when the same entity or concept already exists.
- Entities and concepts must not duplicate each other.
- "description" should be a self-contained, one-sentence wiki index summary.
- "details" is only a short fallback summary, not the full page body.
- Do not promote names that are only mentioned in passing, generic technologies in a stack list, or background references that are not central to the document.
- Prefer durable wiki topics that the document is actually about.
- Do not use literal newlines inside JSON string values.
- If the content is empty or non-substantive, return {"entities": [], "concepts": []}.
</instructions>

Output ONLY valid JSON.`

const WikiChunkCitationPrompt = `You are a precise citation system. Scan the document chunks and decide which chunks substantively discuss each candidate slug.

<instructions>
For every slug in <candidate_slugs>, cite only chunk ids from <chunks> that contain concrete supporting information.
- Omit candidates that are not meaningfully discussed in this batch.
- A chunk may support multiple candidates.
- You may add genuinely new significant slugs under "new_slugs".
- Each new slug must include: "type", "name", "slug", "aliases", "description", "details", and "source_chunks".
- Prefer the smallest set of chunks that really support the page, rather than over-citing every mention.
- Output only valid JSON and do not use literal newlines inside JSON string values.
</instructions>

Output format:
{
  "citations": {
    "entity/example": ["c001"]
  },
  "new_slugs": []
}

{{if .SourceContext}}<source_context>
{{.SourceContext}}
</source_context>
{{end}}
<candidate_slugs>
{{.CandidateSlugs}}
</candidate_slugs>

<chunks>
{{.ChunksXML}}
</chunks>

Now output ONLY the JSON in {{.Language}} where user-facing text is needed.`

const WikiPageModifyPrompt = `You are a wiki compiler tasked with updating an existing wiki page using new source chunks and optional deleted-source retractions.

### STRICT CITATION & MERGE RULES (CRITICAL):
1. Preserve citations: when merging new information with existing content, keep valid inline citations where they already exist.
2. Mandatory tracing: any newly added factual claim, entity, or numerical data must be grounded in the provided source chunks.
3. No hallucination: do not invent, synthesize, or infer information that is not explicitly present in the provided source material.

<page_metadata>
  <slug>{{.PageSlug}}</slug>
  <title>{{.PageTitle}}</title>
  <type>{{.PageType}}</type>
  {{if .PageAliases}}<aliases>{{.PageAliases}}</aliases>{{end}}
</page_metadata>

<existing_page_content>
{{.ExistingContent}}
</existing_page_content>

{{if .HasAdditions}}<new_information>
{{.NewContent}}
</new_information>
{{end}}{{if .HasRetractions}}<deleted_documents>
{{.DeletedContent}}
</deleted_documents>

<remaining_source_documents>
{{.RemainingSourcesContent}}
</remaining_source_documents>
{{end}}

<valid_wiki_links>
{{.AvailableSlugs}}
</valid_wiki_links>

<instructions>
1. The FIRST line of your output MUST be: SUMMARY: {one sentence, 15-40 words, describing the updated page for wiki index listing}
2. This page is about exactly {{.PageTitle}}. Do not drift to related, adjacent, or similarly named things.
3. Preserve valid existing information and remove facts that only came from deleted sources.
4. Add only information that is directly about {{.PageTitle}} and stay close to the source wording.
5. Use the <new_information> block as the evidence base. It may include a <source_context> block for tone and document-type framing, including page_type, page_title, aliases, document_summary, and tag; use it, but do not quote it verbatim.
6. Favor a natural wiki article over a metadata checklist. Avoid introducing new generic sections like "Overview", "Key Facts", or "Sources" unless the source itself clearly justifies them.
   In Chinese pages, especially avoid mechanical sections such as "概览"、"关键事实"、"来源"、"原始节选" unless the source itself explicitly uses them.
7. Keep or add inline chunk citations if source chunks expose them, and preserve valid [[slug|name]] references whose slug exists in <valid_wiki_links>. Never self-link the page slug. When adding a new citation, use one complete bracketed token only, preferably [source: file:<file_id>#<chunk_id>]; do not emit bare file:<file_id>#<chunk_id> text, split prefixes like [source:, or mixed partial wrappers.
8. Use "# {{.PageTitle}}" as the top heading if needed.
9. {{if eq .PageType "entity"}}For entity pages, prefer a human wiki entry shape: one opening paragraph that states who or what this is, then 2-5 short sections that emerge naturally from the evidence. The page should read like a biography or encyclopedia entry, not a dashboard card or metadata sheet. Use labels only when the evidence supports them, and avoid forcing a canned outline.{{else if eq .PageType "concept"}}For concept pages, prefer a concise explanatory entry with sections such as 定义、背景、作用、做法、相关概念 only when the source supports them.{{else if eq .PageType "summary"}}For summary pages, write a compact but complete document synopsis: 2-5 major themes, a short conclusion, and a concise "## Key Takeaways" section. Do not turn the page into a per-chunk outline.{{end}}
10. Write in {{.Language}}.
11. If page_type is summary, write a compact but complete document synopsis: start with one opening paragraph, then 2-5 major theme sections with concrete facts and updates, and finish with a short takeaway only when it genuinely helps the reader scan the page. Do not turn the page into a per-chunk outline.
12. If after removing deleted content the page becomes nearly empty and there is no new information to add, output just: "SUMMARY: (empty page)\n# {{.PageTitle}}\n\n*This page's primary source document was removed.*"
</instructions>

Output the SUMMARY line first, then the updated Markdown content. Do not include any other preamble.`

const WikiTaxonomyPrompt = `You are organizing wiki pages into a navigation taxonomy. Assign each item to a stable directory path so the batch lands on one coherent tree.

<existing_folders>
{{.ExistingTaxonomy}}
</existing_folders>

<items>
{{.Items}}
</items>

<instructions>
For every item, output a category path as an array of folder labels from broad to narrow, at most 2 levels.
- Reuse an exact existing folder label whenever it already fits.
- If no existing folder fits, create a broad durable folder rather than leaving the item uncategorized.
- Use [] only when the item truly has no durable subject category.
- Do not use literal newlines inside JSON string values.
- Write folder labels in {{.Language}}.
</instructions>

Output format:
{
  "assignments": [
    {"slug": "entity/example", "path": ["People"]}
  ]
}

Output ONLY valid JSON.`

const WikiTaxonomyPlanPrompt = WikiTaxonomyPrompt
