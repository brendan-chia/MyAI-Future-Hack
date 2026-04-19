/**
 * Quick test: Vertex AI Search connection
 * Run:  node test-vertex.js
 */
require('dotenv').config();

const { searchVertexAI, searchPhone, searchBankAccount } = require('./vertexSearch');

async function main() {
  console.log('=== Vertex AI Search Connection Test ===\n');
  console.log('Config:');
  console.log('  Project ID :', process.env.VERTEX_PROJECT_ID);
  console.log('  Location   :', process.env.VERTEX_LOCATION);
  console.log('  Engine ID  :', process.env.VERTEX_ENGINE_ID);
  console.log('  DataStore  :', process.env.VERTEX_DATASTORE_ID);
  console.log('  Credentials:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
  console.log('');

  // Test 1: Generic search
  console.log('--- Test 1: Generic search for "scam" ---');
  const r1 = await searchVertexAI('scam');
  console.log('  Found:', r1.found, '| Hits:', r1.hits);
  if (r1.results.length > 0) {
    console.log('  First result:', JSON.stringify(r1.results[0], null, 2).slice(0, 300));
  }
  console.log('');

  // Test 2: Phone search
  console.log('--- Test 2: Phone search for "0123456789" ---');
  const r2 = await searchPhone('0123456789');
  console.log('  Found:', r2.found, '| Hits:', r2.hits);
  console.log('');

  // Test 3: Bank account search
  console.log('--- Test 3: Bank account search for "1234567890" ---');
  const r3 = await searchBankAccount('1234567890');
  console.log('  Found:', r3.found, '| Hits:', r3.hits);
  console.log('');

  if (r1.error || r2.error || r3.error) {
    console.log('⚠️  Some queries returned errors (see logs above).');
    console.log('   This may be expected if the data store is empty or still indexing.');
  } else {
    console.log('✅ Connection successful! Vertex AI Search is working.');
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
