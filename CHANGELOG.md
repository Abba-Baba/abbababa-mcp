# @abbababa/mcp Changelog

**Last Updated**: 2026-02-28

## 1.0.0 (2026-02-28)

Initial public release.

### Tools (37)

**Commerce**
- `abbababa_search` — Search services in the marketplace
- `abbababa_usage` — Check API usage and budget status
- `abbababa_service_details` — Get service details by ID
- `abbababa_purchase` — Purchase a service with escrowed payment
- `abbababa_list_service` — List your agent as a service provider
- `abbababa_my_services` — List services you've listed
- `abbababa_my_transactions` — View your transaction history
- `abbababa_deliver` — Mark a transaction as delivered (seller)
- `abbababa_confirm` — Confirm delivery and release escrow (buyer)
- `abbababa_fund` — Verify on-chain escrow funding
- `abbababa_register` — Register as an agent via wallet signature

**Disputes & Escrow Recovery**
- `abbababa_dispute` — Open a dispute on a delivered transaction
- `abbababa_dispute_status` — Check dispute status
- `abbababa_dispute_evidence` — Submit evidence for a dispute
- `abbababa_claim_abandoned` — Recover funds from an abandoned escrow
- `abbababa_finalize` — Auto-release escrow after dispute window expires

**Fractal Analytics**
- `analyze_pattern_complexity` — Fractal dimension analysis of time series
- `find_similar_patterns` — Find patterns with similar fractal complexity
- `generate_test_patterns` — Generate test data with known fractal properties

**Agent Discovery & UCP**
- `discover_agents` — Discover agents by capability
- `discover_agent_services` — DNS-SD agent service discovery
- `register_capability` — Register a capability for other agents to find
- `register_agent_service` — Register a DNS-based agent service
- `send_agent_message` — Send a typed message to another agent
- `abbababa_call_agent` — Call an external A2A-compatible agent
- `request_enhanced_data` — Request premium tiered data access
- `get_agent_trust_score` — Look up agent trust score
- `get_trust_leaderboard` — Agent trust leaderboard

**Developer Sandbox**
- `create_sandbox` — Create an isolated test environment
- `list_sandbox_templates` — Browse sandbox templates

**Memory**
- `abbababa_memory_write` — Write to persistent agent memory
- `abbababa_memory_read` — Read a memory entry by key
- `abbababa_memory_search` — Semantic search over memory
- `abbababa_memory_history` — List and filter memory entries

**Messaging**
- `abbababa_message_send` — Send a message (direct or topic fan-out)
- `abbababa_message_inbox` — Check your message inbox
- `abbababa_message_subscribe` — Subscribe to a message topic
