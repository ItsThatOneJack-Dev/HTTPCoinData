const express = require('express');
const https = require('https');
const zlib = require('zlib');
const cors = require('cors');

// Try MongoDB ZSTD package: npm install @mongodb-js/zstd
let zstd = null;

const app = express();
const port = 8080;

app.use(cors({
    origin: '*',
    methods: ['GET'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Store the latest data
let latestData = null;
let lastFetchTime = null;
let fetchError = null;

// Initialize ZSTD
async function initZstd() {
    try {
        zstd = require('@mongodb-js/zstd');
        console.log('✅ ZSTD support initialized');
        return true;
    } catch (error) {
        console.log('⚠️  ZSTD not available. Install with: npm install @mongodb-js/zstd');
        console.log('⚠️  Falling back to other compression methods...');
        return false;
    }
}

// Function to make the API request
function fetchRugPlayData() {
    const options = {
        hostname: 'rugplay.com',
        port: 443,
        path: '/api/coin/HTTP?timeframe=1m',
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0',
            'Accept': '*/*',
            'Accept-Language': 'en-GB,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Referer': 'https://rugplay.com/coin/HTTP',
            'Connection': 'keep-alive',
            'Cookie': 'cf_clearance=33iwlz68jGBBlzm6A8cn0WQ6jrgB5nrmM9Di8AQS5Q8-1749432031-1.2.1.1-axCkq9bFiYuQ.2nj6DLUZeJ6jMjqP53fWXdB9RPaElpVFPXJhadNVkJLJYjU12KU_yIsSQoX4.tvY0GD1vbUzOnqNbT9O5_CdfZpaeTo2fF9G_tBl.aIHt2jEd4FOjnBtZu36jpySCL4kSNlgYQ_FHk1vI4VGn3Is1tMItCYrzI7gCqxKLNDb0zYqowQd29e2M8s5fLQdVUrJ0jVlzHFT1oShWi3oGvDL2NlbWmSElGq_OBKyh6Elr9QMVELLxkxANkTZM3_M7KhphifWHCkiUDpL4iCUXkOYPa9nT72IeqXIrksVGopmlRVcgTM9AvfWfo.7lqggr35siaVmygaD6hEyijajra4HI_qLMI0_qGc; sidebar:state=true',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Priority': 'u=4',
            'TE': 'trailers'
        }
    };

    const req = https.request(options, (res) => {
        let rawData = [];

        res.on('data', (chunk) => {
            rawData.push(chunk);
        });

        res.on('end', async () => {
            try {
                // Combine all chunks into a single buffer
                const buffer = Buffer.concat(rawData);
                let decompressedData;

                // Check content encoding and decompress accordingly
                const encoding = res.headers['content-encoding'];
                console.log(`Content-Encoding: ${encoding}, Response size: ${buffer.length} bytes`);

                if (encoding === 'gzip') {
                    decompressedData = zlib.gunzipSync(buffer);
                    console.log('🗜️  Decompressed GZIP data');
                } else if (encoding === 'deflate') {
                    decompressedData = zlib.inflateSync(buffer);
                    console.log('🗜️  Decompressed DEFLATE data');
                } else if (encoding === 'br') {
                    decompressedData = zlib.brotliDecompressSync(buffer);
                    console.log('🗜️  Decompressed Brotli data');
                } else if (encoding === 'zstd') {
                    if (zstd) {
                        // MongoDB ZSTD decompress returns a Promise
                        decompressedData = await zstd.decompress(buffer);
                        console.log('🗜️  Decompressed ZSTD data');
                    } else {
                        throw new Error('ZSTD support not available. Install with: npm install @mongodb-js/zstd');
                    }
                } else {
                    // No compression or unknown compression
                    decompressedData = buffer;
                    console.log('📄 No compression detected');
                }

                const jsonString = decompressedData.toString('utf8');
                console.log(`Decompressed data length: ${jsonString.length} characters`);
                console.log(`First 100 chars: ${jsonString.substring(0, 100)}`);
                
                const jsonData = JSON.parse(jsonString);
                
                latestData = jsonData;
                lastFetchTime = new Date().toISOString();
                fetchError = null;
                console.log(`✅ Data fetched and parsed successfully at ${lastFetchTime}`);
            } catch (error) {
                fetchError = `Processing error: ${error.message}`;
                console.error(`❌ Failed to process response: ${error.message}`);
                console.error(`Content-Encoding: ${res.headers['content-encoding']}`);
                console.error(`Status Code: ${res.statusCode}`);
                console.error(`Response Headers:`, res.headers);
                console.error(`Raw response length: ${Buffer.concat(rawData).length} bytes`);
                
                // Log first few bytes as hex for debugging
                const firstBytes = Buffer.concat(rawData).slice(0, 20);
                console.error(`First 20 bytes (hex): ${firstBytes.toString('hex')}`);
            }
        });
    });

    req.on('error', (error) => {
        fetchError = `Request error: ${error.message}`;
        console.error(`❌ Request failed: ${error.message}`);
    });

    req.setTimeout(30000, () => {
        req.destroy();
        fetchError = 'Request timeout';
        console.error('❌ Request timed out');
    });

    req.end();
}

// API endpoint to serve the data
app.get('/data', (req, res) => {
    res.json({
        data: latestData,
        lastFetchTime: lastFetchTime,
        error: fetchError,
        status: latestData ? 'success' : (fetchError ? 'error' : 'no_data')
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        zstdSupport: zstd !== null
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'RugPlay API Fetcher',
        endpoints: {
            '/data': 'Get the latest fetched data',
            '/health': 'Health check'
        },
        zstdSupport: zstd !== null
    });
});

// Start the server
async function startServer() {
    // Initialize ZSTD support first
    await initZstd();
    
    app.listen(port, '0.0.0.0', () => {
        console.log(`🚀 Server running on http://0.0.0.0:${port}`);
        
        // Fetch data immediately on startup
        console.log('📡 Fetching initial data...');
        fetchRugPlayData();
        
        // Set up interval to fetch data every minute
        setInterval(() => {
            console.log('📡 Fetching data...');
            fetchRugPlayData();
        }, 60000); // 60000ms = 1 minute
    });
}

// Start the server
startServer();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});
