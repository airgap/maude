# Provider Feature Matrix

This document tracks feature support across all AI providers in E.

Last Updated: 2026-02-18

## Feature Comparison

| Feature                  | Claude CLI | Claude API | Kiro CLI | Bedrock | Ollama    |
| ------------------------ | ---------- | ---------- | -------- | ------- | --------- |
| **Text Generation**      | ✅         | ✅         | ✅       | ✅      | ✅        |
| **Streaming**            | ✅         | ✅         | ✅       | ✅      | ✅        |
| **Conversation History** | ✅         | ✅         | ✅       | ✅      | ✅        |
| **System Prompts**       | ✅         | ✅         | ✅       | ✅      | ✅        |
| **Tool Calling**         | ✅         | ✅         | ✅       | ✅      | ✅        |
| **Tool Approval**        | ✅         | ❌         | ✅       | ✅      | ❌        |
| **MCP Integration**      | ✅         | ❌         | ✅       | ✅      | ✅        |
| **Vision/Images**        | ✅         | ✅         | ✅ (ACP) | ✅      | ✅        |
| **Computer Use**         | ✅         | ❌         | ❌       | ❌      | ❌        |
| **Session Resume**       | ✅         | ❌         | ✅       | ❌      | ❌        |
| **Token Counting**       | ✅         | ✅         | ❌       | ✅      | ✅        |
| **Cost Tracking**        | ✅         | ✅         | ❌       | ✅      | ✅ (Free) |
| **Plan Mode**            | ✅         | ✅         | ✅       | ✅      | ✅        |
| **Max Turns Limit**      | ✅         | ❌         | ❌       | ❌      | ❌        |
| **Budget Limit**         | ✅         | ❌         | ❌       | ❌      | ❌        |
| **Effort Settings**      | ✅         | ❌         | ❌       | ❌      | ❌        |

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

| Provider   | Latency    | Throughput | Cost     | Reliability |
| ---------- | ---------- | ---------- | -------- | ----------- |
| Claude CLI | Medium     | Medium     | API      | High        |
| Claude API | Low        | High       | API      | Very High   |
| Kiro CLI   | Medium     | Medium     | Variable | High        |
| Bedrock    | Low-Medium | High       | AWS      | Very High   |
| Ollama     | Low        | Variable   | Free     | Medium      |

## Use Case Recommendations

### Development & Debugging

**Recommended**: Claude CLI, Kiro CLI

- Full tool calling support
- MCP integration
- Local file access

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

**Recommended**: Ollama (free) or Haiku models

- Ollama: Free, unlimited local usage
- Claude Haiku: Cheapest API option ($0.25/$1.25 per M tokens)

## Migration Guide

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

### Q2 2026

- [ ] Computer use for Bedrock
- [ ] Enhanced MCP integration (HTTP/SSE transports)
- [ ] Persistent MCP server processes
- [ ] MCP bidirectional communication
- [ ] Image URLs (currently base64 only)

### Q3 2026

- [ ] Vertex AI integration
- [ ] Azure OpenAI integration
- [ ] Custom model endpoints

## Contributing

To add a new provider:

1. Create provider file in `src/services/<provider>-provider.ts`
2. Implement `createStream()` function
3. Add routing in `src/routes/stream.ts`
4. Add pricing in `src/services/cost-calculator.ts`
5. Add to `CliProvider` type in `shared/settings.ts`
6. Update documentation
7. Add tests

See existing providers for reference implementations.

## References

- [Claude API Documentation](https://docs.anthropic.com/claude/reference)
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Kiro CLI Documentation](https://kiro.dev/docs/cli/)
- [Ollama Documentation](https://ollama.com/docs)
- [MCP Specification](https://modelcontextprotocol.io/)
