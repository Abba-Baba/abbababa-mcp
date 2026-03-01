#!/usr/bin/env node
/**
 * Abba Baba Wallet Generator
 *
 * Generates a fresh EOA wallet for agent registration.
 * The private key is saved to .abbababa-wallet (chmod 600) — never printed to stdout.
 *
 * Usage:
 *   node scripts/generate-wallet.mjs
 *
 * Pipe-friendly (prints only the export command for scripting):
 *   eval $(node scripts/generate-wallet.mjs --export)
 *   WARNING: --export prints the private key to stdout. Only use in a private terminal session.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { writeFileSync } from 'fs';

const exportMode = process.argv.includes('--export');

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

if (exportMode) {
  // Machine-readable: emit the export command for eval.
  // Warn on stderr so the key itself is the only thing on stdout.
  process.stderr.write('WARNING: private key is being written to stdout (--export mode). Use only in a private terminal.\n');
  process.stdout.write(`export ABBABABA_AGENT_PRIVATE_KEY="${privateKey}"\n`);
  process.exit(0);
}

// ── ANSI colours ─────────────────────────────────────────────────────────────
const bold   = (s) => `\x1b[1m${s}\x1b[0m`;
const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan   = (s) => `\x1b[36m${s}\x1b[0m`;
const dim    = (s) => `\x1b[2m${s}\x1b[0m`;

console.log(`\n${bold('╔══════════════════════════════════════════════╗')}`);
console.log(`${bold('║')}     ${cyan('Abba Baba')} Wallet Generator               ${bold('║')}`);
console.log(`${bold('╚══════════════════════════════════════════════╝')}\n`);

// Save private key to file (chmod 600) — never print to stdout
const walletFile = '.abbababa-wallet';
writeFileSync(walletFile, privateKey + '\n', { mode: 0o600 });

console.log(`  ${bold('Address')}     ${green(account.address)}`);
console.log(`  ${bold('Key file')}    ${cyan(walletFile)} ${dim('(chmod 600)')}\n`);

console.log(`  ${bold(yellow('⚠  Private key saved to file — NOT shown on screen'))}`);
console.log(`  ${dim('•')} View it privately: ${cyan(`cat ${walletFile}`)}`);
console.log(`  ${dim('•')} Then store it in a password manager and delete the file`);
console.log(`  ${dim('•')} Add ${bold(walletFile)} to your .gitignore immediately`);
console.log(`  ${dim('•')} Never share, commit, or paste it into any chat\n`);

console.log(`  ${bold('Next steps:')}`);
console.log(`  ${dim('1.')} Copy the private key to your password manager:`);
console.log(`       ${cyan(`cat ${walletFile}`)}`);
console.log(`  ${dim('2.')} Delete the file after copying:`);
console.log(`       ${cyan(`rm ${walletFile}`)}`);
console.log(`  ${dim('3.')} Fund the address with ≥$1 USDC on Base Sepolia (testnet):`);
console.log(`       ${cyan('https://faucet.circle.com')} — select Base Sepolia, paste your address`);
console.log(`  ${dim('4.')} Set the key in your current shell session:`);
console.log(`       ${cyan('export ABBABABA_AGENT_PRIVATE_KEY=<paste-key-here>')}`);
console.log(`  ${dim('5.')} Run: ${cyan('ABBABABA_AGENT_NAME="My Agent" node scripts/register.mjs')}\n`);
