'use strict';

const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended
});

module.exports = [
    {
        ignores: ['node_modules/**']
    },
    ...compat.extends('nodemailer', 'prettier'),
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'script',
            globals: {
                BigInt: 'readonly'
            }
        },
        rules: {
            'no-await-in-loop': 0,
            'require-atomic-updates': 0
        }
    }
];
