# Provider Feature Matrix

This document tracks feature support across all AI providers in E.

Last Updated: 2026-02-18

## Feature Comparison

| Feature                  | Claude CLI | Claude API | Kiro CLI | Gemini CLI | Copilot CLI | Bedrock | Ollama    |
| ------------------------ | ---------- | ---------- | -------- | ---------- | ----------- | ------- | --------- |
| **Text Generation**      | ✅         | ✅         | ✅       | ✅         | ✅          | ✅      | ✅        |
| **Streaming**            | ✅         | ✅         | ✅       | ✅         | ✅          | ✅      | ✅        |
| **Conversation History** | ✅         | ✅         | ✅       | ✅         | ✅          | ✅      | ✅        |
| **System Prompts**       | ✅         | ✅         | ✅       | ✅         | ✅          | ✅      | ✅        |
| **Tool Calling**         | ✅         | ✅         | ✅       | ✅         | ✅          | ✅      | ✅        |
| **Tool Approval**        | ✅         | ❌         | ✅       | ❌         | ❌          | ✅      | ❌        |
| **MCP Integration**      | ✅         | ❌         | ✅       | ✅         | ⚠️          | ✅      | ✅        |
| **Vision/Images**        | ✅         | ✅         | ✅ (ACP) | ✅         | ✅          | ✅      | ✅        |
| **Computer Use**         | ✅         | ❌         | ❌       | ❌         | ❌          | ❌      | ❌        |
| **Session Resume**       | ✅         | ❌         | ✅       | ✅         | ✅          | ❌      | ❌        |
| **Token Counting**       | ✅         | ✅         | ❌       | ✅         | ✅          | ✅      | ✅        |
| **Cost Tracking**        | ✅         | ✅         | ❌       | ✅ (Free)  | ✅          | ✅      | ✅ (Free) |
| **Plan Mode**            | ✅         | ✅         | ✅       | ✅         | ✅          | ✅      | ✅        |
| **Max Turns Limit**      | ✅         | ❌         | ❌       | ❌         | ✅          | ❌      | ❌        |
| **Budget Limit**         | ✅         | ❌         | ❌       | ❌         | ❌          | ❌      | ❌        |
| **Effort Settings**      | ✅         | ❌         | ❌       | ❌         | ❌          | ❌      | ❌        |

**Legend:**

- ✅ Full Support
- ⚠️ Partial/Experimental Support
- ❌ Not Supported
- 🚧 In Development

## Provider Details

### Claude CLI

- **Pros**: Full feature set, tool calling, MCP, computer use
- **Cons**: Requires local installation, CLI interface
- **Best For**: Development workflows, full IDE replacement
- **Tool Calling**: Native support via CLI flags and prompts
- **Authentication**: OAuth or API key

### Claude API

- **Pros**: Direct API access, reliable, fast
- **Cons**: Limited tool calling, no MCP
- **Best For**: Production deployments, API integrations
- **Tool Calling**: Via Anthropic Messages API
- **Authentication**: API key or OAuth

### Kiro CLI

- **Pros**: ACP protocol, JSON-RPC, tool calling, multimodal support
- **Cons**: Requires kiro-cli installation, configuration
- **Best For**: Custom workflows, automation, multimodal development
- **Tool Calling**: Via ACP protocol
- **Vision/Images**: Yes - via ACP protocol (`promptCapabilities.image: true`)
- **Authentication**: Kiro credentials

### Gemini CLI

- **Pros**: Free generous usage (60 req/min, 1000/day), open-source, extensions system, stream-json output
- **Cons**: Requires Google account, newer ecosystem
- **Best For**: Cost-conscious developers, Google ecosystem users, rapid prototyping
- **Tool Calling**: ✅ Native tool support with extensions
- **MCP Integration**: ✅ Via `--mcp-config` flag and Gemini extensions
- **Vision/Images**: ✅ Multimodal support (Gemini 2.x models)
- **Session Resume**: ✅ Via `-r` session flag
- **Output Format**: stream-json (JSONL events: messages, tool calls, results)
- **Authentication**: Google account (free tier) or API key
- **Headless Mode**: `--output-format stream-json -p <prompt> --sandbox=off --yolo`

### GitHub Copilot CLI

- **Pros**: GitHub integration, multi-model support (Claude, GPT-5), custom agents, PR workflows
- **Cons**: Requires Copilot subscription, MCP limited in non-interactive mode
- **Best For**: GitHub-centric workflows, multi-model flexibility, PR/issue automation
- **Tool Calling**: ✅ Agent mode with file editing and command execution
- **MCP Integration**: ⚠️ Via `--additional-mcp-config` (limited in non-interactive mode)
- **Vision/Images**: ✅ Multi-modal support
- **Session Resume**: ✅ Via `-r` session flag
- **Output Format**: `--format json --no-interactive`
- **Authentication**: GitHub Copilot subscription (Individual, Business, or Enterprise)
- **Models Available**: Claude Sonnet 4.5, Claude Sonnet 4, GPT-5, and more via `/model` command

### AWS Bedrock

- **Pros**: AWS integration, enterprise compliance, regional deployment, tool calling, vision, MCP support
- **Cons**: AWS overhead, setup complexity
- **Best For**: AWS-native applications, enterprise
- **Tool Calling**: ✅ Full support (Read, Write, Edit, Bash, Grep, Glob, Web tools)
- **MCP Integration**: ✅ Automatic discovery and execution of MCP tools
- **Vision/Images**: ✅ Base64-encoded images supported
- **Tool Approval**: ✅ Dangerous tools require user approval
- **Authentication**: AWS credentials (IAM)

### Ollama

- **Pros**: Local models, free, privacy, offline, tool calling, vision (model-dependent), MCP support
- **Cons**: Model quality varies, feature support varies by model
- **Best For**: Local development, privacy-sensitive work, cost-conscious users
- **Tool Calling**: ✅ Supported for llama3.1, llama3.2, qwen2.5, mistral
- **MCP Integration**: ✅ Automatic discovery and execution of MCP tools
- **Vision/Images**: ✅ Supported for llama3.2-vision, llava, bakllava
- **Authentication**: None (local)

## Tool Calling Implementation Status

### Fully Implemented (Claude CLI, Kiro CLI)

✅ Built-in tools (Read, Write, Edit, Bash, Glob, Grep)
✅ Web tools (WebFetch, WebSearch)
✅ Agent tools (Task, TodoWrite)
✅ Planning tools (EnterPlanMode, ExitPlanMode)
✅ Notebook tools (NotebookEdit)
✅ MCP tools integration
✅ Tool approval flow
✅ Sandbox restrictions

### CLI Providers (Gemini CLI, Copilot CLI)

✅ Stream JSON / JSON output parsing
✅ Non-interactive / headless mode
✅ System prompt injection
✅ Model selection
✅ MCP configuration passthrough
✅ Session resume
⚠️ Tool approval flow (handled by E, not the CLI)
⚠️ Budget/effort limits (not natively supported by all CLIs)

### Partially Implemented (Claude API)

✅ Messages API tool calling
❌ Built-in tools not exposed through API
❌ No MCP integration
❌ No approval flow

### Fully Implemented (Bedrock, Ollama)

✅ Tool definitions (Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, NotebookEdit)
✅ Tool execution via tool-executor.ts
✅ Tool approval for dangerous tools (Bedrock only)
✅ Multi-turn tool sequences
✅ MCP integration - automatic discovery and execution of MCP tools
✅ MCP tool caching (5-minute TTL)
✅ MCP tool security (dangerous tools require approval)
✅ Seamless integration of built-in and MCP tools

**Note**: Ollama tool calling is model-dependent. Use llama3.1, llama3.2, qwen2.5, or mistral for best results.

## Image/Vision Support

### Fully Implemented (Claude CLI, Claude API)

- ✅ Base64-encoded images
- ✅ Image URLs
- ✅ Multi-modal content blocks
- ✅ Screenshot capture (CLI only)
- ✅ Vision API integration

### Implemented via ACP (Kiro CLI)

- ✅ Base64-encoded images (via ACP protocol)
- ✅ Multi-modal content blocks
- ✅ `promptCapabilities.image: true` advertised
- ✅ Can process whiteboard photos, diagrams, screenshots
- ✅ Supports visual development workflows
- ⚠️ Full implementation pending in E (ACP protocol integration needed)

### Gemini CLI

- ✅ Multi-modal support via Gemini 2.x models
- ✅ Base64-encoded images in prompts
- ✅ Vision/image analysis in headless mode
- ✅ Extensions can provide additional image processing

### GitHub Copilot CLI

- ✅ Multi-modal support
- ✅ Image analysis in non-interactive mode
- ✅ Works with vision-capable models (GPT-5, Claude)

### Fully Implemented (Bedrock)

- ✅ Base64-encoded images in messages
- ✅ Multi-modal content blocks
- ✅ Works with Claude 3 Opus, Sonnet, Haiku vision models
- ⚠️ Image URLs not yet supported (base64 only)

### Model-Dependent (Ollama)

- ✅ Base64-encoded images (llama3.2-vision, llava, bakllava)
- ✅ Multi-modal content blocks
- ⚠️ Feature availability depends on downloaded model
- ⚠️ Screenshot tools not yet integrated

## Model Availability

### Claude CLI

- claude-opus-4-6
- claude-sonnet-4-5-20250929
- claude-haiku-4-5-20251001
- All Anthropic models

### Claude API

- Same as Claude CLI
- Direct Anthropic API access

### Kiro CLI

- Configured per agent
- Supports Claude models

### Gemini CLI

- gemini-2.5-pro (default, free tier)
- gemini-2.5-flash
- gemini-2.0-flash
- gemini-2.0-flash-lite
- All Gemini models accessible with Google account

### GitHub Copilot CLI

- claude-sonnet-4.5 (default)
- claude-sonnet-4
- gpt-5
- Additional models via `/model` command
- Model availability tied to Copilot subscription tier

### AWS Bedrock

- anthropic.claude-3-opus-20240229-v1:0
- anthropic.claude-3-5-sonnet-20241022-v2:0
- anthropic.claude-3-haiku-20240307-v1:0
- Region-specific availability

### Ollama

- Any locally installed Ollama model
- llama3.1, qwen2.5, mistral, etc.
- Model-dependent features

## Performance Characteristics

| Provider    | Latency    | Throughput | Cost        | Reliability |
| ----------- | ---------- | ---------- | ----------- | ----------- |
| Claude CLI  | Medium     | Medium     | API         | High        |
| Claude API  | Low        | High       | API         | Very High   |
| Kiro CLI    | Medium     | Medium     | Variable    | High        |
| Gemini CLI  | Low        | High       | Free/API    | High        |
| Copilot CLI | Low-Medium | Medium     | Subscription| High        |
| Bedrock     | Low-Medium | High       | AWS         | Very High   |
| Ollama      | Low        | Variable   | Free        | Medium      |

## Use Case Recommendations

### Development & Debugging

**Recommended**: Claude CLI, Kiro CLI, Copilot CLI

- Full tool calling support
- MCP integration
- Local file access
- Copilot CLI adds GitHub workflow integration

### Production API

**Recommended**: Claude API, Bedrock

- High reliability
- Scalable
- Enterprise-grade

### Privacy & Offline

**Recommended**: Ollama

- No data leaves machine
- Free
- Works offline

### AWS-Native Applications

**Recommended**: Bedrock

- VPC integration
- IAM security
- CloudWatch integration

### Cost-Conscious

**Recommended**: Gemini CLI (free) or Ollama (free) or Haiku models

- Gemini CLI: Free, generous usage limits (60 req/min, 1000/day) with Gemini 2.5 Pro
- Ollama: Free, unlimited local usage
- Claude Haiku: Cheapest API option ($0.25/$1.25 per M tokens)

### GitHub-Centric Workflows

**Recommended**: Copilot CLI

- Native GitHub integration (PRs, issues, branches)
- Multi-model flexibility
- Custom agents and task delegation
- Seamless `gh` CLI integration

## Migration Guide

### From Claude CLI to Gemini CLI

**Pros**:

- Free generous usage (no API costs for personal accounts)
- Open-source with extensions ecosystem
- Similar CLI interface (stream-json output, -p flag)

**Cons**:

- Different model capabilities
- Some flags not directly mapped
- Newer, evolving ecosystem

**Steps**:

1. Install Gemini CLI: `npm install -g @anthropic-ai/gemini-cli` or via `brew`
2. Authenticate with Google account
3. Change CLI provider to `Gemini CLI` in Settings → General
4. Tools and MCP config are passed through automatically

### From Claude CLI to Copilot CLI

**Pros**:

- Multi-model support (Claude + GPT-5 in one CLI)
- Deep GitHub integration for PR workflows
- Custom agent support

**Cons**:

- Requires Copilot subscription
- MCP support limited in non-interactive mode
- Different output format (JSON vs stream-json)

**Steps**:

1. Install Copilot CLI: `gh extension install github/copilot-cli`
2. Ensure active Copilot subscription
3. Change CLI provider to `Copilot CLI` in Settings → General
4. E handles format translation automatically

### From Claude CLI to Bedrock

**Pros**:

- AWS billing integration
- Lower latency for AWS infrastructure
- VPC endpoints
- Full tool calling and MCP support

**Cons**:

- More setup complexity
- AWS costs

**Steps**:

1. Enable Bedrock model access in AWS console
2. Configure AWS credentials
3. Change model to `bedrock:claude-sonnet-3.5`
4. Tool calling and MCP tools work automatically

### From Ollama to Claude

**Pros**:

- Much better quality
- Tool calling support
- Vision support

**Cons**:

- API costs
- Requires internet
- Privacy considerations

**Steps**:

1. Get Anthropic API key
2. Set `ANTHROPIC_API_KEY` environment variable
3. Change provider to `claude`
4. Change model to `claude-sonnet-4-5-20250929`

### From Claude API to Bedrock

**Pros**:

- AWS integration
- Regional deployment
- Compliance (HIPAA, SOC 2)
- Full tool calling and MCP support

**Cons**:

- More complex setup

**Steps**:

1. Follow Bedrock setup guide
2. Change model prefix to `bedrock:`
3. Configure AWS credentials

## Roadmap

### Q1 2026

- [x] Bedrock basic integration
- [x] Ollama streaming support
- [x] Bedrock tool calling
- [x] Image support for Bedrock
- [x] Ollama tool calling (model-dependent)
- [x] Vision support for Bedrock and Ollama
- [x] MCP integration for Bedrock and Ollama
- [x] Gemini CLI integration (headless mode, stream-json)
- [x] GitHub Copilot CLI integration (non-interactive, JSON output)

### Q2 2026

- [ ] Computer use for Bedrock
- [ ] Enhanced MCP integration (HTTP/SSE transports)
- [ ] Persistent MCP server processes
- [ ] MCP bidirectional communication
- [ ] Image URLs (currently base64 only)
- [ ] Full Gemini CLI extensions integration
- [ ] Copilot CLI custom agents passthrough

### Q3 2026

- [ ] Vertex AI integration
- [ ] Azure OpenAI integration
- [ ] Custom model endpoints
- [ ] Aider CLI integration
- [ ] OpenCode CLI integration

## Contributing

To add a new provider:

1. Create provider file in `src/services/<provider>-provider.ts`
2. Implement `createStream()` function
3. Add routing in `src/routes/stream.ts`
4. Add pricing in `src/services/cost-calculator.ts`
5. Add to `CliProvider` type in `shared/settings.ts`
6. Add command builder in `src/services/cli-provider.ts`
7. Add to UI in `SettingsModal.svelte`
8. Update documentation
9. Add tests

See existing providers for reference implementations.

## References

- [Claude API Documentation](https://docs.anthropic.com/claude/reference)
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Kiro CLI Documentation](https://kiro.dev/docs/cli/)
- [Gemini CLI Documentation](https://geminicli.com/docs/)
- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli)
- [GitHub Copilot CLI](https://github.com/github/copilot-cli)
- [GitHub Copilot CLI Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli)
- [Ollama Documentation](https://ollama.com/docs)
- [MCP Specification](https://modelcontextprotocol.io/)
