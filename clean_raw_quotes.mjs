#!/usr/bin/env node

import fs from "node:fs/promises";

const INPUT_PATH = "raw_quites.txt";
const JSON_OUTPUT_PATH = "cleaned_quotes.json";
const TEXT_OUTPUT_PATH = "cleaned_quotes_preview.txt";
const JS_OUTPUT_PATH = "cleaned_quotes.js";

function normalizeWhitespace(value) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeInline(value) {
  return normalizeWhitespace(value).replace(/\s*\n\s*/g, " ").trim();
}

function isSectionMarker(line) {
  return /^[A-Z]$/.test(line) || line === "0-9" || line === "Unattributed";
}

function isHeader(line) {
  return line === "Thought for the day\tSource" || line === "Speaker\tQuote" || line === "Tome\tQuote";
}

function looksLikeSourceContinuation(line) {
  return /^(pg\.|pgs\.|vol\.|chapter|inscriptions|menu |text-|[A-Z][A-Za-z ]+ \d|\(?corrected|Warhammer|Codex|White Dwarf|Imperial Armour|Dark Heresy|Only War|Index Astartes|Tactica|Regimental Standard|Dredge Runners|Rogue Trader|Chapter Approved)/i.test(line)
    || /\barchive description$/i.test(line);
}

function cleanReferenceMarkers(value) {
  return value
    .replace(/\[[0-9]+[a-z]?\]/gi, "")
    .replace(/\[Note [0-9]+\]/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1");
}

function cleanText(value) {
  return cleanReferenceMarkers(normalizeWhitespace(value))
    .replace(/\s*\n\s*—\s*/g, "\n— ")
    .trim();
}

function cleanSource(value) {
  return cleanReferenceMarkers(normalizeInline(value))
    .replace(/\s*;\s*/g, "; ")
    .replace(/40,\s+000/g, "40,000")
    .trim();
}

function makeEntry(record, index) {
  if (!record) return null;
  const text = cleanText(record.text || "");
  const source = cleanSource(record.source || "");
  const speaker = cleanSource(record.speaker || "");
  if (!text || text.length < 2) return null;
  return {
    id: `quote-${String(index).padStart(4, "0")}`,
    type: record.type,
    section: record.section || null,
    speaker: speaker || null,
    text,
    source: source || null
  };
}

function dedupe(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = `${entry.type}\n${entry.speaker || ""}\n${entry.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function parseRaw(raw) {
  const lines = raw.replace(/\r/g, "").split("\n");
  const records = [];
  let mode = null;
  let section = null;
  let current = null;
  let pending = [];

  function flush() {
    if (!current) return;
    records.push(current);
    current = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (current?.type === "speaker") current.text += "\n";
      continue;
    }

    if (isSectionMarker(line)) {
      flush();
      section = line;
      pending = [];
      continue;
    }

    if (isHeader(line)) {
      flush();
      mode = line.startsWith("Thought") ? "thought" : line.startsWith("Tome") ? "tome" : "speaker";
      pending = [];
      continue;
    }

    if (line.includes("\t")) {
      flush();
      const [left, ...rightParts] = line.split("\t");
      const right = rightParts.join("\t").trim();

      if (mode === "speaker" || mode === "tome") {
        const speaker = [...pending, left.trim()].filter(Boolean).join(" ");
        current = {
          type: mode,
          section,
          speaker: mode === "speaker" ? speaker : "",
          text: right,
          source: mode === "tome" ? speaker : ""
        };
      } else {
        const quote = [...pending, left.trim()].filter(Boolean).join("\n");
        current = {
          type: "thought",
          section,
          speaker: "",
          text: quote,
          source: right
        };
      }

      pending = [];
      continue;
    }

    if (!current) {
      pending.push(line);
      continue;
    }

    if (current.type === "thought") {
      if (looksLikeSourceContinuation(line)) {
        current.source = current.source ? `${current.source}\n${line}` : line;
      } else if (current.source) {
        flush();
        pending = [line];
      } else {
        current.text = `${current.text}\n${line}`;
      }
    } else {
      current.text = current.text ? `${current.text}\n${line}` : line;
    }
  }

  flush();
  return dedupe(records.map((record, index) => makeEntry(record, index + 1)).filter(Boolean));
}

function buildPreview(entries) {
  return entries.map((entry) => {
    const speaker = entry.speaker ? ` [${entry.speaker}]` : "";
    const source = entry.source ? `\nSOURCE: ${entry.source}` : "";
    return `${entry.id} ${entry.type.toUpperCase()}${speaker}\n${entry.text}${source}`;
  }).join("\n\n---\n\n");
}

const raw = await fs.readFile(INPUT_PATH, "utf8");
const entries = parseRaw(raw);
const output = {
  generated_at: new Date().toISOString(),
  input: INPUT_PATH,
  count: entries.length,
  entries
};

await fs.writeFile(JSON_OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
await fs.writeFile(TEXT_OUTPUT_PATH, `${buildPreview(entries)}\n`);
await fs.writeFile(JS_OUTPUT_PATH, `window.COGITATOR_QUOTES = ${JSON.stringify(entries, null, 2)};\n`);
console.log(`Wrote ${JSON_OUTPUT_PATH}, ${TEXT_OUTPUT_PATH}, and ${JS_OUTPUT_PATH} with ${entries.length} entries`);
