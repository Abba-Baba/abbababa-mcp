#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';

// Keep in sync with package.json version
const VERSION = '1.2.0';

const API_BASE = process.env.ABBABABA_API_URL || 'https://abbababa.com';

const API_KEY_PROPERTY = {
  type: 'string',
  description: 'Optional API key override. Reads from ABBABABA_API_KEY env var if not provided.',
};

class AbbaBabaServer {
  private server: Server;

  private getApiKey(args: { api_key?: string }): string {
    const apiKey = process.env.ABBABABA_API_KEY || args.api_key;
    if (!apiKey) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'API key required. Set ABBABABA_API_KEY environment variable or provide api_key parameter.'
      );
    }
    return apiKey;
  }

  private validateApiKey(apiKey: string): void {
    if (!apiKey.startsWith('abbababa_') || apiKey.length !== 73) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid API key format. Expected abbababa_ prefix + 64 hex chars.');
    }
    // Verify suffix is exactly 64 lowercase hex chars (no special chars, no injection)
    const suffix = apiKey.slice(9);
    if (!/^[0-9a-f]{64}$/.test(suffix)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid API key format. Suffix must be 64 lowercase hex characters.');
    }
  }

  /** Validate a path segment used in URLs — alphanumeric, hyphens, underscores only. Prevents path traversal. */
  private validateId(value: string, name: string): void {
    if (!value || typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid ${name}: must be 1–100 alphanumeric characters (hyphens and underscores allowed).`);
    }
  }

  /** Validate a user-supplied URL — must be http or https, must not target private/loopback IP ranges. Prevents SSRF. */
  private validateHttpUrl(value: string, name: string): void {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new McpError(ErrorCode.InvalidParams, `Invalid ${name}: must be a valid URL.`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new McpError(ErrorCode.InvalidParams, `Invalid ${name}: only http and https URLs are allowed.`);
    }
    const host = parsed.hostname.toLowerCase();
    const PRIVATE_PATTERNS = [
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^0\./,
      /^::1$/,
      /^fd[0-9a-f]{2}:/i,
      /^fe80:/i,
      /^fc00:/i,
      /^localhost$/i,
      /^metadata\.google\.internal$/i,
      /^169\.254\.169\.254$/,
    ];
    if (PRIVATE_PATTERNS.some(p => p.test(host))) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid ${name}: private, loopback, and metadata URLs are not allowed.`);
    }
  }

  constructor() {
    this.server = new Server(
      { name: 'abbababa-mcp', version: VERSION },
      { capabilities: { tools: {} } }
    );
    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // ========== Commerce ==========
          {
            name: 'abbababa_search',
            description: 'Search for agent services in the Abba Baba marketplace',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query (e.g., "Summarize 10 PDF documents")',
                },
                type: {
                  type: 'string',
                  enum: ['products', 'services', 'all'],
                  default: 'all',
                  description: 'Type of item to search for',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results (default: 10, max: 100)',
                  default: 10,
                  maximum: 100,
                },
                filters: {
                  type: 'object',
                  description: 'Advanced filtering options',
                  properties: {
                    min_price: { type: 'number' },
                    max_price: { type: 'number' },
                    category: { type: 'string' },
                    min_rating: { type: 'number', description: 'Minimum rating (0-5)' },
                  },
                },
                api_key: API_KEY_PROPERTY,
              },
              required: ['query'],
            },
          },
          {
            name: 'abbababa_service_details',
            description: 'Get detailed information about an agent service. Uses ABBABABA_API_KEY env var by default.',
            inputSchema: {
              type: 'object',
              properties: {
                service_id: { type: 'string', description: 'The service ID to get details for' },
                api_key: API_KEY_PROPERTY,
              },
              required: ['service_id'],
            },
          },
          {
            name: 'abbababa_list_service',
            description: 'List a new agent service for discovery in the marketplace. Uses ABBABABA_API_KEY env var by default.',
            inputSchema: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Title of the service' },
                description: { type: 'string', description: 'Detailed description of the service' },
                category: {
                  type: 'string',
                  enum: ['research', 'summarization', 'coding', 'security', 'data', 'booking', 'content', 'other'],
                  description: 'Service category',
                },
                price: { type: 'number', description: 'Price per unit' },
                price_unit: {
                  type: 'string',
                  enum: ['per_request', 'per_document', 'per_hour', 'per_output', 'flat'],
                  description: 'Pricing unit',
                },
                currency: {
                  type: 'string',
                  enum: ['USDC', 'USD', 'ETH', 'POL'],
                  default: 'USDC',
                },
                delivery_type: {
                  type: 'string',
                  enum: ['webhook', 'api_response', 'async'],
                  default: 'webhook',
                },
                endpoint_url: { type: 'string', description: 'Endpoint URL that provides the service' },
                api_key: API_KEY_PROPERTY,
              },
              required: ['title', 'description', 'category', 'price', 'price_unit'],
            },
          },
          {
            name: 'abbababa_my_services',
            description: 'List services you have listed in the marketplace. Uses ABBABABA_API_KEY env var by default.',
            inputSchema: {
              type: 'object',
              properties: {
                api_key: API_KEY_PROPERTY,
                limit: { type: 'number', default: 20 },
                offset: { type: 'number', default: 0 },
              },
              required: [],
            },
          },
          {
            name: 'abbababa_my_transactions',
            description: 'List your A2A service transactions. Uses ABBABABA_API_KEY env var by default.',
            inputSchema: {
              type: 'object',
              properties: {
                role: {
                  type: 'string',
                  enum: ['buyer', 'seller', 'all'],
                  default: 'all',
                  description: 'Your role in the transaction',
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'escrowed', 'processing', 'delivered', 'completed', 'disputed'],
                  description: 'Filter by transaction status',
                },
                api_key: API_KEY_PROPERTY,
                limit: { type: 'number', default: 20 },
                offset: { type: 'number', default: 0 },
              },
              required: [],
            },
          },
          {
            name: 'abbababa_register',
            description: 'STEP 2 OF 3 — Register your wallet as an agent on the live marketplace. Requires ≥$1 USDC on Base Sepolia (get free testnet USDC at https://faucet.circle.com). Returns your API key. Once registered, every transaction you complete on Base Sepolia builds your on-chain score. Reach score ≥ 10 to unlock mainnet (Step 3). Generate a wallet first with: node scripts/generate-wallet.mjs',
            inputSchema: {
              type: 'object',
              properties: {
                agent_name: { type: 'string', description: 'Unique name for this agent' },
                agent_description: { type: 'string', description: 'Description of what this agent does' },
              },
              required: ['agent_name'],
            },
          },
          // ========== Agent Discovery & UCP ==========
          {
            name: 'discover_agents',
            description: 'Discover other agents by capabilities and requirements for collaboration',
            inputSchema: {
              type: 'object',
              properties: {
                capabilities: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Capability categories to search for (data_analysis, market_research, customer_insights, integration, automation)',
                },
                filters: {
                  type: 'object',
                  description: 'Search filters for agent discovery',
                  properties: {
                    verification_level: {
                      type: 'array',
                      items: { type: 'string', enum: ['basic', 'verified', 'enterprise'] },
                    },
                    minimum_trust_score: { type: 'number', minimum: 0, maximum: 100 },
                    available_now: { type: 'boolean' },
                  },
                },
                limit: { type: 'number', description: 'Maximum number of agents to return', default: 10, maximum: 50 },
                api_key: API_KEY_PROPERTY,
              },
              required: [],
            },
          },
          {
            name: 'discover_agent_services',
            description: 'Discover available agent services using DNS-SD protocol',
            inputSchema: {
              type: 'object',
              properties: {
                service_type: {
                  type: 'string',
                  enum: ['agent-capability', 'agent-comm', 'fractal-analytics', 'ucp', 'agent-payment'],
                },
                capability_filter: { type: 'array', items: { type: 'string' } },
                location_filter: { type: 'string' },
                limit: { type: 'number', default: 20 },
                api_key: API_KEY_PROPERTY,
              },
              required: [],
            },
          },
          {
            name: 'register_capability',
            description: 'Register a new capability that other agents can discover and use',
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: ['data_analysis', 'market_research', 'customer_insights', 'integration', 'automation', 'custom'],
                },
                name: { type: 'string' },
                description: { type: 'string' },
                input_format: { type: 'array', items: { type: 'string' } },
                output_format: { type: 'array', items: { type: 'string' } },
                pricing: {
                  type: 'object',
                  properties: {
                    model: { type: 'string', enum: ['free', 'per_request', 'subscription'] },
                    amount: { type: 'number' },
                  },
                },
                api_key: API_KEY_PROPERTY,
              },
              required: ['category', 'name', 'description'],
            },
          },
          {
            name: 'register_agent_service',
            description: 'Register an agent service for DNS-based discovery',
            inputSchema: {
              type: 'object',
              properties: {
                service_type: {
                  type: 'string',
                  enum: ['agent-capability', 'agent-comm', 'fractal-analytics', 'ucp', 'agent-payment'],
                },
                capabilities: { type: 'array', items: { type: 'string' } },
                endpoint: { type: 'string', format: 'uri' },
                metadata: { type: 'object' },
                priority: { type: 'number', default: 5 },
                api_key: API_KEY_PROPERTY,
              },
              required: ['service_type', 'endpoint'],
            },
          },
          {
            name: 'send_agent_message',
            description: 'Send a typed message to another agent for collaboration or inquiry',
            inputSchema: {
              type: 'object',
              properties: {
                to_agent_id: { type: 'string', description: 'Target agent ID' },
                message_type: {
                  type: 'string',
                  enum: ['capability_inquiry', 'service_request', 'collaboration_proposal'],
                },
                payload: { type: 'object' },
                priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
                api_key: API_KEY_PROPERTY,
              },
              required: ['to_agent_id', 'message_type', 'payload'],
            },
          },
          {
            name: 'abbababa_call_agent',
            description: 'Call an external agent via the A2A protocol bridge. Works with any A2A-compatible agent indexed by Abba Baba.',
            inputSchema: {
              type: 'object',
              properties: {
                agent_url: { type: 'string', description: 'URL of the A2A agent to call' },
                agent_name: { type: 'string', description: 'Name of the agent in the registry (alternative to agent_url)' },
                skill_id: { type: 'string', description: 'The skill ID to invoke on the remote agent' },
                input_data: { type: 'object', description: 'Input data to send to the agent skill' },
                api_key: API_KEY_PROPERTY,
              },
              required: ['skill_id', 'input_data'],
            },
          },
          {
            name: 'request_enhanced_data',
            description: 'Request premium data access beyond basic API limits',
            inputSchema: {
              type: 'object',
              properties: {
                query_type: {
                  type: 'string',
                  enum: ['search', 'bulk_export', 'real_time_stream', 'analytics'],
                },
                access_tier: {
                  type: 'string',
                  enum: ['verified', 'premium', 'enterprise', 'real_time'],
                },
                filters: { type: 'object' },
                max_cost: { type: 'number' },
                estimate_only: { type: 'boolean', default: false },
                api_key: API_KEY_PROPERTY,
              },
              required: ['query_type', 'access_tier'],
            },
          },
          {
            name: 'get_agent_trust_score',
            description: 'Check any agent\'s on-chain score and mainnet graduation status. Public — no API key required. Score is earned by completing real escrow transactions on Base Sepolia. Reach ≥ 10 points to unlock mainnet. Returns: current score, required score (10), graduated true/false, and remaining points needed. Use this before attempting a mainnet purchase.',
            inputSchema: {
              type: 'object',
              properties: {
                address: { type: 'string', description: 'Wallet address to check (0x...). Pass your own wallet address to check your graduation status.' },
              },
              required: ['address'],
            },
          },
          // ========== Developer Sandbox ==========
          {
            name: 'create_sandbox',
            description: 'Create an isolated developer sandbox environment for testing',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Name for the sandbox environment' },
                type: {
                  type: 'string',
                  enum: ['basic', 'fractal', 'ucp', 'integration', 'performance'],
                  default: 'basic',
                },
                features: { type: 'array', items: { type: 'string' } },
                custom_limits: {
                  type: 'object',
                  properties: {
                    api_calls_per_day: { type: 'number' },
                    storage_limit: { type: 'number' },
                    execution_time_limit: { type: 'number' },
                  },
                },
                api_key: API_KEY_PROPERTY,
              },
              required: ['name'],
            },
          },
          {
            name: 'list_sandbox_templates',
            description: 'List available sandbox templates for quick setup',
            inputSchema: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                type: { type: 'string', enum: ['basic', 'fractal', 'ucp', 'integration', 'performance'] },
                featured: { type: 'boolean' },
                api_key: API_KEY_PROPERTY,
              },
              required: [],
            },
          },
          // ========== Agent Profile & Sessions ==========
          {
            name: 'abbababa_my_profile',
            description: 'View your agent profile: fee tier, 30-day volume, daily budget usage, trust score, and rate limit status. Call this to understand your current standing on the platform.',
            inputSchema: {
              type: 'object',
              properties: { api_key: API_KEY_PROPERTY },
              required: [],
            },
          },
          {
            name: 'abbababa_fee_tier',
            description: 'Check your current volume-based fee tier. Tiers: 2.0% (default), 1.5% ($100k+/mo), 1.0% ($500k+/mo), 0.5% ($1M+/mo). Based on completed 30-day volume.',
            inputSchema: {
              type: 'object',
              properties: { api_key: API_KEY_PROPERTY },
              required: [],
            },
          },
          {
            name: 'abbababa_session_create',
            description: 'Create a scoped session token for delegating spend to a sub-agent. Set a USDC budget cap, expiry, and optionally restrict to specific service IDs. The session token can be used as an API key for purchases but cannot create sub-sessions.',
            inputSchema: {
              type: 'object',
              properties: {
                budget_usdc: { type: 'number', description: 'Max USDC the session can spend (null = unlimited within your own budget)' },
                expiry_seconds: { type: 'number', description: 'Session lifetime in seconds (max 604800 = 7 days, default 3600 = 1 hour)', default: 3600 },
                allowed_service_ids: { type: 'array', items: { type: 'string' }, description: 'Restrict session to only these service IDs. Leave empty to allow all services.' },
                session_wallet: { type: 'string', description: 'Optional EVM address of the sub-agent wallet (0x...)' },
                api_key: API_KEY_PROPERTY,
              },
              required: [],
            },
          },
          {
            name: 'abbababa_session_revoke',
            description: 'Revoke a session token early before it expires. Use when a sub-agent completes its task or if you suspect misuse.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Session ID to revoke (from abbababa_session_create response)' },
                api_key: API_KEY_PROPERTY,
              },
              required: ['session_id'],
            },
          },
          // ========== Discovery Utilities ==========
          {
            name: 'abbababa_categories',
            description: 'List all service categories and subcategories with slugs. Use the slug values when registering a service with abbababa_list_service. Returns parent/child hierarchy.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'abbababa_marketplace_pulse',
            description: 'Live marketplace stats: total services, 24h transaction volume, active agents, top categories. Use to understand market activity before deciding what services to offer or buy.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'abbababa_network_health',
            description: 'Check the health of the Base blockchain connection and escrow contract. Returns healthy: true/false, current block number, and any errors. Call before transacting if you want to verify the network is live.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          // ========== Playground (test without real funds) ==========
          {
            name: 'abbababa_playground_start',
            description: 'STEP 1 OF 3 — Learn the escrow API with zero setup. No wallet, no USDC, no blockchain. Uses simulated mUSDC. Practice the full create → deliver → accept flow here, then graduate to Step 2. Step 2: register a wallet, get testnet USDC, and transact on the live marketplace (Base Sepolia) to build your on-chain score. Step 3: reach score ≥ 10 to unlock mainnet real transactions.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'abbababa_playground_reset',
            description: 'Wipe all escrows and events in your playground session and start fresh. Useful when you want to re-run a scenario from scratch.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID to reset' },
              },
              required: ['session_id'],
            },
          },
          {
            name: 'abbababa_playground_templates',
            description: 'List available pre-built playground scenario templates (e.g. "happy path", "dispute scenario", "abandonment"). Use with abbababa_playground_template_apply to jump straight into a specific flow.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'abbababa_playground_template_apply',
            description: 'Apply a pre-built scenario template to your session. Creates an escrow pre-configured for that scenario. Faster than setting up buyer/seller/amount manually.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                template_id: { type: 'string', description: 'Template ID from abbababa_playground_templates' },
              },
              required: ['session_id', 'template_id'],
            },
          },
          {
            name: 'abbababa_playground_escrow_create',
            description: 'Create a simulated escrow in your playground session. Specify buyer and seller wallet addresses (can be anything for testing), amount, and optional deadline.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID from abbababa_playground_start' },
                buyer: { type: 'string', description: 'Buyer address (any string for testing, e.g. "buyer-agent-1")' },
                seller: { type: 'string', description: 'Seller address (any string for testing, e.g. "seller-agent-1")' },
                amount: { type: 'number', description: 'Amount in mUSDC (simulated, max 10000)' },
                currency: { type: 'string', default: 'mUSDC' },
                deadline_seconds: { type: 'number', description: 'Seconds until escrow expires (optional)' },
                criteria_hash: { type: 'string', description: 'Optional success criteria hash' },
              },
              required: ['session_id', 'buyer', 'seller', 'amount'],
            },
          },
          {
            name: 'abbababa_playground_escrow_get',
            description: 'Get the current state of a playground escrow (status, amounts, timestamps).',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                escrow_id: { type: 'string', description: 'Escrow ID from abbababa_playground_escrow_create' },
              },
              required: ['session_id', 'escrow_id'],
            },
          },
          {
            name: 'abbababa_playground_join',
            description: 'Join a playground escrow as buyer or seller. Simulates an agent joining an existing escrow.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                escrow_id: { type: 'string', description: 'Escrow ID to join' },
                role: { type: 'string', enum: ['buyer', 'seller'], description: 'Role to join as' },
              },
              required: ['session_id', 'escrow_id', 'role'],
            },
          },
          {
            name: 'abbababa_playground_deliver',
            description: 'Simulate a seller marking delivery in a playground escrow. Provide a proof hash (any string — represents a hash of the delivered work).',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                escrow_id: { type: 'string', description: 'Escrow ID to deliver on' },
                proof_hash: { type: 'string', description: 'Proof of delivery hash (any string for testing, e.g. sha256 of your output)' },
              },
              required: ['session_id', 'escrow_id', 'proof_hash'],
            },
          },
          {
            name: 'abbababa_playground_accept',
            description: 'Simulate the buyer accepting delivery in a playground escrow. Releases funds to seller. This is the happy path.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                escrow_id: { type: 'string', description: 'Escrow ID to accept' },
              },
              required: ['session_id', 'escrow_id'],
            },
          },
          {
            name: 'abbababa_playground_dispute',
            description: 'Simulate opening a dispute on a playground escrow. Triggers the AI dispute resolver (simulated). Use with abbababa_playground_advance_time to test the full dispute flow.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                escrow_id: { type: 'string', description: 'Escrow ID to dispute' },
              },
              required: ['session_id', 'escrow_id'],
            },
          },
          {
            name: 'abbababa_playground_advance_time',
            description: 'Fast-forward the clock on a playground escrow by N seconds. Use to skip past dispute windows (300s) or abandonment grace periods (172800s) without waiting.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                escrow_id: { type: 'string', description: 'Escrow ID to advance time on' },
                seconds: { type: 'number', description: 'Seconds to advance (e.g. 301 to pass a 300s dispute window, 172801 to trigger abandonment)' },
              },
              required: ['session_id', 'escrow_id', 'seconds'],
            },
          },
          {
            name: 'abbababa_playground_finalize',
            description: 'Finalize and release escrow funds to the seller after the dispute window has passed with no dispute raised. This is the auto-release path — buyer did not dispute, seller gets paid.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                escrow_id: { type: 'string', description: 'Escrow ID to finalize' },
              },
              required: ['session_id', 'escrow_id'],
            },
          },
          {
            name: 'abbababa_playground_resolve',
            description: 'Resolve a disputed playground escrow with a specific outcome. Simulates the AI dispute resolver. Use after abbababa_playground_dispute to see how funds split.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                escrow_id: { type: 'string', description: 'Escrow ID in dispute' },
                outcome: { type: 'string', enum: ['buyer_refund', 'seller_paid', 'split'], description: 'Resolution outcome: buyer_refund = full refund, seller_paid = seller wins, split = divide by percentages' },
                buyer_pct: { type: 'number', description: 'Buyer percentage if outcome is split (0-100, must sum to 100 with seller_pct)', default: 50 },
                seller_pct: { type: 'number', description: 'Seller percentage if outcome is split (0-100, must sum to 100 with buyer_pct)', default: 50 },
              },
              required: ['session_id', 'escrow_id', 'outcome'],
            },
          },
          {
            name: 'abbababa_playground_abandon',
            description: 'Claim an abandoned playground escrow as buyer after the seller never delivered. Simulates the abandonment path — funds return to buyer.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                escrow_id: { type: 'string', description: 'Escrow ID to claim as abandoned' },
              },
              required: ['session_id', 'escrow_id'],
            },
          },
          {
            name: 'abbababa_playground_inject_failure',
            description: 'Inject a failure scenario into a playground escrow for chaos testing. Tests how your agent handles edge cases like network timeouts, bad proofs, or double-spends.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Playground session ID' },
                escrow_id: { type: 'string', description: 'Escrow ID to inject failure into' },
                failure_type: { type: 'string', enum: ['network_timeout', 'invalid_proof', 'double_spend', 'revert'], description: 'Type of failure to inject' },
              },
              required: ['session_id', 'escrow_id', 'failure_type'],
            },
          },
          {
            name: 'abbababa_playground_leaderboard',
            description: 'View the playground leaderboard: top agents by completed escrows, total volume, fastest completions, and earned badges. No session required.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          // ========== Knowledge Base & Support ==========
          {
            name: 'abbababa_kb_search',
            description: 'Search the Abba Baba documentation. Supports semantic (meaning-based) and keyword search. Use this to look up how APIs work, understand escrow flows, or find integration guides — without leaving your agent session.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query (max 500 chars)' },
                mode: { type: 'string', enum: ['semantic', 'keyword'], default: 'semantic', description: 'semantic = meaning-based (better for concepts), keyword = exact match (better for specific terms)' },
                limit: { type: 'number', default: 10, description: 'Max results (1-50)' },
              },
              required: ['query'],
            },
          },
          {
            name: 'abbababa_support_ticket',
            description: 'File a support ticket. Use when you encounter a platform bug, disputed escrow that needs manual review, or billing issue that automated resolution could not handle.',
            inputSchema: {
              type: 'object',
              properties: {
                subject: { type: 'string', description: 'Brief description of the issue' },
                description: { type: 'string', description: 'Full description (min 10 chars). Include transaction IDs, error messages, and steps to reproduce.' },
                priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
                category: { type: 'string', enum: ['billing', 'technical', 'account', 'integration', 'general'], default: 'general' },
                agent_id: { type: 'string', description: 'Your agent ID (optional, helps route to your account)' },
              },
              required: ['subject', 'description'],
            },
          },
          {
            name: 'abbababa_dns_stats',
            description: 'Get DNS service discovery network statistics: total connections, unique agents, top capabilities, cache hit rates, and service distribution by type. Useful for understanding network topology before choosing integration strategies.',
            inputSchema: {
              type: 'object',
              properties: { api_key: API_KEY_PROPERTY },
              required: [],
            },
          },
          // ========== Disputes ==========
          {
            name: 'abbababa_dispute',
            description: 'Open a dispute on a delivered transaction (buyer only, within dispute window). Uses ABBABABA_API_KEY env var by default.',
            inputSchema: {
              type: 'object',
              properties: {
                transaction_id: { type: 'string', description: 'Transaction ID to dispute' },
                reason: { type: 'string', description: 'Reason for the dispute' },
                api_key: API_KEY_PROPERTY,
              },
              required: ['transaction_id', 'reason'],
            },
          },
          {
            name: 'abbababa_dispute_status',
            description: 'Check the status of an active or resolved dispute. Uses ABBABABA_API_KEY env var by default.',
            inputSchema: {
              type: 'object',
              properties: {
                transaction_id: { type: 'string', description: 'Transaction ID to check dispute status for' },
                api_key: API_KEY_PROPERTY,
              },
              required: ['transaction_id'],
            },
          },
          {
            name: 'abbababa_dispute_evidence',
            description: 'Submit evidence for an open dispute (buyer or seller). Uses ABBABABA_API_KEY env var by default.',
            inputSchema: {
              type: 'object',
              properties: {
                transaction_id: { type: 'string', description: 'Transaction ID' },
                type: {
                  type: 'string',
                  enum: ['delivery_proof', 'requirement_failure', 'communication', 'other'],
                  description: 'Type of evidence',
                },
                content: { type: 'string', description: 'Evidence content (text, URL, or structured data)' },
                api_key: API_KEY_PROPERTY,
              },
              required: ['transaction_id', 'type', 'content'],
            },
          },
          {
            name: 'abbababa_usage',
            description: 'Check your current API usage, budget consumption, and rate limit status. Uses ABBABABA_API_KEY env var by default.',
            inputSchema: {
              type: 'object',
              properties: {
                api_key: API_KEY_PROPERTY,
              },
              required: [],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params as { name: string; arguments?: Record<string, unknown> };

      try {
        switch (name) {
          case 'abbababa_search':           return await this.handleSearch(args);
          case 'abbababa_service_details':  return await this.handleServiceDetails(args);
          case 'abbababa_list_service':     return await this.handleListService(args);
          case 'abbababa_my_services':      return await this.handleMyServices(args);
          case 'abbababa_my_transactions':  return await this.handleMyTransactions(args);
          case 'abbababa_register':         return await this.handleRegister(args);
          case 'discover_agents':           return await this.handleAgentDiscovery(args);
          case 'discover_agent_services':   return await this.handleDiscoverAgentServices(args);
          case 'register_capability':       return await this.handleCapabilityRegistration(args);
          case 'register_agent_service':    return await this.handleRegisterAgentService(args);
          case 'send_agent_message':        return await this.handleAgentMessage(args);
          case 'abbababa_call_agent':       return await this.handleCallAgent(args);
          case 'request_enhanced_data':     return await this.handleEnhancedDataRequest(args);
          case 'get_agent_trust_score':     return await this.handleGetAgentTrustScore(args);
          case 'create_sandbox':            return await this.handleCreateSandbox(args);
          case 'list_sandbox_templates':    return await this.handleListSandboxTemplates(args);
          case 'abbababa_my_profile':               return await this.handleMyProfile(args);
          case 'abbababa_fee_tier':                 return await this.handleFeeTier(args);
          case 'abbababa_session_create':           return await this.handleSessionCreate(args);
          case 'abbababa_session_revoke':           return await this.handleSessionRevoke(args);
          case 'abbababa_categories':               return await this.handleCategories();
          case 'abbababa_marketplace_pulse':        return await this.handleMarketplacePulse();
          case 'abbababa_network_health':           return await this.handleNetworkHealth();
          case 'abbababa_playground_start':         return await this.handlePlaygroundStart(args);
          case 'abbababa_playground_escrow_create': return await this.handlePlaygroundEscrowCreate(args);
          case 'abbababa_playground_escrow_get':    return await this.handlePlaygroundEscrowGet(args);
          case 'abbababa_playground_join':          return await this.handlePlaygroundJoin(args);
          case 'abbababa_playground_deliver':       return await this.handlePlaygroundDeliver(args);
          case 'abbababa_playground_accept':        return await this.handlePlaygroundAccept(args);
          case 'abbababa_playground_dispute':       return await this.handlePlaygroundDispute(args);
          case 'abbababa_playground_advance_time':    return await this.handlePlaygroundAdvanceTime(args);
          case 'abbababa_playground_reset':           return await this.handlePlaygroundReset(args);
          case 'abbababa_playground_templates':       return await this.handlePlaygroundTemplates();
          case 'abbababa_playground_template_apply':  return await this.handlePlaygroundTemplateApply(args);
          case 'abbababa_playground_finalize':        return await this.handlePlaygroundFinalize(args);
          case 'abbababa_playground_resolve':         return await this.handlePlaygroundResolve(args);
          case 'abbababa_playground_abandon':         return await this.handlePlaygroundAbandon(args);
          case 'abbababa_playground_inject_failure':  return await this.handlePlaygroundInjectFailure(args);
          case 'abbababa_playground_leaderboard':     return await this.handlePlaygroundLeaderboard();
          case 'abbababa_kb_search':                return await this.handleKbSearch(args);
          case 'abbababa_support_ticket':           return await this.handleSupportTicket(args);
          case 'abbababa_dns_stats':                return await this.handleDnsStats(args);
          case 'abbababa_dispute':              return await this.handleDispute(args);
          case 'abbababa_dispute_status':       return await this.handleDisputeStatus(args);
          case 'abbababa_dispute_evidence':     return await this.handleDisputeEvidence(args);
          case 'abbababa_usage':                return await this.handleUsage(args);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) throw error;
        console.error('MCP tool error:', error);
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  // =========================================================================
  // Commerce handlers
  // =========================================================================

  private async handleSearch(args: Record<string, unknown>) {
    const { query, type = 'all', limit = 10, filters } = args as {
      query: string
      type?: string
      limit?: number
      filters?: { min_price?: number; max_price?: number; category?: string; min_rating?: number }
      api_key?: string
    };
    const apiKey = process.env.ABBABABA_API_KEY || (args.api_key as string | undefined);
    if (apiKey) this.validateApiKey(apiKey);

    let products: unknown[] = [];
    let services: unknown[] = [];

    if (type === 'products' || type === 'all') {
      try {
        const resp = await fetch(`${API_BASE}/api/v1/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(apiKey && { 'X-API-Key': apiKey }) },
          body: JSON.stringify({ query, limit, filters }),
        });
        if (resp.ok) { const r = await resp.json(); products = r.data || []; }
      } catch { /* non-fatal */ }
    }

    if (type === 'services' || type === 'all') {
      try {
        const url = new URL(`${API_BASE}/api/v1/services`);
        url.searchParams.set('q', query);
        url.searchParams.set('limit', String(limit));
        if (filters?.category) url.searchParams.set('category', filters.category);
        if (filters?.min_rating) url.searchParams.set('min_rating', String(filters.min_rating));
        if (filters?.max_price) url.searchParams.set('max_price', String(filters.max_price));
        const resp = await fetch(url.toString(), {
          headers: { ...(apiKey && { 'X-API-Key': apiKey }) },
        });
        if (resp.ok) { const r = await resp.json(); services = r.data?.services || []; }
      } catch { /* non-fatal */ }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ query, type, results: { products_count: products.length, services_count: services.length, products, services }, message: 'Marketplace search completed' }, null, 2),
      }],
    };
  }

  private async handleServiceDetails(args: Record<string, unknown>) {
    const { service_id } = args as { service_id: string };
    this.validateId(service_id, 'service_id');
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/services/${service_id}`, { headers: { 'X-API-Key': apiKey } });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Service API error: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handleListService(args: Record<string, unknown>) {
    const { title, description, category, price, price_unit, currency, delivery_type, endpoint_url } = args as {
      title: string; description: string; category: string; price: number; price_unit: string
      currency?: string; delivery_type?: string; endpoint_url?: string
    };
    if (endpoint_url) this.validateHttpUrl(endpoint_url, 'endpoint_url');
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ title, description, category, price, priceUnit: price_unit, currency, deliveryType: delivery_type, endpointUrl: endpoint_url }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Listing failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ message: 'Service listed successfully', service: result.data }, null, 2) }] };
  }

  private async handleMyServices(args: Record<string, unknown>) {
    const { limit = 20, offset = 0 } = args as { limit?: number; offset?: number };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const url = new URL(`${API_BASE}/api/v1/services`);
    url.searchParams.set('owner', 'true');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const resp = await fetch(url.toString(), { headers: { 'X-API-Key': apiKey } });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `API error: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handleMyTransactions(args: Record<string, unknown>) {
    const { role = 'all', status, limit = 20, offset = 0 } = args as { role?: string; status?: string; limit?: number; offset?: number };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const url = new URL(`${API_BASE}/api/v1/transactions`);
    url.searchParams.set('role', role);
    if (status) url.searchParams.set('status', status);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const resp = await fetch(url.toString(), { headers: { 'X-API-Key': apiKey } });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `API error: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handleRegister(args: Record<string, unknown>) {
    const { agent_name, agent_description } = args as { agent_name: string; agent_description?: string };

    const privateKey = process.env.ABBABABA_AGENT_PRIVATE_KEY;
    if (!privateKey || !privateKey.startsWith('0x') || privateKey.length !== 66 || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'ABBABABA_AGENT_PRIVATE_KEY is missing or invalid. Must be 0x followed by exactly 64 hex characters.'
      );
    }
    if (!agent_name || agent_name.length < 3) {
      throw new McpError(ErrorCode.InvalidParams, 'agent_name must be at least 3 characters');
    }

    try {
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      const timestamp = Math.floor(Date.now() / 1000);
      const message = `Register Abba Baba Agent\nWallet: ${account.address}\nTimestamp: ${timestamp}`;
      const signature = await account.signMessage({ message });

      const resp = await fetch(`${API_BASE}/api/v1/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: account.address,
          agentName: agent_name,
          description: agent_description,
          message,
          signature,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json() as {
          error?: string;
          balance?: string;
          required?: string;
          network?: string;
          chainId?: number;
          usdcContractAddress?: string;
          howToGetUsdc?: {
            faucet?: string;
            instructions?: string[];
            exchanges?: string[];
            bridge?: string;
            coinbase?: string;
          };
        };

        if (resp.status === 402) {
          // Insufficient USDC — surface full instructions so user can act without leaving
          const how = err.howToGetUsdc;
          const steps = how?.instructions?.map((s, i) => `  ${i + 1}. ${s}`).join('\n') ?? '';
          const faucetLine = how?.faucet ? `\nFaucet: ${how.faucet}` : '';
          const exchangeLines = how?.exchanges
            ? `\nExchanges: ${how.exchanges.join(', ')}\nBridge: ${how.bridge ?? ''}\nBuy directly: ${how.coinbase ?? ''}`
            : '';
          throw new McpError(
            ErrorCode.InvalidParams,
            `Registration requires ≥$1 USDC on ${err.network ?? 'Base'}\n` +
            `Your balance: ${err.balance ?? '0'} USDC  |  Required: ${err.required ?? '1.0'} USDC\n` +
            `USDC contract: ${err.usdcContractAddress ?? ''}\n` +
            `\nHow to get USDC:${faucetLine}${exchangeLines}\n${steps}\n` +
            `\nNote: Funds are NOT charged — this is anti-spam only.`
          );
        }

        throw new McpError(ErrorCode.InternalError, `Registration failed (${resp.status}): ${err.error || resp.statusText}`);
      }

      const result = await resp.json();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Agent registered successfully',
            api_key: result.apiKey,
            agent_id: result.agentId,
            developer_id: result.developerId,
            wallet_address: result.walletAddress,
            warning: 'Store this API key securely — it will not be shown again',
          }, null, 2),
        }],
      };
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `Registration error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // =========================================================================
  // Agent discovery & UCP handlers
  // =========================================================================

  private async handleAgentDiscovery(args: Record<string, unknown>) {
    const { capabilities, filters, limit = 10 } = args as { capabilities?: string[]; filters?: Record<string, unknown>; limit?: number };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/ucp/discovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ capabilities, filters, limit }),
    });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Agent discovery failed: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ discovered_agents: result.data?.agents?.length, total_available: result.data?.pagination?.total, agents: result.data?.agents, message: 'Agent discovery completed' }, null, 2) }] };
  }

  private async handleDiscoverAgentServices(args: Record<string, unknown>) {
    const { service_type, capability_filter, location_filter, limit = 20 } = args as {
      service_type?: string; capability_filter?: string[]; location_filter?: string; limit?: number
    };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/dns/discovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ serviceType: service_type, capabilityFilter: capability_filter, locationFilter: location_filter, limit }),
    });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Service discovery failed: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ discovered_services: result.services?.length || 0, services: result.services || [], network_stats: result.networkStats, message: 'Agent service discovery completed' }, null, 2) }] };
  }

  private async handleCapabilityRegistration(args: Record<string, unknown>) {
    const { category, name, description, input_format, output_format, pricing } = args as {
      category: string; name: string; description: string; input_format?: string[]; output_format?: string[]
      pricing?: { model: string; amount?: number }
    };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/ucp/capabilities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ category, name, description, inputFormat: input_format || ['json'], outputFormat: output_format || ['json'], pricing: pricing || { model: 'free' }, availability: { active: true }, requirements: {}, metadata: {} }),
    });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Capability registration failed: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ capability_id: result.data?.id, name: result.data?.name, category: result.data?.category, status: 'registered', message: 'Capability registered and now discoverable by other agents' }, null, 2) }] };
  }

  private async handleRegisterAgentService(args: Record<string, unknown>) {
    const { service_type, capabilities, endpoint, metadata, priority = 5 } = args as {
      service_type: string; capabilities?: string[]; endpoint: string; metadata?: Record<string, unknown>; priority?: number
    };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/dns/discovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ serviceType: service_type, capabilities: capabilities || [], endpoint, metadata: metadata || {}, priority }),
    });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Service registration failed: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ service_id: result.service?.id, service_type, endpoint, capabilities, priority, status: 'registered', message: 'Agent service registered and now discoverable' }, null, 2) }] };
  }

  private async handleAgentMessage(args: Record<string, unknown>) {
    const { to_agent_id, message_type, payload, priority = 'normal' } = args as {
      to_agent_id: string; message_type: string; payload: Record<string, unknown>; priority?: string
    };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/ucp/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ type: message_type, version: '1.0', toAgentId: to_agent_id, payload, priority }),
    });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Message send failed: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ message_id: result.data?.id, to_agent: result.data?.toAgentId, type: result.data?.type, priority: result.data?.priority, status: 'sent', timestamp: result.data?.timestamp, message: 'Message sent to target agent' }, null, 2) }] };
  }

  private async handleCallAgent(args: Record<string, unknown>) {
    const { agent_url, agent_name, skill_id, input_data } = args as {
      agent_url?: string; agent_name?: string; skill_id: string; input_data: Record<string, unknown>
    };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    let resolvedUrl = agent_url;

    // Resolve agent URL from name via backend registry
    if (!resolvedUrl && agent_name) {
      const searchUrl = new URL(`${API_BASE}/api/v1/agents`);
      searchUrl.searchParams.set('q', agent_name);
      const searchResp = await fetch(searchUrl.toString(), { headers: { 'X-API-Key': apiKey } });
      if (searchResp.ok) {
        const searchResult = await searchResp.json();
        const agents: Array<{ name?: string; url?: string }> = searchResult.data?.agents || searchResult.data || [];
        const found = agents.find(a => a.name?.toLowerCase().includes(agent_name.toLowerCase()));
        if (found?.url) resolvedUrl = found.url;
      }
      if (!resolvedUrl) {
        throw new McpError(ErrorCode.InvalidParams, `Agent not found: ${agent_name}. Provide agent_url directly.`);
      }
    }

    if (!resolvedUrl) {
      throw new McpError(ErrorCode.InvalidParams, 'Either agent_url or agent_name is required');
    }

    // SSRF protection: validate the resolved URL before fetching
    this.validateHttpUrl(resolvedUrl, 'agent_url');
    const a2aEndpoint = new URL('/api/a2a', resolvedUrl).toString();
    const jsonRpcRequest = {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'message/send',
      params: { message: { role: 'user', parts: [{ type: 'data', data: input_data }] }, configuration: { skillId: skill_id } },
    };

    try {
      const resp = await fetch(a2aEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonRpcRequest),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) throw new McpError(ErrorCode.InternalError, `A2A agent returned HTTP ${resp.status}`);
      const rpcResponse = await resp.json() as { error?: { message: string }; result: unknown };
      if (rpcResponse.error) throw new McpError(ErrorCode.InternalError, `A2A error: ${rpcResponse.error.message}`);
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'A2A agent call completed', agent_url: resolvedUrl, skill_id, task: rpcResponse.result }, null, 2) }] };
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(ErrorCode.InternalError, `A2A bridge call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleEnhancedDataRequest(args: Record<string, unknown>) {
    const { query_type, access_tier, filters, max_cost, estimate_only = false } = args as {
      query_type: string; access_tier: string; filters?: Record<string, unknown>; max_cost?: number; estimate_only?: boolean
    };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/ucp/data-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ query: { type: query_type, filters: filters || {}, format: 'json', limit: 100 }, accessTier: access_tier, billing: { estimateOnly: estimate_only, maxCost: max_cost, currency: 'USD' }, delivery: { method: 'sync' } }),
    });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Enhanced data request failed: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ request_id: result.data?.requestId, status: result.data?.status, access_tier, estimated_cost: result.data?.estimatedCost, estimate_only, message: estimate_only ? 'Cost estimate generated' : 'Enhanced data request initiated' }, null, 2) }] };
  }

  private async handleGetAgentTrustScore(args: Record<string, unknown>) {
    const { address } = args as { address: string };
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new McpError(ErrorCode.InvalidParams, 'Valid Ethereum address required (0x followed by 40 hex chars)');
    }

    const resp = await fetch(`${API_BASE}/api/v1/agents/score?address=${address}`);
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Score lookup failed: ${resp.status}`);
    const result = await resp.json();
    const data = result.data;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          address: data.address,
          score: data.score,
          required: data.required,
          graduated: data.graduated,
          remaining: Math.max(0, data.required - data.score),
          status: data.graduated
            ? '✅ Mainnet eligible — you can transact on Base mainnet'
            : `⏳ ${Math.max(0, data.required - data.score)} more point(s) needed — keep transacting on Base Sepolia`,
        }, null, 2),
      }],
    };
  }

  // =========================================================================
  // Sandbox handlers
  // =========================================================================

  private async handleCreateSandbox(args: Record<string, unknown>) {
    const { name, type = 'basic', features, custom_limits } = args as {
      name: string; type?: string; features?: string[]
      custom_limits?: { api_calls_per_day?: number; storage_limit?: number; execution_time_limit?: number }
    };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ name, type, features: features || [], customLimits: custom_limits, isPublic: false }),
    });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Sandbox creation failed: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ sandbox_id: result.sandbox?.id, name: result.sandbox?.name, type: result.sandbox?.type, endpoint: result.sandbox?.endpoint, expires_at: result.sandbox?.expiresAt, api_key: result.credentials?.apiKey, warning: 'Store the sandbox API key securely — it will not be shown again', message: 'Sandbox created successfully' }, null, 2) }] };
  }

  private async handleListSandboxTemplates(args: Record<string, unknown>) {
    const { category, type, featured } = args as { category?: string; type?: string; featured?: boolean };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (type) params.set('type', type);
    if (featured) params.set('featured', 'true');

    const resp = await fetch(`${API_BASE}/api/v1/sandbox/templates?${params}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Template listing failed: ${resp.status}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ template_count: result.count, templates: result.templates, filters: result.filters, message: 'Templates retrieved' }, null, 2) }] };
  }

  // =========================================================================
  // Dispute handlers
  // =========================================================================

  private async handleDispute(args: Record<string, unknown>) {
    const { transaction_id, reason } = args as { transaction_id: string; reason: string };
    this.validateId(transaction_id, 'transaction_id');
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/transactions/${transaction_id}/dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ reason }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Dispute failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ message: 'Dispute opened — AI resolution will evaluate within 30 seconds', dispute: result.data }, null, 2) }] };
  }

  private async handleDisputeStatus(args: Record<string, unknown>) {
    const { transaction_id } = args as { transaction_id: string };
    this.validateId(transaction_id, 'transaction_id');
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/transactions/${transaction_id}/dispute`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Dispute status lookup failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handleDisputeEvidence(args: Record<string, unknown>) {
    const { transaction_id, type, content } = args as { transaction_id: string; type: string; content: string };
    this.validateId(transaction_id, 'transaction_id');
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/transactions/${transaction_id}/dispute/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ type, content }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Evidence submission failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ message: 'Evidence submitted', evidence: result.data }, null, 2) }] };
  }

  private async handleUsage(args: Record<string, unknown>) {
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);

    const resp = await fetch(`${API_BASE}/api/v1/auth/usage`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Usage check failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  // =========================================================================
  // Agent profile & session handlers
  // =========================================================================

  private async handleMyProfile(args: Record<string, unknown>) {
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);
    const [feeTierResp, usageResp] = await Promise.all([
      fetch(`${API_BASE}/api/v1/agents/fee-tier`, { headers: { 'X-API-Key': apiKey } }),
      fetch(`${API_BASE}/api/v1/auth/usage`, { headers: { 'X-API-Key': apiKey } }),
    ]);
    const feeTier = feeTierResp.ok ? await feeTierResp.json() : null;
    const usage = usageResp.ok ? await usageResp.json() : null;
    return { content: [{ type: 'text', text: JSON.stringify({ feeTier: feeTier?.data ?? null, usage: usage?.data ?? null }, null, 2) }] };
  }

  private async handleFeeTier(args: Record<string, unknown>) {
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);
    const resp = await fetch(`${API_BASE}/api/v1/agents/fee-tier`, { headers: { 'X-API-Key': apiKey } });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Fee tier fetch failed: ${resp.statusText}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handleSessionCreate(args: Record<string, unknown>) {
    const { budget_usdc, expiry_seconds = 3600, allowed_service_ids = [], session_wallet } = args as {
      budget_usdc?: number; expiry_seconds?: number; allowed_service_ids?: string[]; session_wallet?: string;
    };
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);
    const resp = await fetch(`${API_BASE}/api/v1/agents/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ budgetUsdc: budget_usdc ?? null, expiry: expiry_seconds, allowedServiceIds: allowed_service_ids, sessionWallet: session_wallet }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Session create failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ ...result.data, warning: 'Store this session token securely — it will not be shown again' }, null, 2) }] };
  }

  private async handleSessionRevoke(args: Record<string, unknown>) {
    const { session_id } = args as { session_id: string };
    this.validateId(session_id, 'session_id');
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);
    const resp = await fetch(`${API_BASE}/api/v1/agents/session/${session_id}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': apiKey },
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Session revoke failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  // =========================================================================
  // Discovery utility handlers
  // =========================================================================

  private async handleCategories() {
    const resp = await fetch(`${API_BASE}/api/v1/categories`);
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Categories fetch failed: ${resp.statusText}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.categories, null, 2) }] };
  }

  private async handleMarketplacePulse() {
    const resp = await fetch(`${API_BASE}/api/v1/marketplace/pulse`);
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Marketplace pulse failed: ${resp.statusText}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handleNetworkHealth() {
    const resp = await fetch(`${API_BASE}/api/v1/network/health`);
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Network health check failed: ${resp.statusText}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  // =========================================================================
  // Playground handlers
  // =========================================================================

  private async handlePlaygroundStart(_args: Record<string, unknown>) {
    const resp = await fetch(`${API_BASE}/api/v1/playground/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'simulated' }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground session failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ ...result.data, tip: 'Save the sessionId — you need it for all other playground_ tools' }, null, 2) }] };
  }

  private async handlePlaygroundEscrowCreate(args: Record<string, unknown>) {
    const { session_id, buyer, seller, amount, currency = 'mUSDC', deadline_seconds, criteria_hash } = args as {
      session_id: string; buyer: string; seller: string; amount: number;
      currency?: string; deadline_seconds?: number; criteria_hash?: string;
    };
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id, buyer, seller, amount, currency, deadlineSeconds: deadline_seconds, criteriaHash: criteria_hash }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground escrow create failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundEscrowGet(args: Record<string, unknown>) {
    const { session_id, escrow_id } = args as { session_id: string; escrow_id: string };
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow/${escrow_id}?sessionId=${session_id}`, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground escrow get failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundJoin(args: Record<string, unknown>) {
    const { session_id, escrow_id, role } = args as { session_id: string; escrow_id: string; role: string };
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow/${escrow_id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id, role }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground join failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundDeliver(args: Record<string, unknown>) {
    const { session_id, escrow_id, proof_hash } = args as { session_id: string; escrow_id: string; proof_hash: string };
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow/${escrow_id}/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id, proofHash: proof_hash }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground deliver failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundAccept(args: Record<string, unknown>) {
    const { session_id, escrow_id } = args as { session_id: string; escrow_id: string };
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow/${escrow_id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground accept failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundDispute(args: Record<string, unknown>) {
    const { session_id, escrow_id } = args as { session_id: string; escrow_id: string };
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow/${escrow_id}/dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground dispute failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundAdvanceTime(args: Record<string, unknown>) {
    const { session_id, escrow_id, seconds } = args as { session_id: string; escrow_id: string; seconds: number };
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow/${escrow_id}/advance-time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id, seconds }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground advance time failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundReset(args: Record<string, unknown>) {
    const { session_id } = args as { session_id: string };
    const resp = await fetch(`${API_BASE}/api/v1/playground/session/${session_id}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground reset failed: ${err.error || resp.statusText}`); }
    return { content: [{ type: 'text', text: JSON.stringify({ sessionId: session_id, message: 'Session reset — all escrows and events cleared' }, null, 2) }] };
  }

  private async handlePlaygroundTemplates() {
    const resp = await fetch(`${API_BASE}/api/v1/playground/templates`);
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Templates fetch failed: ${resp.statusText}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundTemplateApply(args: Record<string, unknown>) {
    const { session_id, template_id } = args as { session_id: string; template_id: string };
    this.validateId(template_id, 'template_id');
    const resp = await fetch(`${API_BASE}/api/v1/playground/template/${template_id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Template apply failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundFinalize(args: Record<string, unknown>) {
    const { session_id, escrow_id } = args as { session_id: string; escrow_id: string };
    this.validateId(escrow_id, 'escrow_id');
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow/${escrow_id}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground finalize failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundResolve(args: Record<string, unknown>) {
    const { session_id, escrow_id, outcome, buyer_pct = 50, seller_pct = 50 } = args as {
      session_id: string; escrow_id: string; outcome: string; buyer_pct?: number; seller_pct?: number;
    };
    this.validateId(escrow_id, 'escrow_id');
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow/${escrow_id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id, outcome, buyerPct: buyer_pct, sellerPct: seller_pct }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground resolve failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundAbandon(args: Record<string, unknown>) {
    const { session_id, escrow_id } = args as { session_id: string; escrow_id: string };
    this.validateId(escrow_id, 'escrow_id');
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow/${escrow_id}/abandon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Playground abandon failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  private async handlePlaygroundInjectFailure(args: Record<string, unknown>) {
    const { session_id, escrow_id, failure_type } = args as { session_id: string; escrow_id: string; failure_type: string };
    this.validateId(escrow_id, 'escrow_id');
    const resp = await fetch(`${API_BASE}/api/v1/playground/escrow/${escrow_id}/inject-failure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session_id, type: failure_type }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Inject failure failed: ${err.error || resp.statusText}`); }
    return { content: [{ type: 'text', text: JSON.stringify({ escrowId: escrow_id, failureInjected: failure_type, message: 'Failure injected — observe how your agent handles the error' }, null, 2) }] };
  }

  private async handlePlaygroundLeaderboard() {
    const resp = await fetch(`${API_BASE}/api/v1/playground/leaderboard`);
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `Leaderboard fetch failed: ${resp.statusText}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
  }

  // =========================================================================
  // Knowledge base & support handlers
  // =========================================================================

  private async handleKbSearch(args: Record<string, unknown>) {
    const { query, mode = 'semantic', limit = 10 } = args as { query: string; mode?: string; limit?: number };
    const params = new URLSearchParams({ q: query, mode, limit: String(limit) });
    const resp = await fetch(`${API_BASE}/api/v1/kb/search?${params.toString()}`);
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `KB search failed: ${resp.statusText}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ query: result.query, mode: result.mode, results: result.results }, null, 2) }] };
  }

  private async handleSupportTicket(args: Record<string, unknown>) {
    const { subject, description, priority = 'normal', category = 'general', agent_id } = args as {
      subject: string; description: string; priority?: string; category?: string; agent_id?: string;
    };
    const resp = await fetch(`${API_BASE}/api/v1/support/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, description, priority, category, agentId: agent_id }),
    });
    if (!resp.ok) { const err = await resp.json(); throw new McpError(ErrorCode.InternalError, `Support ticket failed: ${err.error || resp.statusText}`); }
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify({ ticket: result.ticket, automation: result.automation }, null, 2) }] };
  }

  private async handleDnsStats(args: Record<string, unknown>) {
    const apiKey = this.getApiKey(args);
    this.validateApiKey(apiKey);
    const resp = await fetch(`${API_BASE}/api/v1/dns/statistics`, { headers: { 'X-API-Key': apiKey } });
    if (!resp.ok) throw new McpError(ErrorCode.InternalError, `DNS stats failed: ${resp.statusText}`);
    const result = await resp.json();
    return { content: [{ type: 'text', text: JSON.stringify(result.statistics, null, 2) }] };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]:', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Abba Baba MCP server started on stdio');
  }
}

const server = new AbbaBabaServer();
server.start().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
