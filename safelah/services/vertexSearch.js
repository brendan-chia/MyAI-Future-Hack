/**
 * vertexSearch.js — Vertex AI Search (Discovery Engine) integration
 *
 * Queries AND writes to the SafeLah scam data store.
 * Used as an additional enrichment layer alongside CCID Semak Mule.
 */

const {
  SearchServiceClient,
  DocumentServiceClient,
} = require('@google-cloud/discoveryengine').v1;

// ── Config from .env ────────────────────────────────────────────────────────
const PROJECT_ID   = process.env.VERTEX_PROJECT_ID   || 'safelah';
const LOCATION     = process.env.VERTEX_LOCATION     || 'global';
const ENGINE_ID    = process.env.VERTEX_ENGINE_ID     || 'safelah_1776526408007';
const DATASTORE_ID = process.env.VERTEX_DATASTORE_ID || 'safelah-starstruck';

// ── Client (lazy singleton) ─────────────────────────────────────────────────
let _client = null;

function getClient() {
  if (!_client) {
    // On Cloud Run, credentials are auto-discovered via the service account.
    // Locally, use GOOGLE_APPLICATION_CREDENTIALS env var pointing to the JSON key.
    const opts = {};
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      opts.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    _client = new SearchServiceClient(opts);
  }
  return _client;
}

/**
 * Build the serving config resource path.
 * For search apps (engines), use the engines path.
 * Falls back to dataStore path if engine is not set.
 */
function getServingConfig() {
  if (ENGINE_ID) {
    return `projects/${PROJECT_ID}/locations/${LOCATION}/collections/default_collection/engines/${ENGINE_ID}/servingConfigs/default_search`;
  }
  return `projects/${PROJECT_ID}/locations/${LOCATION}/collections/default_collection/dataStores/${DATASTORE_ID}/servingConfigs/default_search`;
}

// ── Simple in-memory cache ──────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 1800000; // 30 minutes

/**
 * Search the Vertex AI data store for scam intelligence.
 *
 * @param {string} query  – phone number, bank account, URL, or free text
 * @param {number} [pageSize=5] – max results to return
 * @returns {Promise<{ found: boolean, hits: number, results: object[], source: string }>}
 */
async function searchVertexAI(query, pageSize = 5) {
  if (!query || !query.trim()) {
    return { found: false, hits: 0, results: [], source: 'vertex_ai_search' };
  }

  const trimmed = query.trim();

  // Check cache
  const cached = cache.get(trimmed);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    console.log(`[vertex-search] cache hit for "${trimmed}"`);
    return cached.data;
  }

  try {
    const client = getClient();
    const servingConfig = getServingConfig();

    const request = {
      servingConfig,
      query: trimmed,
      pageSize,
    };

    console.log(`[vertex-search] querying: "${trimmed}"`);

    const [response] = await client.search(request, { autoPaginate: false });

    // Parse results
    const results = [];
    for (const result of response) {
      const doc = result.document;
      if (!doc) continue;

      // Extract structured data from the document
      const structData = doc.structData
        ? (typeof doc.structData.toJSON === 'function'
            ? doc.structData.toJSON()
            : doc.structData)
        : {};

      results.push({
        id: doc.id || doc.name,
        data: structData,
        derivedData: doc.derivedStructData
          ? (typeof doc.derivedStructData.toJSON === 'function'
              ? doc.derivedStructData.toJSON()
              : doc.derivedStructData)
          : {},
      });
    }

    const output = {
      found: results.length > 0,
      hits: results.length,
      results,
      source: 'vertex_ai_search',
    };

    // Cache the result
    cache.set(trimmed, { data: output, time: Date.now() });

    console.log(`[vertex-search] "${trimmed}" → ${results.length} hit(s)`);
    return output;
  } catch (err) {
    console.error('[vertex-search] error:', err.message);
    // Graceful degradation — Vertex AI being down must not crash the bot
    return { found: false, hits: 0, results: [], source: 'vertex_ai_unavailable', error: err.message };
  }
}

/**
 * Convenience: search for a phone number in the scam data store.
 */
async function searchPhone(phone) {
  return searchVertexAI(phone);
}

/**
 * Convenience: search for a bank account in the scam data store.
 */
async function searchBankAccount(account) {
  return searchVertexAI(account);
}

module.exports = { searchVertexAI, searchPhone, searchBankAccount, createDocumentInVertexAI };

// ── DocumentServiceClient (lazy singleton) ──────────────────────────────────
let _docClient = null;

function getDocClient() {
  if (!_docClient) {
    const opts = {};
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      opts.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    _docClient = new DocumentServiceClient(opts);
  }
  return _docClient;
}

/**
 * Build the parent resource path for the datastore branch.
 */
function getDatastoreParent() {
  return `projects/${PROJECT_ID}/locations/${LOCATION}/collections/default_collection/dataStores/${DATASTORE_ID}/branches/default_branch`;
}

/**
 * Write a new scam report document to the Vertex AI datastore.
 *
 * @param {object} report
 * @param {string} report.type          – 'phone' | 'url' | 'screenshot'
 * @param {string} [report.identifier]  – phone number, account, or URL
 * @param {string} report.scamType      – e.g. 'eWallet scam'
 * @param {string} [report.description] – free-text description
 * @param {string} [report.reportedBy]  – session username (anonymous if not logged in)
 * @returns {Promise<{ success: boolean, documentId?: string, error?: string }>}
 */
async function createDocumentInVertexAI(report) {
  try {
    const client = getDocClient();
    const parent = getDatastoreParent();

    // Build a stable-ish document ID: type_sanitizedIdentifier_timestamp
    const safePart = (report.identifier || 'unknown')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .slice(0, 40)
      .toLowerCase();
    const documentId = `${report.type}-${safePart}-${Date.now()}`;

    const structData = {
      fields: {
        report_type:  { stringValue: report.type || 'phone' },
        identifier:   { stringValue: report.identifier || '' },
        scam_type:    { stringValue: report.scamType || '' },
        description:  { stringValue: report.description || '' },
        reported_by:  { stringValue: report.reportedBy || 'anonymous' },
        reported_at:  { stringValue: new Date().toISOString() },
        source:       { stringValue: 'community_report_web' },
      },
    };

    const request = {
      parent,
      documentId,
      document: {
        id: documentId,
        structData,
      },
    };

    console.log(`[vertex-write] Creating document "${documentId}" in datastore ${DATASTORE_ID}`);
    const [doc] = await client.createDocument(request);
    console.log(`[vertex-write] ✅ Document created: ${doc.name}`);
    return { success: true, documentId };
  } catch (err) {
    console.error('[vertex-write] ❌ Failed to create document:', err.message);
    return { success: false, error: err.message };
  }
}

