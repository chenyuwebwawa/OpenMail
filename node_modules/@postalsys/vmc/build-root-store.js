'use strict';

// Root certificates from https://bimigroup.org/vmc-issuers/

const path = require('path');
const fs = require('fs').promises;
const { parsePemBundle } = require('./lib/tools');

const ROOT_STORE_DIR = path.join(__dirname, 'data', 'root-store');
const OUTPUT_FILE = path.join(__dirname, 'data', 'root-store.json');

async function main() {
    const files = await fs.readdir(ROOT_STORE_DIR);
    const pemFiles = files.filter(file => file.endsWith('.pem'));

    const rootCerts = [];
    for (const file of pemFiles) {
        const content = await fs.readFile(path.join(ROOT_STORE_DIR, file));
        const certs = parsePemBundle(content);
        rootCerts.push(...certs);
    }

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(rootCerts, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
