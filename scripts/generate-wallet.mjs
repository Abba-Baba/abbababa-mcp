#!/usr/bin/env node
/**
 * Abba Baba Wallet Generator
 *
 * Generates a fresh EOA wallet for agent registration.
 * The private key is printed ONCE — store it in a password manager immediately.
 *
 * Usage:
 *   node scripts/generate-wallet.mjs
 *
 * Pipe-friendly (prints only the export command for scripting):
 *   eval $(node scripts/generate-wallet.mjs --export)
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const exportMode = process.argv.includes('--export');

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

if (exportMode) {
  // Machine-readable: just emit the export commands for eval
  process.stdout.write(`export ABBABABA_AGENT_PRIVATE_KEY="${privateKey}"\n`);
  process.exit(0);
}

// ── ANSI colours ─────────────────────────────────────────────────────────────
const bold   = (s) => `\x1b[1m${s}\x1b[0m`;
const green  = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red    = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan   = (s) => `\x1b[36m${s}\x1b[0m`;
const dim    = (s) => `\x1b[2m${s}\x1b[0m`;

console.log(`\n${bold('╔══════════════════════════════════════════════╗')}`);
console.log(`${bold('║')}     ${cyan('Abba Baba')} Wallet Generator               ${bold('║')}`);
console.log(`${bold('╚══════════════════════════════════════════════╝')}\n`);

console.log(`  ${bold('Address')}     ${green(account.address)}`);
console.log(`\n  ${bold(yellow('━━━ PRIVATE KEY (shown once — save it now) ━━━'))}`);
console.log(`\n  ${bold(red(privateKey))}\n`);
console.log(`  ${bold(yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))}\n`);

console.log(`  ${bold('⚠  Security reminders:')}`);
console.log(`  ${dim('•')} Store this key in a password manager — NOT a text file or note`);
console.log(`  ${dim('•')} Never share it, commit it, or paste it into any chat`);
console.log(`  ${dim('•')} If you lose it, you lose control of this wallet address\n`);

console.log(`  ${bold('Next steps:')}`);
console.log(`  ${dim('1.')} Copy the private key to your password manager`);
console.log(`  ${dim('2.')} Fund the address with ≥$1 USDC on Base Sepolia (testnet):`);
console.log(`       ${cyan('https://faucet.circle.com')} — select Base Sepolia, paste your address`);
console.log(`  ${dim('3.')} Set the key in your current shell session:`);
console.log(`       ${cyan(`export ABBABABA_AGENT_PRIVATE_KEY="${privateKey.slice(0, 10)}...${privateKey.slice(-6)}"`)}`);
console.log(`       ${dim('(copy the full key from above, not the truncated version)')}`);
console.log(`  ${dim('4.')} Run: ${cyan('ABBABABA_AGENT_NAME="My Agent" node scripts/register.mjs')}\n`);

console.log(`  ${dim('Or use the one-liner (generates key, sets env, opens register immediately):')}`);
console.log(`  ${cyan('eval $(node scripts/generate-wallet.mjs --export) && ABBABABA_AGENT_NAME="My Agent" node scripts/register.mjs')}\n`);
