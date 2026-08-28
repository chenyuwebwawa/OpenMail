# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules

- Never use emojis in code, comments, or documentation.
- Do not include Claude as a co-contributor in commit messages.
- Use Conventional Commit format for all commit messages.
- Keep the year in LICENSE up to date.

## Project Overview

VMC (Verified Mark Certificate) is a Node.js library for parsing and validating VMC/CMC logo files used in BIMI (Brand Indicators for Message Identification) email authentication.

## Commands

```bash
# Run tests (includes linting)
npm test

# Run linting only
npx eslint .

# Run tests only (without linting)
npx mocha --recursive "./test/**/*.js" --reporter spec

# Run a single test file
npx mocha test/parse-vmc-test.js

# Format code
npm run format

# Rebuild root certificate store from PEM files in data/root-store/
npm run root-store
```

## Architecture

### Main Entry Point

- `lib/vmc.js` - Exports `vmc()` function and `RootStore` class. Takes a PEM certificate bundle, validates the chain, parses the logo, and returns logo data with certificate info.

### Core Modules

- `lib/parse-vmc.js` - ASN.1 parser for VMC certificates. Extracts embedded SVG logos from the logotype extension (OID 1.3.6.1.5.5.7.1.12). Handles gzip-compressed data URLs.
- `lib/validated-chain.js` - Certificate chain validation. Verifies chain integrity, expiration dates, CA flags, and BIMI Extended Key Usage (OID 1.3.6.1.5.5.7.3.31).
- `lib/root-store.js` - `RootStore` class manages trusted root certificates loaded from `data/root-store.json`.
- `lib/cert-info.js` - Extracts human-readable certificate information (subject, issuer, dates, etc.).
- `lib/tools.js` - Utilities: PEM bundle parsing, certificate loading, subject parsing with VMC-specific OIDs.

### Data Files

- `data/root-store/` - Source PEM files for trusted VMC root certificates
- `data/root-store.json` - Generated JSON array of root certificates (built via `npm run root-store`)

### Root Certificate Issuers

Reference: https://bimigroup.org/vmc-issuers/

| Issuer     | File                                                             | Status                                                                     |
| ---------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| DigiCert   | `digicert.pem`                                                   | Active                                                                     |
| GlobalSign | `gsverifiedmarkrootr42.pem`                                      | Active                                                                     |
| SSL.com    | `SSL.com-VMC-Root-2024-ECC.pem`, `SSL.com-VMC-Root-2024-RSA.pem` | Active                                                                     |
| Entrust    | `entrust_vmc_specific.pem`                                       | Removed from BIMI issuers page (Feb 2025), kept for backward compatibility |

### VMC-Specific OIDs

The library handles these trademark-related OIDs in certificate subjects:

- `1.3.6.1.4.1.53087.1.2` - trademarkOfficeName
- `1.3.6.1.4.1.53087.1.3` - trademarkCountryOrRegionName
- `1.3.6.1.4.1.53087.1.4` - trademarkRegistration
- `1.3.6.1.4.1.53087.1.6` - wordMark
- `1.3.6.1.4.1.53087.1.13` - markType (determines VMC vs CMC type)

## Testing

Tests use Mocha + Chai. Test fixtures are PEM certificate bundles in `test/fixtures/`.
