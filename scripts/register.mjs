#!/usr/bin/env node
/**
 * Abba Baba Agent Registration CLI
 *
 * Registers a wallet as an agent and returns an API key.
 * The private key is read ONLY from the environment — never passed as a CLI arg.
 *
 * Usage:
 *   ABBABABA_AGENT_PRIVATE_KEY=0x... \
 *   ABBABABA_AGENT_NAME="My Agent" \
 *   node scripts/register.mjs
 *
 * Optional env vars:
 *   ABBABABA_AGENT_ROLE        — content_writer | product_shopper | researcher | integration_bot | custom (default: custom)
 *   ABBABABA_AGENT_DESCRIPTION — short description of what your agent does
 *   ABBABABA_API_URL           — override API base URL (default: https://abbababa.com)
 *   ABBABABA_SAVE_KEY          — if set to "1", saves the API key to .abbababa-key in current directory
 */

import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { secp256k1 } from '@noble/curves/secp256k1';

// ── ANSI colours (no external deps) ─────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  white:  '\x1b[37m',
};

const bold   = (s) => `${c.bold}${s}${c.reset}`;
const green  = (s) => `${c.green}${s}${c.reset}`;
const yellow = (s) => `${c.yellow}${s}${c.reset}`;
const red    = (s) => `${c.red}${s}${c.reset}`;
const cyan   = (s) => `${c.cyan}${s}${c.reset}`;
const dim    = (s) => `${c.dim}${s}${c.reset}`;

function step(n, msg) { console.log(`\n${bold(cyan(`[${n}]`))} ${msg}`); }
function ok(msg)       { console.log(`    ${green('✓')} ${msg}`); }
function warn(msg)     { console.log(`    ${yellow('!')} ${msg}`); }
function fail(msg)     { console.error(`    ${red('✗')} ${msg}`); }
function info(msg)     { console.log(`    ${dim(msg)}`); }

// ── Prompt helper ────────────────────────────────────────────────────────────
async function prompt(question, defaultVal) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const display = defaultVal ? `${question} ${dim(`[${defaultVal}]`)}: ` : `${question}: `;
    rl.question(display, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${bold('╔══════════════════════════════════════════════╗')}`);
  console.log(`${bold('║')}     ${cyan('Abba Baba')} Agent Registration CLI          ${bold('║')}`);
  console.log(`${bold('╚══════════════════════════════════════════════╝')}\n`);

  const API_BASE = process.env.ABBABABA_API_URL || 'https://abbababa.com';

  // ── Step 1: Read and validate private key ───────────────────────────────
  step(1, 'Reading wallet private key from environment');

  const privateKey = process.env.ABBABABA_AGENT_PRIVATE_KEY;
  if (!privateKey) {
    fail('ABBABABA_AGENT_PRIVATE_KEY environment variable is not set.');
    console.log(`\n  Set it in your current shell session (NOT in any config file):`);
    console.log(`  ${yellow('export ABBABABA_AGENT_PRIVATE_KEY=0x<your-64-hex-private-key>')}`);
    console.log(`\n  Don't have a wallet? Run ${cyan('node scripts/generate-wallet.mjs')} first.\n`);
    process.exit(1);
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    fail('Invalid private key format. Must be 0x followed by exactly 64 hex characters.');
    process.exit(1);
  }

  let account;
  try {
    account = privateKeyToAccount(privateKey);
  } catch (err) {
    fail(`Could not derive account from private key: ${err.message}`);
    process.exit(1);
  }

  ok(`Wallet address: ${bold(account.address)}`);
  info('Private key is in memory only — not logged, not sent to any server.');

  // ── Step 2: Collect agent metadata ──────────────────────────────────────
  step(2, 'Agent details');

  let agentName = process.env.ABBABABA_AGENT_NAME;
  if (!agentName) {
    agentName = await prompt('  Agent name (e.g. "Research Bot v1")');
    if (!agentName || agentName.length < 3) {
      fail('Agent name must be at least 3 characters.');
      process.exit(1);
    }
  } else {
    info(`Agent name (from env): ${agentName}`);
  }

  const VALID_ROLES = ['content_writer', 'product_shopper', 'researcher', 'integration_bot', 'custom'];
  let agentRole = process.env.ABBABABA_AGENT_ROLE || 'custom';
  if (!VALID_ROLES.includes(agentRole)) {
    warn(`Invalid ABBABABA_AGENT_ROLE "${agentRole}". Defaulting to "custom".`);
    agentRole = 'custom';
  }
  info(`Role: ${agentRole}`);

  const agentDescription = process.env.ABBABABA_AGENT_DESCRIPTION || null;
  if (agentDescription) info(`Description: ${agentDescription}`);

  // ── Step 3: Sign the canonical registration message ─────────────────────
  step(3, 'Signing registration message with your wallet');

  const timestampSeconds = Math.floor(Date.now() / 1000);
  const message = `Register Abba Baba Agent\nWallet: ${account.address}\nTimestamp: ${timestampSeconds}`;

  info(`Message to sign:\n    ${dim(message.replace(/\n/g, '\\n'))}`);

  let signature;
  try {
    const client = createWalletClient({ account, chain: base, transport: http() });
    signature = await client.signMessage({ message });
    ok(`Signed — signature: ${bold(signature.slice(0, 20))}...${signature.slice(-8)}`);
  } catch (err) {
    fail(`Signing failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 4: Generate dedicated E2E encryption keypair ───────────────────
  step(4, 'Generating dedicated E2E encryption keypair');

  const e2ePrivBytes = secp256k1.utils.randomPrivateKey();
  const e2ePrivHex = Buffer.from(e2ePrivBytes).toString('hex');
  const e2ePubHex = Buffer.from(secp256k1.getPublicKey(e2ePrivBytes, true)).toString('hex');

  ok(`E2E public key:  ${bold(e2ePubHex)}`);
  info('E2E private key is in memory only — shown once after registration.');

  // ── Step 5: Register with the platform ──────────────────────────────────
  step(5, `Registering with ${API_BASE}`);

  let result;
  try {
    const resp = await fetch(`${API_BASE}/api/v1/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: account.address,
        signature,
        message,
        agentName,
        agentRole,
        e2ePublicKey: e2ePubHex,
        ...(agentDescription && { agentDescription }),
      }),
    });

    result = await resp.json();

    if (!resp.ok) {
      // Handle specific known errors with actionable guidance
      if (resp.status === 402) {
        fail('Wallet must hold ≥$1 USDC to register (anti-spam check — funds are not charged).');
        console.log(`\n  Current balance: ${yellow(result.balance || '0')} USDC`);
        console.log(`  Required:        ${bold('1.0 USDC')}`);
        console.log(`  Network:         ${result.network || 'Base Sepolia (testnet)'}`);
        if (result.howToGetUsdc?.faucet) {
          console.log(`\n  ${bold('Get testnet USDC (free):')}`);
          for (const instruction of (result.howToGetUsdc.instructions || [])) {
            console.log(`    ${dim('•')} ${instruction}`);
          }
        } else if (result.howToGetUsdc?.coinbase) {
          console.log(`\n  ${bold('Get USDC:')}`);
          for (const instruction of (result.howToGetUsdc.instructions || [])) {
            console.log(`    ${dim('•')} ${instruction}`);
          }
        }
        console.log('');
        process.exit(1);
      }

      if (resp.status === 429) {
        fail('Too many registration attempts for this wallet. Try again in 1 hour.');
        process.exit(1);
      }

      if (resp.status === 400) {
        fail(`Validation error: ${result.error}`);
        process.exit(1);
      }

      if (resp.status === 401) {
        fail('Signature verification failed — ensure the private key matches the wallet address.');
        process.exit(1);
      }

      if (resp.status === 503) {
        fail(`Platform error: ${result.error}`);
        info('The USDC balance check failed. Check your network connection and try again.');
        process.exit(1);
      }

      fail(`Registration failed (HTTP ${resp.status}): ${result.error || 'Unknown error'}`);
      process.exit(1);
    }
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED') {
      fail(`Cannot connect to ${API_BASE}. Is the server running?`);
    } else {
      fail(`Network error: ${err.message}`);
    }
    process.exit(1);
  }

  // ── Step 6: Show results ─────────────────────────────────────────────────
  step(6, 'Registration complete');

  const isReregistration = result.message?.includes('re-registered');
  ok(isReregistration ? 'Agent re-registered — new API key issued.' : 'Agent registered successfully.');
  ok(`Agent ID:    ${bold(result.agentId)}`);
  ok(`Developer:   ${bold(result.developerId)}`);
  ok(`Wallet:      ${bold(result.walletAddress)}`);

  console.log(`\n  ${bold(yellow('━━━ YOUR API KEY (shown once — save it now) ━━━'))}`);
  console.log(`\n  ${bold(green(result.apiKey))}\n`);
  console.log(`  ${bold(yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))}\n`);

  console.log(`\n  ${bold(yellow('━━━ YOUR E2E PRIVATE KEY (shown once — save it now) ━━━'))}`);
  console.log(`\n  ${bold(green(e2ePrivHex))}\n`);
  console.log(`  ${bold(yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))}\n`);
  info('Set this as ABBABABA_E2E_PRIVATE_KEY in your SDK agent environment.');
  info('The corresponding public key has been registered with the platform.');

  // ── Step 7: Save options ─────────────────────────────────────────────────
  step(7, 'Save your API key');

  // Auto-save if env var set
  if (process.env.ABBABABA_SAVE_KEY === '1') {
    const keyFile = '.abbababa-key';
    writeFileSync(keyFile, result.apiKey, { mode: 0o600 });
    ok(`Saved to ${bold(keyFile)} (chmod 600)`);
    warn(`Add ${bold(keyFile)} to your .gitignore!`);
  } else {
    console.log(`  ${bold('Option A')} — Add to your shell profile (~/.zshrc or ~/.bashrc):`);
    console.log(`  ${cyan(`export ABBABABA_API_KEY="${result.apiKey}"`)}`);
    console.log(`  ${cyan(`export ABBABABA_E2E_PRIVATE_KEY="${e2ePrivHex}"`)}\n`);

    console.log(`  ${bold('Option B')} — Add to the MCP server config (persistent across sessions):`);
    console.log(`  ${cyan(`claude mcp remove abbababa`)}`);
    console.log(`  ${cyan(`claude mcp add abbababa node ${new URL('../dist/index.js', import.meta.url).pathname} \\`)}`);
    console.log(`  ${cyan(`  -e ABBABABA_API_URL=${API_BASE} \\`)}`);
    console.log(`  ${cyan(`  -e ABBABABA_API_KEY="${result.apiKey}"`)}\n`);
    info('Note: ABBABABA_E2E_PRIVATE_KEY is for SDK agents only, not the MCP server.');

    console.log(`  ${bold('Option C')} — Store in a password manager and export when needed.\n`);
  }

  // ── Step 8: Next steps ───────────────────────────────────────────────────
  console.log(`  ${bold('What to do next:')}`);
  console.log(`  ${dim('1.')} Export your API key (see options above)`);
  console.log(`  ${dim('2.')} For SDK agents: also export ABBABABA_E2E_PRIVATE_KEY`);
  console.log(`  ${dim('3.')} Start a new Claude Code session`);
  console.log(`  ${dim('4.')} Try: ${cyan('"use abbababa_search to find summarization services"')}`);
  console.log(`  ${dim('5.')} Or:  ${cyan('"use abbababa_my_profile to see your fee tier"')}\n`);

  if (result.message && !isReregistration) {
    console.log(`  ${dim('Trust model:')} ${dim(result.message)}\n`);
  }
}

main().catch((err) => {
  fail(`Unexpected error: ${err.message}`);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
