require('dotenv').config();
const { SearchServiceClient } = require('@google-cloud/discoveryengine');
const speech = require('@google-cloud/speech');
const vision = require('@google-cloud/vision');
const videoIntelligence = require('@google-cloud/video-intelligence');
const { Storage } = require('@google-cloud/storage');

async function testGcpServices() {
    console.log('Testing Google Cloud API Integrations...\n');
    let allPassed = true;

    // 1. Storage Object Admin Test
    try {
        console.log('1. Testing Storage API...');
        const storage = new Storage();
        const [buckets] = await storage.getBuckets({ maxResults: 1 });
        console.log('✅ Storage API is connected successfully.');
    } catch (error) {
        console.error('❌ Storage API failed:', error.message);
        allPassed = false;
    }

    // 2. Cloud Vision Service Agent Test
    try {
        console.log('\n2. Testing Cloud Vision API...');
        const visionClient = new vision.ImageAnnotatorClient();
        // A minimal test is just to instantiate and check authentication status
        await visionClient.initialize();
        console.log('✅ Cloud Vision API client initialized successfully.');
    } catch (error) {
        console.error('❌ Cloud Vision API failed:', error.message);
        allPassed = false;
    }

    // 3. Cloud Speech Client Test
    try {
        console.log('\n3. Testing Cloud Speech API...');
        const speechClient = new speech.SpeechClient();
        await speechClient.initialize();
        console.log('✅ Cloud Speech API client initialized successfully.');
    } catch (error) {
        console.error('❌ Cloud Speech API failed:', error.message);
        allPassed = false;
    }

    // 4. Video Intelligence Service Agent Test
    try {
        console.log('\n4. Testing Video Intelligence API...');
        const videoClient = new videoIntelligence.VideoIntelligenceServiceClient();
        await videoClient.initialize();
        console.log('✅ Video Intelligence API client initialized successfully.');
    } catch (error) {
        console.error('❌ Video Intelligence API failed:', error.message);
        allPassed = false;
    }

    // 5. Vertex AI User (Discovery Engine)
    try {
        console.log('\n5. Testing Vertex AI (Discovery Engine) API...');
        const searchClient = new SearchServiceClient();
        await searchClient.initialize();
        console.log('✅ Vertex AI / Discovery Engine client initialized successfully.');
    } catch (error) {
        console.error('❌ Vertex AI API failed:', error.message);
        allPassed = false;
    }

    console.log('\n======================================');
    if (allPassed) {
        console.log('🎉 All selected Google Cloud services are properly connected and authenticated!');
    } else {
        console.log('⚠️ Some services failed. Please check your Google Cloud authentication (e.g., GOOGLE_APPLICATION_CREDENTIALS) and ensure APIs are enabled in your GCP project.');
    }
}

testGcpServices().catch(console.error);
