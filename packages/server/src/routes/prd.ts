import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type {
  PRDCreateInput,
  StoryPriority,
  PlanSprintRequest,
  PlanSprintResponse,
  GenerateStoriesRequest,
  GeneratedStory,
  RefineStoryRequest,
  RefinementQuestion,
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  DependencyWarning,
  StoryDependency,
  AnalyzeDependenciesRequest,
  SprintValidation,
  SprintValidationWarning,
  UserStory,
  ValidateACRequest,
  ValidateACResponse,
  ACCriterionValidation,
  ACValidationIssue,
  EstimateStoryRequest,
  EstimateStoryResponse,
  EstimatePrdRequest,
  EstimatePrdResponse,
  StoryEstimate,
  StorySize,
  EstimateConfidence,
  EstimationFactor,
  SprintPlanRequest,
  SprintPlanResponse,
  SprintRecommendation,
  SprintStoryAssignment,
  PRDCompletenessAnalysis,
  PRDSectionAnalysis,
  PRDSectionName,
  PRDSectionSeverity,
  AnalyzePrdCompletenessRequest,
  AnalyzePrdCompletenessResponse,
  StoryTemplate,
  StoryTemplateCategory,
  CreateTemplateRequest,
  CreateStoryFromTemplateRequest,
  CreateStoryFromTemplateResponse,
  PriorityRecommendation,
  PriorityFactor,
  PriorityRecommendationResponse,
  PriorityRecommendationBulkResponse,
  StandaloneStoryCreateInput,
} from '@e/shared';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const app = new Hono();

// List PRDs (optionally filtered by workspacePath)
app.get('/', (c) => {
  const db = getDb();
  const workspacePath = c.req.query('workspacePath');

  let rows: any[];
  if (workspacePath) {
    rows = db
      .query('SELECT * FROM prds WHERE workspace_path = ? ORDER BY updated_at DESC')
      .all(workspacePath);
  } else {
    rows = db.query('SELECT * FROM prds ORDER BY updated_at DESC').all();
  }

  return c.json({
    ok: true,
    data: rows.map(prdFromRow),
  });
});

// ============================================================================
// --- Standalone Story Routes ---
// NOTE: These routes MUST be defined before /:id to avoid being caught by the catch-all param route.
// Standalone stories have prd_id = NULL and belong directly to a workspace.
// ============================================================================

// List standalone stories for a workspace
app.get('/stories', (c) => {
  const db = getDb();
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query parameter is required' }, 400);
  }

  const rows = db
    .query(
      'SELECT * FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? ORDER BY sort_order ASC, created_at ASC',
    )
    .all(workspacePath) as any[];

  return c.json({ ok: true, data: rows.map(storyFromRow) });
});

// List all stories (standalone + PRD-bound) for a workspace
app.get('/stories/all', (c) => {
  const db = getDb();
  const workspacePath = c.req.query('workspacePath');
  if (!workspacePath) {
    return c.json({ ok: false, error: 'workspacePath query parameter is required' }, 400);
  }

  // Standalone stories
  const standaloneRows = db
    .query(
      'SELECT * FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ? ORDER BY sort_order ASC, created_at ASC',
    )
    .all(workspacePath) as any[];

  // PRD-bound stories via JOIN
  const prdStoryRows = db
    .query(
      `SELECT ps.*, p.name as prd_name FROM prd_stories ps
       JOIN prds p ON ps.prd_id = p.id
       WHERE p.workspace_path = ?
       ORDER BY ps.prd_id, ps.sort_order ASC`,
    )
    .all(workspacePath) as any[];

  return c.json({
    ok: true,
    data: {
      standalone: standaloneRows.map(storyFromRow),
      byPrd: prdStoryRows.map((row: any) => ({
        ...storyFromRow(row),
        prdName: row.prd_name,
      })),
    },
  });
});

// Create a standalone story
app.post('/stories', async (c) => {
  const body = (await c.req.json()) as StandaloneStoryCreateInput;
  const db = getDb();

  if (!body.workspacePath || !body.title?.trim()) {
    return c.json({ ok: false, error: 'workspacePath and title are required' }, 400);
  }

  const id = nanoid(12);
  const now = Date.now();

  // Get max sort_order for standalone stories in this workspace
  const maxRow = db
    .query(
      'SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id IS NULL AND workspace_path = ?',
    )
    .get(body.workspacePath) as any;
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  const criteria = (body.acceptanceCriteria || []).map((desc: string) => ({
    id: nanoid(6),
    description: desc,
    passed: false,
  }));

  db.query(
    `INSERT INTO prd_stories (
      id, prd_id, workspace_path, title, description, acceptance_criteria,
      priority, depends_on, dependency_reasons, status,
      attempts, max_attempts, learnings, sort_order, created_at, updated_at
    )
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, '{}', 'pending', 0, 3, '[]', ?, ?, ?)`,
  ).run(
    id,
    body.workspacePath,
    body.title.trim(),
    body.description || '',
    JSON.stringify(criteria),
    body.priority || 'medium',
    JSON.stringify(body.dependsOn || []),
    sortOrder,
    now,
    now,
  );

  const row = db.query('SELECT * FROM prd_stories WHERE id = ?').get(id) as any;
  return c.json({ ok: true, data: storyFromRow(row) }, 201);
});

// Reorder standalone stories
app.post('/stories/reorder', async (c) => {
  const db = getDb();
  const body = (await c.req.json()) as { storyIds: string[] };

  if (!body.storyIds || !Array.isArray(body.storyIds) || body.storyIds.length === 0) {
    return c.json({ ok: false, error: 'storyIds array is required' }, 400);
  }

  const now = Date.now();

  // Update sort_order for each story based on position in the array
  for (let i = 0; i < body.storyIds.length; i++) {
    db.query('UPDATE prd_stories SET sort_order = ?, updated_at = ? WHERE id = ?').run(
      i,
      now,
      body.storyIds[i],
    );
  }

  return c.json({ ok: true });
});

// Update a standalone story
app.patch('/stories/:storyId', async (c) => {
  const db = getDb();
  const storyId = c.req.param('storyId');
  const body = await c.req.json();

  const existing = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id IS NULL')
    .get(storyId) as any;
  if (!existing) {
    return c.json({ ok: false, error: 'Standalone story not found' }, 404);
  }

  const updates: string[] = [];
  const values: any[] = [];

  const fieldMap: Record<string, string> = {
    title: 'title',
    description: 'description',
    priority: 'priority',
    status: 'status',
    sortOrder: 'sort_order',
    externalStatus: 'external_status',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (body[key] !== undefined) {
      updates.push(`${col} = ?`);
      values.push(body[key]);
    }
  }

  // JSON fields
  if (body.acceptanceCriteria !== undefined) {
    const criteria = body.acceptanceCriteria.map((ac: any) =>
      typeof ac === 'string' ? { id: nanoid(6), description: ac, passed: false } : ac,
    );
    updates.push('acceptance_criteria = ?');
    values.push(JSON.stringify(criteria));
  }
  if (body.dependsOn !== undefined) {
    updates.push('depends_on = ?');
    values.push(JSON.stringify(body.dependsOn));
  }
  if (body.dependencyReasons !== undefined) {
    updates.push('dependency_reasons = ?');
    values.push(JSON.stringify(body.dependencyReasons));
  }
  if (body.externalRef !== undefined) {
    updates.push('external_ref = ?');
    values.push(body.externalRef ? JSON.stringify(body.externalRef) : null);
  }

  if (updates.length === 0) {
    return c.json({ ok: true, data: storyFromRow(existing) });
  }

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(storyId);

  db.query(`UPDATE prd_stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
  return c.json({ ok: true, data: storyFromRow(updated) });
});

// Delete a standalone story
app.delete('/stories/:storyId', (c) => {
  const db = getDb();
  const storyId = c.req.param('storyId');

  const existing = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id IS NULL')
    .get(storyId) as any;
  if (!existing) {
    return c.json({ ok: false, error: 'Standalone story not found' }, 404);
  }

  db.query('DELETE FROM prd_stories WHERE id = ? AND prd_id IS NULL').run(storyId);
  return c.json({ ok: true });
});

// Estimate a standalone story
app.post('/stories/:storyId/estimate', async (c) => {
  const db = getDb();
  const storyId = c.req.param('storyId');

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id IS NULL')
    .get(storyId) as any;
  if (!storyRow) {
    return c.json({ ok: false, error: 'Standalone story not found' }, 404);
  }

  const story = storyFromRow(storyRow);

  // Reuse the AI estimation logic (same as PRD story estimation)
  const criteriaText = story.acceptanceCriteria.map((ac: any) => ac.description).join('\n- ');

  const systemPrompt = `You are a senior software engineer who estimates user stories using the Fibonacci story points scale (1, 2, 3, 5, 8, 13).

Return a JSON object with EXACTLY this structure:
{
  "size": "small" | "medium" | "large",
  "storyPoints": <number: 1|2|3|5|8|13>,
  "confidence": "low" | "medium" | "high",
  "confidenceScore": <number: 0-100>,
  "factors": [{"factor": "<description>", "impact": "increases"|"decreases"|"neutral", "weight": "minor"|"moderate"|"major"}],
  "reasoning": "<brief explanation>",
  "suggestedBreakdown": ["<sub-task>"] // ONLY for stories >= 8 points
}

Guidelines:
- small (1-2 pts): simple change, single file, no dependencies
- medium (3-5 pts): moderate complexity, 2-4 files, some dependencies
- large (8-13 pts): high complexity, many files, significant dependencies
- suggestedBreakdown is ONLY for stories estimated at 8+ points`;

  const userPrompt = `Estimate the complexity of this story:

Title: ${story.title}
Description: ${story.description}
${criteriaText ? `Acceptance Criteria:\n- ${criteriaText}` : ''}
Priority: ${story.priority}

Provide a complexity estimate with story points, confidence level, and key factors.`;

  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      throw new Error(`API request failed: ${apiResponse.status}`);
    }

    const apiData = (await apiResponse.json()) as any;
    const response = apiData.content?.[0]?.text || '';
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const parsed = JSON.parse(jsonMatch[0]);

    const estimate: StoryEstimate = {
      storyId,
      size: parsed.size || 'medium',
      storyPoints: parsed.storyPoints || 3,
      confidence: parsed.confidence || 'medium',
      confidenceScore: parsed.confidenceScore || 50,
      factors: parsed.factors || [],
      reasoning: (parsed.reasoning || 'Estimate based on story content analysis.').trim(),
      suggestedBreakdown: parsed.suggestedBreakdown,
      isManualOverride: false,
    };

    db.query('UPDATE prd_stories SET estimate = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(estimate),
      Date.now(),
      storyId,
    );

    return c.json({ ok: true, data: { storyId, estimate } });
  } catch (err) {
    return c.json({ ok: false, error: `Estimation failed: ${String(err)}` }, 500);
  }
});

// Save a manual estimate for a standalone story
app.put('/stories/:storyId/estimate', async (c) => {
  const db = getDb();
  const storyId = c.req.param('storyId');
  const body = await c.req.json();

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id IS NULL')
    .get(storyId) as any;
  if (!storyRow) {
    return c.json({ ok: false, error: 'Standalone story not found' }, 404);
  }

  const existingEstimate = storyRow.estimate ? JSON.parse(storyRow.estimate) : {};

  const estimate: StoryEstimate = {
    ...existingEstimate,
    storyId,
    size: body.size || existingEstimate.size || 'medium',
    storyPoints: body.storyPoints ?? existingEstimate.storyPoints ?? 3,
    confidence: 'high',
    confidenceScore: 100,
    reasoning: body.reasoning || 'Manual estimate',
    isManualOverride: true,
  };

  db.query('UPDATE prd_stories SET estimate = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(estimate),
    Date.now(),
    storyId,
  );

  return c.json({ ok: true, data: { storyId, estimate } });
});

// --- List all templates ---
// NOTE: Template routes MUST be defined before /:id to avoid being caught by the catch-all param route
app.get('/templates', (c) => {
  const db = getDb();
  seedBuiltInTemplates();

  const category = c.req.query('category');
  let rows: any[];
  if (category) {
    rows = db
      .query('SELECT * FROM story_templates WHERE category = ? ORDER BY is_built_in DESC, name ASC')
      .all(category);
  } else {
    rows = db.query('SELECT * FROM story_templates ORDER BY is_built_in DESC, name ASC').all();
  }

  return c.json({ ok: true, data: rows.map(templateFromRow) });
});

// --- Get a single template ---
app.get('/templates/:templateId', (c) => {
  const db = getDb();
  seedBuiltInTemplates();

  const row = db.query('SELECT * FROM story_templates WHERE id = ?').get(c.req.param('templateId'));
  if (!row) {
    return c.json({ ok: false, error: 'Template not found' }, 404);
  }
  return c.json({ ok: true, data: templateFromRow(row) });
});

// --- Create a custom template ---
app.post('/templates', async (c) => {
  const db = getDb();
  const body = (await c.req.json()) as CreateTemplateRequest;

  if (!body.name?.trim()) {
    return c.json({ ok: false, error: 'Template name is required' }, 400);
  }
  if (!body.category) {
    return c.json({ ok: false, error: 'Template category is required' }, 400);
  }

  const id = nanoid(12);
  const now = Date.now();

  db.query(
    `INSERT INTO story_templates (id, name, description, category, title_template, description_template,
     acceptance_criteria_templates, priority, tags, is_built_in, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    body.name.trim(),
    body.description?.trim() || '',
    body.category,
    body.titleTemplate?.trim() || '',
    body.descriptionTemplate?.trim() || '',
    JSON.stringify(body.acceptanceCriteriaTemplates || []),
    body.priority || 'medium',
    JSON.stringify(body.tags || []),
    now,
    now,
  );

  const row = db.query('SELECT * FROM story_templates WHERE id = ?').get(id);
  return c.json({ ok: true, data: templateFromRow(row) }, 201);
});

// --- Update a custom template ---
app.patch('/templates/:templateId', async (c) => {
  const db = getDb();
  const templateId = c.req.param('templateId');
  const body = await c.req.json();

  const existing = db.query('SELECT * FROM story_templates WHERE id = ?').get(templateId) as any;
  if (!existing) {
    return c.json({ ok: false, error: 'Template not found' }, 404);
  }

  // Don't allow editing built-in templates' core fields, but allow all edits on custom
  const now = Date.now();
  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description.trim());
  }
  if (body.category !== undefined) {
    updates.push('category = ?');
    values.push(body.category);
  }
  if (body.titleTemplate !== undefined) {
    updates.push('title_template = ?');
    values.push(body.titleTemplate.trim());
  }
  if (body.descriptionTemplate !== undefined) {
    updates.push('description_template = ?');
    values.push(body.descriptionTemplate.trim());
  }
  if (body.acceptanceCriteriaTemplates !== undefined) {
    updates.push('acceptance_criteria_templates = ?');
    values.push(JSON.stringify(body.acceptanceCriteriaTemplates));
  }
  if (body.priority !== undefined) {
    updates.push('priority = ?');
    values.push(body.priority);
  }
  if (body.tags !== undefined) {
    updates.push('tags = ?');
    values.push(JSON.stringify(body.tags));
  }

  if (updates.length === 0) {
    return c.json({ ok: true, data: templateFromRow(existing) });
  }

  updates.push('updated_at = ?');
  values.push(now);
  values.push(templateId);

  db.query(`UPDATE story_templates SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const row = db.query('SELECT * FROM story_templates WHERE id = ?').get(templateId);
  return c.json({ ok: true, data: templateFromRow(row) });
});

// --- Delete a custom template ---
app.delete('/templates/:templateId', (c) => {
  const db = getDb();
  const templateId = c.req.param('templateId');

  const existing = db.query('SELECT * FROM story_templates WHERE id = ?').get(templateId) as any;
  if (!existing) {
    return c.json({ ok: false, error: 'Template not found' }, 404);
  }
  if (existing.is_built_in) {
    return c.json({ ok: false, error: 'Cannot delete built-in templates' }, 400);
  }

  db.query('DELETE FROM story_templates WHERE id = ?').run(templateId);
  return c.json({ ok: true });
});

// Get single PRD with all stories
app.get('/:id', (c) => {
  const db = getDb();
  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(c.req.param('id')) as any;
  if (!prdRow) return c.json({ ok: false, error: 'Not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdRow.id) as any[];

  return c.json({
    ok: true,
    data: {
      ...prdFromRow(prdRow),
      stories: stories.map(storyFromRow),
    },
  });
});

// Create PRD with stories
app.post('/', async (c) => {
  const body = (await c.req.json()) as PRDCreateInput;
  const db = getDb();
  const prdId = nanoid(12);
  const now = Date.now();

  db.query(
    `INSERT INTO prds (id, workspace_path, name, description, branch_name, quality_checks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    prdId,
    body.workspacePath,
    body.name,
    body.description || '',
    body.branchName || null,
    JSON.stringify(body.qualityChecks || []),
    now,
    now,
  );

  // Create stories
  const storyInsert = db.query(
    `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const storyIds: string[] = [];
  for (let i = 0; i < (body.stories || []).length; i++) {
    const s = body.stories[i];
    const storyId = nanoid(12);
    storyIds.push(storyId);

    const criteria = s.acceptanceCriteria.map((desc) => ({
      id: nanoid(8),
      description: desc,
      passed: false,
    }));

    storyInsert.run(
      storyId,
      prdId,
      s.title,
      s.description || '',
      JSON.stringify(criteria),
      s.priority || 'medium',
      JSON.stringify(s.dependsOn || []),
      i,
      now,
      now,
    );
  }

  return c.json({ ok: true, data: { id: prdId, storyIds } }, 201);
});

// Update PRD metadata
app.patch('/:id', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const id = c.req.param('id');

  const existing = db.query('SELECT * FROM prds WHERE id = ?').get(id);
  if (!existing) return c.json({ ok: false, error: 'Not found' }, 404);

  const updates: string[] = [];
  const values: any[] = [];

  for (const field of ['name', 'description', 'branch_name'] as const) {
    const camelField = field === 'branch_name' ? 'branchName' : field;
    if (body[camelField] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(body[camelField]);
    }
  }
  if (body.qualityChecks !== undefined) {
    updates.push('quality_checks = ?');
    values.push(JSON.stringify(body.qualityChecks));
  }

  if (updates.length === 0) return c.json({ ok: false, error: 'No fields to update' }, 400);

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.query(`UPDATE prds SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return c.json({ ok: true });
});

// Delete PRD (cascades to stories)
app.delete('/:id', (c) => {
  const db = getDb();
  const id = c.req.param('id');
  const result = db.query('DELETE FROM prds WHERE id = ?').run(id);
  if (result.changes === 0) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

// Add story to existing PRD
app.post('/:id/stories', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const prdId = c.req.param('id');

  const prd = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prd) return c.json({ ok: false, error: 'PRD not found' }, 404);

  // Get max sort_order
  const maxRow = db
    .query('SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id = ?')
    .get(prdId) as any;
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  const storyId = nanoid(12);
  const now = Date.now();

  const criteria = (body.acceptanceCriteria || []).map((desc: string) => ({
    id: nanoid(8),
    description: desc,
    passed: false,
  }));

  db.query(
    `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    storyId,
    prdId,
    body.title,
    body.description || '',
    JSON.stringify(criteria),
    body.priority || 'medium',
    JSON.stringify(body.dependsOn || []),
    sortOrder,
    now,
    now,
  );

  // Touch PRD updated_at
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  return c.json({ ok: true, data: { id: storyId } }, 201);
});

// Update a story
app.patch('/:prdId/stories/:storyId', async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const storyId = c.req.param('storyId');

  const existing = db.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId) as any;
  if (!existing) return c.json({ ok: false, error: 'Story not found' }, 404);

  const updates: string[] = [];
  const values: any[] = [];

  const fieldMap: Record<string, string> = {
    title: 'title',
    description: 'description',
    priority: 'priority',
    status: 'status',
    taskId: 'task_id',
    agentId: 'agent_id',
    conversationId: 'conversation_id',
    commitSha: 'commit_sha',
    attempts: 'attempts',
    maxAttempts: 'max_attempts',
    sortOrder: 'sort_order',
  };

  for (const [camel, snake] of Object.entries(fieldMap)) {
    if (body[camel] !== undefined) {
      updates.push(`${snake} = ?`);
      values.push(body[camel]);
    }
  }

  if (body.acceptanceCriteria !== undefined) {
    updates.push('acceptance_criteria = ?');
    values.push(JSON.stringify(body.acceptanceCriteria));
  }
  if (body.dependsOn !== undefined) {
    updates.push('depends_on = ?');
    values.push(JSON.stringify(body.dependsOn));
  }
  if (body.learnings !== undefined) {
    updates.push('learnings = ?');
    values.push(JSON.stringify(body.learnings));
  }
  if (body.estimate !== undefined) {
    updates.push('estimate = ?');
    values.push(body.estimate ? JSON.stringify(body.estimate) : null);
  }
  // Append a single learning without replacing
  if (body.addLearning) {
    const current = JSON.parse(existing.learnings || '[]');
    current.push(body.addLearning);
    updates.push('learnings = ?');
    values.push(JSON.stringify(current));
  }

  if (updates.length === 0) return c.json({ ok: false, error: 'No fields to update' }, 400);

  const now = Date.now();
  updates.push('updated_at = ?');
  values.push(now);
  values.push(storyId);

  db.query(`UPDATE prd_stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Touch PRD updated_at
  const prdId = c.req.param('prdId');
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  // Invalidate priority recommendations when dependencies change
  if (body.dependsOn !== undefined) {
    // Invalidate this story's recommendation since its dependencies changed
    db.query(
      'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ?',
    ).run(now, storyId);
    // Also invalidate recommendations for stories that were previously depended on
    // (they might have had their blocksCount change)
    const oldDeps: string[] = JSON.parse(existing.depends_on || '[]');
    const newDeps: string[] = body.dependsOn;
    const affectedIds = new Set([...oldDeps, ...newDeps]);
    for (const depId of affectedIds) {
      db.query(
        'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ?',
      ).run(now, depId);
    }
  }

  // Invalidate priority recommendations for related stories when priority changes
  // (sibling stories' recommendations may reference this story's priority level)
  if (body.priority !== undefined && body.priority !== existing.priority) {
    // Invalidate recommendations for stories that depend on this one or that this one depends on
    const deps: string[] = JSON.parse(existing.depends_on || '[]');
    const allPrdStories = db
      .query('SELECT id, depends_on FROM prd_stories WHERE prd_id = ?')
      .all(prdId) as any[];
    const blockedByThis = allPrdStories
      .filter((s: any) => {
        const d: string[] = JSON.parse(s.depends_on || '[]');
        return d.includes(storyId);
      })
      .map((s: any) => s.id);
    const affectedIds = new Set([...deps, ...blockedByThis]);
    for (const id of affectedIds) {
      db.query(
        'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ?',
      ).run(now, id);
    }
  }

  const updated = db.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId);
  return c.json({ ok: true, data: storyFromRow(updated as any) });
});

// Delete a story
app.delete('/:prdId/stories/:storyId', (c) => {
  const db = getDb();
  const storyId = c.req.param('storyId');
  const result = db.query('DELETE FROM prd_stories WHERE id = ?').run(storyId);
  if (result.changes === 0) return c.json({ ok: false, error: 'Story not found' }, 404);

  // Touch PRD updated_at
  const prdId = c.req.param('prdId');
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(Date.now(), prdId);

  return c.json({ ok: true });
});

// Import Ralph-format prd.json
app.post('/import', async (c) => {
  const body = await c.req.json();
  const { workspacePath, prdJson } = body;

  if (!workspacePath || !prdJson) {
    return c.json({ ok: false, error: 'workspacePath and prdJson required' }, 400);
  }

  // Parse Ralph format:
  // { project, branchName, description, userStories: [{ id, title, description, acceptanceCriteria, priority, passes }] }
  const ralph = typeof prdJson === 'string' ? JSON.parse(prdJson) : prdJson;

  const db = getDb();
  const prdId = nanoid(12);
  const now = Date.now();

  db.query(
    `INSERT INTO prds (id, workspace_path, name, description, branch_name, quality_checks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
  ).run(
    prdId,
    workspacePath,
    ralph.project || 'Imported PRD',
    ralph.description || '',
    ralph.branchName || null,
    now,
    now,
  );

  const storyInsert = db.query(
    `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, status, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
  );

  const storyIds: string[] = [];
  const ralphStories = ralph.userStories || ralph.stories || [];

  for (let i = 0; i < ralphStories.length; i++) {
    const rs = ralphStories[i];
    const storyId = nanoid(12);
    storyIds.push(storyId);

    // Ralph acceptanceCriteria can be string[] or {description}[]
    const rawCriteria = rs.acceptanceCriteria || [];
    const criteria = rawCriteria.map((ac: string | { description: string }) => ({
      id: nanoid(8),
      description: typeof ac === 'string' ? ac : ac.description,
      passed: false,
    }));

    // Map Ralph priority (number 1-4) to our string priority
    let priority: StoryPriority = 'medium';
    if (typeof rs.priority === 'number') {
      priority =
        rs.priority <= 1
          ? 'critical'
          : rs.priority === 2
            ? 'high'
            : rs.priority === 3
              ? 'medium'
              : 'low';
    } else if (typeof rs.priority === 'string') {
      priority = rs.priority as StoryPriority;
    }

    const status = rs.passes === true ? 'completed' : 'pending';

    storyInsert.run(
      storyId,
      prdId,
      rs.title,
      rs.description || '',
      JSON.stringify(criteria),
      priority,
      status,
      i,
      now,
      now,
    );
  }

  return c.json({ ok: true, data: { id: prdId, storyIds, imported: ralphStories.length } }, 201);
});

// Export PRD as Ralph-compatible prd.json
app.get('/:id/export', (c) => {
  const db = getDb();
  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(c.req.param('id')) as any;
  if (!prdRow) return c.json({ ok: false, error: 'Not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdRow.id) as any[];

  // Map priority string to Ralph number
  const priorityMap: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };

  const ralph = {
    project: prdRow.name,
    branchName: prdRow.branch_name || `ralph/${prdRow.name.toLowerCase().replace(/\s+/g, '-')}`,
    description: prdRow.description,
    userStories: stories.map((s, i) => ({
      id: `US-${String(i + 1).padStart(3, '0')}`,
      title: s.title,
      description: s.description,
      acceptanceCriteria: JSON.parse(s.acceptance_criteria || '[]').map(
        (ac: any) => ac.description || ac,
      ),
      priority: priorityMap[s.priority] || 3,
      passes: s.status === 'completed',
      notes: '',
    })),
  };

  return c.json({ ok: true, data: ralph });
});

// --- Story Generation ---

// Generate stories from a PRD description using AI
app.post('/:id/generate', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as GenerateStoriesRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  // Use PRD description if no description provided in request
  const description = body.description || prdRow.description;
  if (!description?.trim()) {
    return c.json(
      {
        ok: false,
        error:
          'No description provided. Supply a description in the request or set one on the PRD.',
      },
      400,
    );
  }

  // Build project memory context for better scoping
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 30`,
      )
      .all(prdRow.workspace_path) as any[];
    if (memRows.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const m of memRows) {
        if (!grouped[m.category]) grouped[m.category] = [];
        grouped[m.category].push(`- ${m.key}: ${m.content}`);
      }
      const labels: Record<string, string> = {
        convention: 'Coding Conventions',
        decision: 'Architecture Decisions',
        preference: 'User Preferences',
        pattern: 'Common Patterns',
        context: 'Project Context',
      };
      memoryContext = '\n\n## Project Memory\n';
      for (const [cat, items] of Object.entries(grouped)) {
        memoryContext += `\n### ${labels[cat] || cat}\n${items.join('\n')}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  // Check for existing stories to avoid duplicates
  const existingStories = db
    .query('SELECT title, description FROM prd_stories WHERE prd_id = ?')
    .all(prdId) as any[];
  let existingContext = '';
  if (existingStories.length > 0) {
    existingContext = '\n\n## Existing Stories (avoid duplicating these)\n';
    for (const s of existingStories) {
      existingContext += `- ${s.title}: ${s.description}\n`;
    }
  }

  const targetCount = body.count || 7; // Default target: 7 stories

  const systemPrompt = `You are an expert software project manager and technical architect. Your task is to break down a product requirements description into well-scoped user stories.

RULES:
1. Generate between 5 and 10 user stories (aim for ${targetCount}).
2. Each story MUST have a clear, concise title.
3. Each story MUST have a description explaining what needs to be done and why.
4. Each story MUST have at least 3 acceptance criteria that are specific and testable.
5. Stories should be appropriately scoped for a single implementation session (a few hours of focused work).
6. Stories should be ordered by priority and logical dependencies.
7. Assign priorities: "critical" for foundational/blocking work, "high" for core features, "medium" for important but not blocking, "low" for nice-to-haves.
8. Do NOT duplicate any existing stories listed below.

You MUST respond with ONLY a valid JSON array of story objects. No markdown, no explanation, no code fences. Just the raw JSON array.

Each story object must have this exact shape:
{
  "title": "string",
  "description": "string",
  "acceptanceCriteria": ["string", "string", "string"],
  "priority": "critical" | "high" | "medium" | "low"
}${memoryContext}${existingContext}`;

  const userPrompt = `Break down the following PRD description into user stories:

## PRD: ${prdRow.name}

${description}${body.context ? `\n\n## Additional Context\n${body.context}` : ''}`;

  // Call Anthropic API for generation
  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      return c.json(
        { ok: false, error: `AI generation failed (${apiResponse.status}): ${errBody}` },
        502,
      );
    }

    const result = (await apiResponse.json()) as any;
    const textContent = result.content?.find((c: any) => c.type === 'text');
    if (!textContent?.text) {
      return c.json({ ok: false, error: 'AI returned no text content' }, 502);
    }

    // Parse the JSON response - handle potential markdown code fences
    let rawText = textContent.text.trim();
    // Strip markdown code fences if present
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let generatedStories: GeneratedStory[];
    try {
      generatedStories = JSON.parse(rawText);
    } catch {
      return c.json({ ok: false, error: 'Failed to parse AI response as JSON. Try again.' }, 502);
    }

    // Validate the response shape
    if (!Array.isArray(generatedStories) || generatedStories.length === 0) {
      return c.json({ ok: false, error: 'AI returned empty or invalid stories array' }, 502);
    }

    const validPriorities = ['critical', 'high', 'medium', 'low'];
    const validatedStories: GeneratedStory[] = generatedStories
      .filter((s) => s.title && typeof s.title === 'string')
      .map((s) => ({
        title: s.title.trim(),
        description: (s.description || '').trim(),
        acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
          ? s.acceptanceCriteria
              .filter((ac: any) => typeof ac === 'string' && ac.trim())
              .map((ac: string) => ac.trim())
          : [],
        priority: validPriorities.includes(s.priority) ? s.priority : 'medium',
      }));

    // Ensure each story has at least 3 acceptance criteria
    for (const story of validatedStories) {
      while (story.acceptanceCriteria.length < 3) {
        story.acceptanceCriteria.push(
          `[Needs acceptance criterion ${story.acceptanceCriteria.length + 1}]`,
        );
      }
    }

    return c.json({
      ok: true,
      data: {
        stories: validatedStories,
        prdId,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: `Story generation failed: ${(err as Error).message}` }, 500);
  }
});

// Accept generated stories — bulk-add them to the PRD
app.post('/:id/generate/accept', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = await c.req.json();

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories: GeneratedStory[] = body.stories;
  if (!Array.isArray(stories) || stories.length === 0) {
    return c.json({ ok: false, error: 'No stories provided' }, 400);
  }

  // Get max sort_order
  const maxRow = db
    .query('SELECT MAX(sort_order) as max_order FROM prd_stories WHERE prd_id = ?')
    .get(prdId) as any;
  let sortOrder = (maxRow?.max_order ?? -1) + 1;

  const now = Date.now();
  const storyInsert = db.query(
    `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority, depends_on, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
  );

  const storyIds: string[] = [];
  for (const s of stories) {
    const storyId = nanoid(12);
    storyIds.push(storyId);

    const criteria = (s.acceptanceCriteria || []).map((desc: string) => ({
      id: nanoid(8),
      description: desc,
      passed: false,
    }));

    storyInsert.run(
      storyId,
      prdId,
      s.title,
      s.description || '',
      JSON.stringify(criteria),
      s.priority || 'medium',
      sortOrder++,
      now,
      now,
    );
  }

  // Touch PRD updated_at
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  return c.json({ ok: true, data: { storyIds, accepted: stories.length } }, 201);
});

// --- Story Refinement ---

// Refine a story by generating clarifying questions and incorporating answers
app.post('/:prdId/stories/:storyId/refine', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = (await c.req.json()) as RefineStoryRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const story = storyFromRow(storyRow);

  // Build project memory context
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 30`,
      )
      .all(prdRow.workspace_path) as any[];
    if (memRows.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const m of memRows) {
        if (!grouped[m.category]) grouped[m.category] = [];
        grouped[m.category].push(`- ${m.key}: ${m.content}`);
      }
      const labels: Record<string, string> = {
        convention: 'Coding Conventions',
        decision: 'Architecture Decisions',
        preference: 'User Preferences',
        pattern: 'Common Patterns',
        context: 'Project Context',
      };
      memoryContext = '\n\n## Project Memory\n';
      for (const [cat, items] of Object.entries(grouped)) {
        memoryContext += `\n### ${labels[cat] || cat}\n${items.join('\n')}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  // Build context about existing stories for reference
  const existingStories = db
    .query('SELECT title, description FROM prd_stories WHERE prd_id = ? AND id != ?')
    .all(prdId, storyId) as any[];
  let siblingContext = '';
  if (existingStories.length > 0) {
    siblingContext = '\n\n## Other Stories in this PRD\n';
    for (const s of existingStories) {
      siblingContext += `- ${s.title}: ${s.description}\n`;
    }
  }

  const hasAnswers = body.answers && body.answers.length > 0;

  // Build the prompt based on whether we have answers or this is the initial analysis
  let userPrompt: string;
  if (hasAnswers) {
    const answersText = body.answers!.map((a) => `Q: ${a.questionId}\nA: ${a.answer}`).join('\n\n');
    userPrompt = `The user has answered clarifying questions about this story. Use their answers to refine the story.

## Current Story
Title: ${story.title}
Description: ${story.description}
Priority: ${story.priority}
Acceptance Criteria:
${story.acceptanceCriteria.map((ac: any) => `- ${ac.description}`).join('\n')}

## User's Answers
${answersText}

Based on the answers, please:
1. Assess the story's quality (0-100 score)
2. Generate 2-5 NEW follow-up clarifying questions if quality is still below 80, OR generate 0 questions if the story is now well-defined
3. Provide an updated version of the story incorporating the user's answers
4. Explain what was unclear and how it was improved`;
  } else {
    userPrompt = `Analyze this user story and assess whether it has sufficient detail and clarity for implementation.

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}

## Story to Refine
Title: ${story.title}
Description: ${story.description}
Priority: ${story.priority}
Acceptance Criteria:
${story.acceptanceCriteria.map((ac: any) => `- ${ac.description}`).join('\n')}

Please:
1. Assess the story's quality (0-100 score). Consider: clarity, specificity, testability of criteria, scope appropriateness, missing details.
2. Generate 2-5 targeted clarifying questions to improve the story
3. For each question, explain why it matters (context)
4. Optionally suggest likely answers for each question
5. Explain what aspects are unclear or could be improved`;
  }

  const systemPrompt = `You are an expert agile coach and technical product manager. Your job is to help refine user stories until they are clear, specific, and implementable.

A well-defined story should:
- Have a clear, specific title that describes the outcome
- Have a description that explains WHAT needs to be done, WHY it matters, and any important context
- Have acceptance criteria that are specific, testable, and complete
- Be appropriately scoped for a single implementation session (a few hours)
- Not have ambiguous terms or undefined behavior
- Consider edge cases and error scenarios

Quality scoring guide:
- 90-100: Excellent — ready for implementation with no ambiguity
- 70-89: Good — minor clarifications might help but story is implementable
- 50-69: Fair — some important details missing, would benefit from refinement
- 30-49: Needs work — multiple areas of ambiguity
- 0-29: Very vague — major details missing, significant refinement needed

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences. Just the raw JSON.

The JSON must have this exact shape:
{
  "qualityScore": <number 0-100>,
  "qualityExplanation": "<string explaining what is unclear or could be improved>",
  "meetsThreshold": <boolean, true if qualityScore >= 80>,
  "questions": [
    {
      "id": "<unique short id>",
      "question": "<the clarifying question>",
      "context": "<why this question matters for implementation>",
      "suggestedAnswers": ["<optional suggestion 1>", "<optional suggestion 2>"]
    }
  ],
  "improvements": ["<description of improvement 1>", "<description of improvement 2>"],
  "updatedStory": {
    "title": "<refined title>",
    "description": "<refined description>",
    "acceptanceCriteria": ["<criterion 1>", "<criterion 2>", ...],
    "priority": "critical" | "high" | "medium" | "low"
  }
}

IMPORTANT:
- Generate 2-5 questions when the story needs refinement (quality < 80)
- Generate 0 questions when the story meets the quality threshold (quality >= 80)
- The "improvements" array should list specific changes made (only when updatedStory is provided with answers)
- Always provide updatedStory when answers are given
- Questions should be targeted and specific, not generic${memoryContext}${siblingContext}`;

  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      return c.json(
        { ok: false, error: `AI refinement failed (${apiResponse.status}): ${errBody}` },
        502,
      );
    }

    const result = (await apiResponse.json()) as any;
    const textContent = result.content?.find((ct: any) => ct.type === 'text');
    if (!textContent?.text) {
      return c.json({ ok: false, error: 'AI returned no text content' }, 502);
    }

    // Parse the JSON response
    let rawText = textContent.text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI refinement response as JSON. Try again.' },
        502,
      );
    }

    // Validate and shape the response
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    const questions: RefinementQuestion[] = (parsed.questions || [])
      .filter((q: any) => q.question && typeof q.question === 'string')
      .slice(0, 5)
      .map((q: any) => ({
        id: q.id || nanoid(8),
        question: q.question.trim(),
        context: (q.context || '').trim(),
        suggestedAnswers: Array.isArray(q.suggestedAnswers)
          ? q.suggestedAnswers.filter((s: any) => typeof s === 'string' && s.trim())
          : undefined,
      }));

    const qualityScore =
      typeof parsed.qualityScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.qualityScore)))
        : 50;

    const response: any = {
      storyId,
      questions,
      qualityScore,
      qualityExplanation: parsed.qualityExplanation || 'No explanation provided.',
      meetsThreshold: qualityScore >= 80,
    };

    if (parsed.updatedStory) {
      response.updatedStory = {
        title: (parsed.updatedStory.title || story.title).trim(),
        description: (parsed.updatedStory.description || story.description).trim(),
        acceptanceCriteria: Array.isArray(parsed.updatedStory.acceptanceCriteria)
          ? parsed.updatedStory.acceptanceCriteria
              .filter((ac: any) => typeof ac === 'string' && ac.trim())
              .map((ac: string) => ac.trim())
          : story.acceptanceCriteria.map((ac: any) => ac.description),
        priority: validPriorities.includes(parsed.updatedStory.priority)
          ? parsed.updatedStory.priority
          : story.priority,
      };
    }

    if (Array.isArray(parsed.improvements)) {
      response.improvements = parsed.improvements
        .filter((imp: any) => typeof imp === 'string' && imp.trim())
        .map((imp: string) => imp.trim());
    }

    // If answers were provided and there's an updated story, auto-apply the refinement
    if (hasAnswers && response.updatedStory) {
      const updated = response.updatedStory;
      const now = Date.now();
      const criteria = updated.acceptanceCriteria.map((desc: string) => ({
        id: nanoid(8),
        description: desc,
        passed: false,
      }));

      db.query(
        `UPDATE prd_stories SET title = ?, description = ?, acceptance_criteria = ?, priority = ?, updated_at = ? WHERE id = ?`,
      ).run(
        updated.title,
        updated.description,
        JSON.stringify(criteria),
        updated.priority,
        now,
        storyId,
      );

      db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);
    }

    return c.json({ ok: true, data: response });
  } catch (err) {
    return c.json({ ok: false, error: `Story refinement failed: ${(err as Error).message}` }, 500);
  }
});

// --- Sprint Planning ---

// Create a planning conversation for a PRD
app.post('/:id/plan', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as PlanSprintRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  // Build project memory context
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 50`,
      )
      .all(prdRow.workspace_path) as any[];
    if (memRows.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const m of memRows) {
        if (!grouped[m.category]) grouped[m.category] = [];
        grouped[m.category].push(`- ${m.key}: ${m.content}`);
      }
      const labels: Record<string, string> = {
        convention: 'Coding Conventions',
        decision: 'Architecture Decisions',
        preference: 'User Preferences',
        pattern: 'Common Patterns',
        context: 'Project Context',
      };
      memoryContext = '\n\n## Project Memory\n';
      for (const [cat, items] of Object.entries(grouped)) {
        memoryContext += `\n### ${labels[cat] || cat}\n${items.join('\n')}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  // Build stories context
  let storiesContext = '';
  if (stories.length > 0) {
    storiesContext = `\n\n## Current Stories (${stories.length})\n`;
    for (const s of stories) {
      const mapped = storyFromRow(s);
      const criteria = mapped.acceptanceCriteria
        .map((ac: any) => `  - ${ac.description}`)
        .join('\n');
      storiesContext += `\n### ${mapped.title} [${mapped.status}] (${mapped.priority}) {id: ${mapped.id}}\n`;
      if (mapped.description) storiesContext += `${mapped.description}\n`;
      if (criteria) storiesContext += `Acceptance Criteria:\n${criteria}\n`;
    }
  } else {
    storiesContext =
      '\n\n## Current Stories\nNo stories yet — this PRD needs stories to be planned.\n';
  }

  // Build edit instructions based on editMode (locked / propose / unlocked)
  const editMode = body.editMode || 'locked';
  const storyEditBlock = `
To add a new story:
<story-add>
title: Story title here
description: Detailed description of the story
priority: medium
criteria:
- First acceptance criterion
- Second acceptance criterion
</story-add>

To edit an existing story (use the story id from the list above):
<story-edit id="STORY_ID">
title: Updated title
description: Updated description
priority: high
criteria:
- Updated criterion 1
- Updated criterion 2
</story-edit>

To remove a story:
<story-remove id="STORY_ID">
reason: Explanation of why this story should be removed
</story-remove>

You may include multiple blocks in a single response alongside your normal discussion text.
Always explain your reasoning before or after the structured blocks.`;

  let editInstructions: string;
  if (editMode === 'propose') {
    editInstructions = `\n\n## Story Edit Format
When you want to suggest adding, editing, or removing stories, use these structured blocks.
The user will see each suggestion and can choose to apply it.
${storyEditBlock}`;
  } else if (editMode === 'unlocked') {
    editInstructions = `\n\n## Story Edit Format
When you want to add, edit, or remove stories, use these structured blocks.
Your changes will be applied automatically.
${storyEditBlock}`;
  } else {
    editInstructions = `\n\n## Instructions
Discuss stories and planning in a readable format. The user will manually add stories to the PRD based on your suggestions.
Do not use any special structured markup — just discuss naturally.`;
  }

  // Build system prompt
  const systemPrompt = `You are helping plan a sprint for a software project.

## PRD: ${prdRow.name}
${prdRow.description || '(No description provided)'}
${storiesContext}${memoryContext}${editInstructions}

Focus on breaking down work into well-scoped, independent user stories with clear acceptance criteria.
Consider dependencies between stories and suggest a priority ordering.
Each story should be implementable in a single focused session.`;

  // Create the planning conversation
  const conversationId = nanoid();
  const now = Date.now();
  const model = body.model || 'sonnet';

  db.query(
    `INSERT INTO conversations (id, title, model, system_prompt, workspace_path, plan_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    conversationId,
    `[Plan] ${prdRow.name}`,
    model,
    systemPrompt,
    prdRow.workspace_path,
    now,
    now,
  );

  const response: PlanSprintResponse = {
    conversationId,
    prdId,
    mode: body.mode,
    editMode,
  };

  return c.json({ ok: true, data: response }, 201);
});

// --- Dependency Management ---

// Get dependency graph for a PRD
app.get('/:id/dependencies', (c) => {
  const db = getDb();
  const prdId = c.req.param('id');

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  const graph = buildDependencyGraph(stories.map(storyFromRow), prdId);
  return c.json({ ok: true, data: graph });
});

// Add or update a dependency between two stories
app.post('/:id/dependencies', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = await c.req.json();

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const { fromStoryId, toStoryId, reason } = body;
  if (!fromStoryId || !toStoryId) {
    return c.json({ ok: false, error: 'fromStoryId and toStoryId required' }, 400);
  }
  if (fromStoryId === toStoryId) {
    return c.json({ ok: false, error: 'A story cannot depend on itself' }, 400);
  }

  // Verify both stories exist and belong to this PRD
  const fromStory = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(fromStoryId, prdId) as any;
  const toStory = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(toStoryId, prdId) as any;
  if (!fromStory)
    return c.json({ ok: false, error: `Story ${fromStoryId} not found in this PRD` }, 404);
  if (!toStory)
    return c.json({ ok: false, error: `Story ${toStoryId} not found in this PRD` }, 404);

  // fromStoryId depends on toStoryId (toStoryId blocks fromStoryId)
  const dependsOn: string[] = JSON.parse(fromStory.depends_on || '[]');
  const reasons: Record<string, string> = JSON.parse(fromStory.dependency_reasons || '{}');
  const now = Date.now();

  let changed = false;
  if (!dependsOn.includes(toStoryId)) {
    dependsOn.push(toStoryId);
    changed = true;
  }

  // Store or update reason
  if (reason) {
    reasons[toStoryId] = reason;
    changed = true;
  }

  if (changed) {
    db.query(
      'UPDATE prd_stories SET depends_on = ?, dependency_reasons = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(dependsOn), JSON.stringify(reasons), now, fromStoryId);
    // Invalidate priority recommendations for affected stories when dependencies change
    db.query(
      'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ? OR id = ?',
    ).run(now, fromStoryId, toStoryId);
    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);
  }

  // Return the updated graph
  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];
  const graph = buildDependencyGraph(stories.map(storyFromRow), prdId);

  return c.json({ ok: true, data: graph });
});

// Remove a dependency between two stories
app.delete('/:id/dependencies', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = await c.req.json();

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const { fromStoryId, toStoryId } = body;
  if (!fromStoryId || !toStoryId) {
    return c.json({ ok: false, error: 'fromStoryId and toStoryId required' }, 400);
  }

  const fromStory = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(fromStoryId, prdId) as any;
  if (!fromStory)
    return c.json({ ok: false, error: `Story ${fromStoryId} not found in this PRD` }, 404);

  const dependsOn: string[] = JSON.parse(fromStory.depends_on || '[]');
  const reasons: Record<string, string> = JSON.parse(fromStory.dependency_reasons || '{}');
  const filtered = dependsOn.filter((id) => id !== toStoryId);

  if (filtered.length !== dependsOn.length) {
    // Also remove the reason for this dependency
    delete reasons[toStoryId];
    const now = Date.now();
    db.query(
      'UPDATE prd_stories SET depends_on = ?, dependency_reasons = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(filtered), JSON.stringify(reasons), now, fromStoryId);
    // Invalidate priority recommendations for affected stories when dependencies change
    db.query(
      'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ? OR id = ?',
    ).run(now, fromStoryId, toStoryId);
    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);
  }

  // Return the updated graph
  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];
  const graph = buildDependencyGraph(stories.map(storyFromRow), prdId);

  return c.json({ ok: true, data: graph });
});

// Edit a dependency's reason
app.patch('/:id/dependencies', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = await c.req.json();

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const { fromStoryId, toStoryId, reason } = body;
  if (!fromStoryId || !toStoryId) {
    return c.json({ ok: false, error: 'fromStoryId and toStoryId required' }, 400);
  }

  const fromStory = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(fromStoryId, prdId) as any;
  if (!fromStory)
    return c.json({ ok: false, error: `Story ${fromStoryId} not found in this PRD` }, 404);

  const dependsOn: string[] = JSON.parse(fromStory.depends_on || '[]');
  if (!dependsOn.includes(toStoryId)) {
    return c.json({ ok: false, error: 'Dependency does not exist' }, 404);
  }

  const reasons: Record<string, string> = JSON.parse(fromStory.dependency_reasons || '{}');
  if (reason !== undefined && reason !== null) {
    if (reason === '') {
      delete reasons[toStoryId];
    } else {
      reasons[toStoryId] = reason;
    }
  }

  const now = Date.now();
  db.query('UPDATE prd_stories SET dependency_reasons = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(reasons),
    now,
    fromStoryId,
  );
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  // Return the updated graph
  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];
  const graph = buildDependencyGraph(stories.map(storyFromRow), prdId);

  return c.json({ ok: true, data: graph });
});

// AI-powered dependency analysis
app.post('/:id/dependencies/analyze', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as AnalyzeDependenciesRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  if (stories.length < 2) {
    return c.json({ ok: false, error: 'Need at least 2 stories to analyze dependencies' }, 400);
  }

  const mappedStories = stories.map(storyFromRow);

  // Build story context for AI analysis
  let storyContext = '';
  for (const s of mappedStories) {
    const criteria = s.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');
    storyContext += `\n### Story "${s.title}" (ID: ${s.id}) [${s.priority}]
${s.description}
Acceptance Criteria:
${criteria}\n`;
  }

  // Preserve manually-added dependencies (they won't be in the AI result)
  // A dependency is "manual" if it existed before analysis and we're not replacing
  const existingDeps: Map<string, string[]> = new Map();
  if (!body.replaceAutoDetected) {
    for (const s of mappedStories) {
      if (s.dependsOn.length > 0) {
        existingDeps.set(s.id, [...s.dependsOn]);
      }
    }
  }

  const systemPrompt = `You are an expert software architect analyzing user stories for a product requirements document to identify dependencies between them.

A dependency exists when one story MUST be completed before another can start. Common reasons:
- Story B builds on infrastructure/features created by Story A
- Story B requires APIs, schemas, or data models defined in Story A
- Story B extends or modifies functionality created by Story A
- Story B tests or validates something implemented in Story A

RULES:
1. Only identify real, technical dependencies — not just thematic relationships
2. A story can depend on multiple other stories
3. Avoid circular dependencies (A→B→C→A)
4. Consider the acceptance criteria when determining dependencies
5. If two stories are independent, do NOT create a dependency between them

You MUST respond with ONLY a valid JSON array. No markdown, no explanation, no code fences.

Each dependency object must have this shape:
{
  "fromStoryId": "<ID of the story that DEPENDS ON another>",
  "toStoryId": "<ID of the story that must be done FIRST>",
  "reason": "<brief explanation of why this dependency exists>"
}

Only return dependencies you are confident about. Empty array [] is valid if stories are independent.`;

  const userPrompt = `Analyze these stories for the PRD "${prdRow.name}" and identify dependencies between them:
${storyContext}

Which stories must be completed before others can start? Return the dependency list as JSON.`;

  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      return c.json(
        { ok: false, error: `AI analysis failed (${apiResponse.status}): ${errBody}` },
        502,
      );
    }

    const result = (await apiResponse.json()) as any;
    const textContent = result.content?.find((ct: any) => ct.type === 'text');
    if (!textContent?.text) {
      return c.json({ ok: false, error: 'AI returned no text content' }, 502);
    }

    let rawText = textContent.text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let aiDeps: Array<{ fromStoryId: string; toStoryId: string; reason?: string }>;
    try {
      aiDeps = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI dependency analysis as JSON. Try again.' },
        502,
      );
    }

    if (!Array.isArray(aiDeps)) {
      return c.json({ ok: false, error: 'AI returned invalid dependency format' }, 502);
    }

    // Validate story IDs
    const storyIds = new Set(mappedStories.map((s) => s.id));
    const validDeps = aiDeps.filter(
      (d) =>
        d.fromStoryId &&
        d.toStoryId &&
        storyIds.has(d.fromStoryId) &&
        storyIds.has(d.toStoryId) &&
        d.fromStoryId !== d.toStoryId,
    );

    // Build new depends_on maps
    const newDepsMap: Map<string, Set<string>> = new Map();
    for (const s of mappedStories) {
      newDepsMap.set(s.id, new Set());
    }

    // If not replacing, keep existing manual deps
    if (!body.replaceAutoDetected) {
      for (const [storyId, deps] of existingDeps) {
        for (const dep of deps) {
          newDepsMap.get(storyId)?.add(dep);
        }
      }
    }

    // Add AI-detected deps
    for (const dep of validDeps) {
      newDepsMap.get(dep.fromStoryId)?.add(dep.toStoryId);
    }

    // Check for circular dependencies and remove them
    const circularPairs = detectCircularDependencies(newDepsMap);
    for (const [from, to] of circularPairs) {
      // Remove the AI-added dependency that creates the cycle
      const wasExisting = existingDeps.get(from)?.includes(to);
      if (!wasExisting) {
        newDepsMap.get(from)?.delete(to);
      }
    }

    // Build reasons map from AI analysis
    const aiReasonsMap: Map<string, Record<string, string>> = new Map();
    for (const dep of validDeps) {
      if (dep.reason) {
        if (!aiReasonsMap.has(dep.fromStoryId)) {
          aiReasonsMap.set(dep.fromStoryId, {});
        }
        aiReasonsMap.get(dep.fromStoryId)![dep.toStoryId] = dep.reason;
      }
    }

    // Persist to database
    const now = Date.now();
    for (const [storyId, deps] of newDepsMap) {
      const currentRow = db
        .query('SELECT depends_on, dependency_reasons FROM prd_stories WHERE id = ?')
        .get(storyId) as any;
      const currentDeps = JSON.parse(currentRow?.depends_on || '[]');
      const currentReasons: Record<string, string> = JSON.parse(
        currentRow?.dependency_reasons || '{}',
      );
      const newDeps = Array.from(deps);

      // Merge AI reasons into existing reasons (preserve manual overrides)
      const newReasons = { ...currentReasons };
      const aiReasons = aiReasonsMap.get(storyId) || {};
      for (const [depId, reason] of Object.entries(aiReasons)) {
        // Only set AI reason if no manual reason already exists, or if replacing
        if (!newReasons[depId] || body.replaceAutoDetected) {
          newReasons[depId] = reason;
        }
      }

      // Remove reasons for deps that no longer exist
      for (const key of Object.keys(newReasons)) {
        if (!newDeps.includes(key)) {
          delete newReasons[key];
        }
      }

      // Only update if changed
      const depsChanged = JSON.stringify(currentDeps.sort()) !== JSON.stringify(newDeps.sort());
      const reasonsChanged = JSON.stringify(currentReasons) !== JSON.stringify(newReasons);
      if (depsChanged || reasonsChanged) {
        db.query(
          'UPDATE prd_stories SET depends_on = ?, dependency_reasons = ?, updated_at = ? WHERE id = ?',
        ).run(JSON.stringify(newDeps), JSON.stringify(newReasons), now, storyId);
        // Invalidate priority recommendations when dependencies change
        db.query(
          'UPDATE prd_stories SET priority_recommendation = NULL, updated_at = ? WHERE id = ?',
        ).run(now, storyId);
      }
    }

    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

    // Reload stories and build graph
    const updatedStories = db
      .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(prdId) as any[];
    const graph = buildDependencyGraph(updatedStories.map(storyFromRow), prdId);

    const dependencies: StoryDependency[] = validDeps.map((d) => ({
      fromStoryId: d.fromStoryId,
      toStoryId: d.toStoryId,
      type: 'blocked_by' as const,
      reason: d.reason,
      autoDetected: true,
    }));

    return c.json({
      ok: true,
      data: {
        prdId,
        dependencies,
        graph,
      },
    });
  } catch (err) {
    return c.json(
      { ok: false, error: `Dependency analysis failed: ${(err as Error).message}` },
      500,
    );
  }
});

// Validate sprint plan — warn about missing dependencies
app.get('/:id/dependencies/validate', (c) => {
  const db = getDb();
  const prdId = c.req.param('id');

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  const validation = validateSprintPlan(stories.map(storyFromRow));
  return c.json({ ok: true, data: validation });
});

// --- Dependency Graph Builder ---

function buildDependencyGraph(stories: UserStory[], prdId: string): DependencyGraph {
  const storyMap = new Map(stories.map((s) => [s.id, s]));
  const completedIds = new Set(stories.filter((s) => s.status === 'completed').map((s) => s.id));

  // Build edges
  const edges: DependencyEdge[] = [];
  const blocksMap = new Map<string, Set<string>>(); // storyId -> set of stories it blocks
  const blockedByMap = new Map<string, Set<string>>(); // storyId -> set of stories blocking it

  for (const s of stories) {
    blocksMap.set(s.id, new Set());
    blockedByMap.set(s.id, new Set());
  }

  for (const story of stories) {
    for (const depId of story.dependsOn) {
      if (storyMap.has(depId)) {
        edges.push({
          from: depId,
          to: story.id,
          reason: story.dependencyReasons?.[depId],
        });
        blocksMap.get(depId)?.add(story.id);
        blockedByMap.get(story.id)?.add(depId);
      }
    }
  }

  // Calculate depth using BFS topological approach
  const depthMap = new Map<string, number>();
  const calculateDepth = (storyId: string, visited: Set<string> = new Set()): number => {
    if (depthMap.has(storyId)) return depthMap.get(storyId)!;
    if (visited.has(storyId)) return 0; // circular dep protection
    visited.add(storyId);

    const deps = blockedByMap.get(storyId) || new Set();
    if (deps.size === 0) {
      depthMap.set(storyId, 0);
      return 0;
    }

    let maxDepth = 0;
    for (const depId of deps) {
      maxDepth = Math.max(maxDepth, calculateDepth(depId, visited) + 1);
    }
    depthMap.set(storyId, maxDepth);
    return maxDepth;
  };

  for (const s of stories) {
    calculateDepth(s.id);
  }

  // Build nodes
  const nodes: DependencyNode[] = stories.map((s) => ({
    storyId: s.id,
    title: s.title,
    status: s.status,
    priority: s.priority,
    blocksCount: blocksMap.get(s.id)?.size || 0,
    blockedByCount: blockedByMap.get(s.id)?.size || 0,
    isReady: Array.from(blockedByMap.get(s.id) || []).every((depId) => completedIds.has(depId)),
    depth: depthMap.get(s.id) || 0,
  }));

  // Check for warnings
  const warnings: DependencyWarning[] = [];

  // Circular dependency detection
  const depsMapForCycle = new Map<string, Set<string>>();
  for (const s of stories) {
    depsMapForCycle.set(s.id, new Set(s.dependsOn.filter((id) => storyMap.has(id))));
  }
  const circularPairs = detectCircularDependencies(depsMapForCycle);
  if (circularPairs.length > 0) {
    const involvedIds = new Set<string>();
    for (const [from, to] of circularPairs) {
      involvedIds.add(from);
      involvedIds.add(to);
    }
    warnings.push({
      type: 'circular',
      message: `Circular dependencies detected involving stories: ${Array.from(involvedIds)
        .map((id) => storyMap.get(id)?.title || id)
        .join(', ')}`,
      storyIds: Array.from(involvedIds),
    });
  }

  // Orphan dependency (depends on a story ID that doesn't exist)
  for (const story of stories) {
    for (const depId of story.dependsOn) {
      if (!storyMap.has(depId)) {
        warnings.push({
          type: 'orphan_dependency',
          message: `Story "${story.title}" depends on non-existent story ID: ${depId}`,
          storyIds: [story.id],
        });
      }
    }
  }

  // Unresolved blockers (pending/in_progress stories that have uncompleted dependencies)
  for (const story of stories) {
    if (story.status === 'pending' || story.status === 'in_progress') {
      const unresolvedDeps = story.dependsOn.filter(
        (depId) => storyMap.has(depId) && !completedIds.has(depId),
      );
      if (unresolvedDeps.length > 0) {
        warnings.push({
          type: 'unresolved_blocker',
          message: `Story "${story.title}" is blocked by: ${unresolvedDeps.map((id) => storyMap.get(id)?.title || id).join(', ')}`,
          storyIds: [story.id, ...unresolvedDeps],
        });
      }
    }
  }

  return { prdId, nodes, edges, warnings };
}

function detectCircularDependencies(depsMap: Map<string, Set<string>>): Array<[string, string]> {
  const circularPairs: Array<[string, string]> = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): boolean {
    if (inStack.has(node)) {
      // Found a cycle — record the back edge
      const cycleStart = path.indexOf(node);
      for (let i = cycleStart; i < path.length - 1; i++) {
        circularPairs.push([path[i], path[i + 1]]);
      }
      if (path.length > 0) {
        circularPairs.push([path[path.length - 1], node]);
      }
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    inStack.add(node);

    const deps = depsMap.get(node) || new Set();
    for (const dep of deps) {
      dfs(dep, [...path, node]);
    }

    inStack.delete(node);
    return false;
  }

  for (const node of depsMap.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return circularPairs;
}

function validateSprintPlan(stories: UserStory[]): SprintValidation {
  const storyMap = new Map(stories.map((s) => [s.id, s]));
  const completedIds = new Set(stories.filter((s) => s.status === 'completed').map((s) => s.id));
  const warnings: SprintValidationWarning[] = [];

  // Check for stories included in sprint that have unmet dependencies
  const pendingOrInProgress = stories.filter(
    (s) => s.status === 'pending' || s.status === 'in_progress',
  );

  for (const story of pendingOrInProgress) {
    const unmetDeps = story.dependsOn
      .filter((depId) => storyMap.has(depId))
      .filter((depId) => !completedIds.has(depId));

    if (unmetDeps.length > 0) {
      // Check if the blocking stories are also in the sprint (pending/in_progress)
      const blockingStories = unmetDeps.map((id) => storyMap.get(id)!).filter(Boolean);
      const blockingNotInSprint = blockingStories.filter(
        (bs) => bs.status !== 'pending' && bs.status !== 'in_progress',
      );

      if (blockingNotInSprint.length > 0) {
        warnings.push({
          type: 'missing_dependency',
          message: `Story "${story.title}" depends on stories not in the current sprint: ${blockingNotInSprint.map((s) => s.title).join(', ')}`,
          storyId: story.id,
          storyTitle: story.title,
          blockedByStoryIds: blockingNotInSprint.map((s) => s.id),
          blockedByStoryTitles: blockingNotInSprint.map((s) => s.title),
        });
      }

      // Always warn about blocked stories
      warnings.push({
        type: 'blocked_story',
        message: `Story "${story.title}" is blocked by: ${blockingStories.map((s) => s.title).join(', ')}. Ensure these are completed first.`,
        storyId: story.id,
        storyTitle: story.title,
        blockedByStoryIds: blockingStories.map((s) => s.id),
        blockedByStoryTitles: blockingStories.map((s) => s.title),
      });
    }
  }

  // Check for circular dependencies
  const depsMap = new Map<string, Set<string>>();
  for (const s of stories) {
    depsMap.set(s.id, new Set(s.dependsOn.filter((id) => storyMap.has(id))));
  }
  const circularPairs = detectCircularDependencies(depsMap);
  if (circularPairs.length > 0) {
    const involvedIds = new Set<string>();
    for (const [from, to] of circularPairs) {
      involvedIds.add(from);
      involvedIds.add(to);
    }
    for (const storyId of involvedIds) {
      const story = storyMap.get(storyId);
      if (story) {
        warnings.push({
          type: 'circular_dependency',
          message: `Story "${story.title}" is part of a circular dependency chain. This will prevent execution.`,
          storyId: story.id,
          storyTitle: story.title,
        });
      }
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

// --- Acceptance Criteria Validation ---

// Validate acceptance criteria for specificity, measurability, and testability
app.post('/:prdId/stories/:storyId/validate-criteria', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = (await c.req.json()) as ValidateACRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const story = storyFromRow(storyRow);

  // Use criteria from request body or fall back to stored criteria
  const criteria =
    body.criteria && body.criteria.length > 0
      ? body.criteria
      : story.acceptanceCriteria.map((ac: any) => ac.description);

  if (criteria.length === 0) {
    return c.json({ ok: false, error: 'No acceptance criteria to validate' }, 400);
  }

  const criteriaList = criteria.map((c: string, i: number) => `${i + 1}. "${c}"`).join('\n');

  const systemPrompt = `You are an expert agile coach specializing in writing high-quality acceptance criteria. Your task is to validate acceptance criteria for specificity, measurability, and testability.

VALIDATION RULES — check each criterion for:

1. **Specificity (vague)**: Flag criteria using vague language like "should work well", "user-friendly", "fast", "efficient", "appropriate", "proper", "good", "nice", "easy", "simple", "clean", "modern", "intuitive", "seamless", "robust", "scalable", "flexible", "relevant", "suitable", "reasonable", "adequate", etc.

2. **Measurability (unmeasurable)**: Flag criteria that cannot be objectively measured or verified. Good criteria define specific, observable outcomes (e.g., "returns HTTP 200" vs "works correctly").

3. **Testability (untestable)**: Flag criteria that a developer or QA engineer cannot write a concrete test for. Criteria should describe verifiable behavior, not aspirational goals.

4. **Scope (too_broad)**: Flag criteria that try to cover too many things at once or are too vague to implement in a single check.

5. **Ambiguity (ambiguous)**: Flag criteria with unclear terms, undefined references, or multiple possible interpretations.

6. **Missing Detail (missing_detail)**: Flag criteria that omit important specifics like error handling, edge cases, expected values, or user actions.

SEVERITY LEVELS:
- "error": Criterion is fundamentally unclear and MUST be rewritten before implementation
- "warning": Criterion could be improved but is still somewhat usable
- "info": Minor suggestion for improvement

SCORING:
- 90-100: Excellent criteria, specific and testable
- 70-89: Good, minor improvements possible
- 50-69: Fair, some criteria need attention
- 30-49: Poor, multiple criteria need rewriting
- 0-29: Very poor, most criteria are vague or untestable

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "overallScore": <number 0-100>,
  "allValid": <boolean>,
  "summary": "<brief overall assessment>",
  "criteria": [
    {
      "index": <0-based index>,
      "text": "<the original criterion text>",
      "isValid": <boolean>,
      "issues": [
        {
          "criterionIndex": <same 0-based index>,
          "criterionText": "<the criterion text>",
          "severity": "error" | "warning" | "info",
          "category": "vague" | "unmeasurable" | "untestable" | "too_broad" | "ambiguous" | "missing_detail",
          "message": "<clear explanation of the issue>",
          "suggestedReplacement": "<improved version of this criterion>"
        }
      ],
      "suggestedReplacement": "<improved version if any issues found, or null>"
    }
  ]
}

IMPORTANT:
- Validate EVERY criterion — even ones that pass should appear in the response with isValid: true and empty issues
- For each issue, ALWAYS provide a concrete suggestedReplacement
- Suggestions should be specific, measurable, and testable
- Keep the same intent as the original, just make it clearer
- Do NOT add new requirements — only clarify existing ones`;

  const storyContext = body.storyTitle || story.title;
  const storyDesc = body.storyDescription || story.description;

  const userPrompt = `Validate these acceptance criteria for the story "${storyContext}":

${storyDesc ? `Story Description: ${storyDesc}\n\n` : ''}Acceptance Criteria:
${criteriaList}

Analyze each criterion and identify any issues with specificity, measurability, or testability.`;

  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      return c.json(
        { ok: false, error: `AI validation failed (${apiResponse.status}): ${errBody}` },
        502,
      );
    }

    const result = (await apiResponse.json()) as any;
    const textContent = result.content?.find((ct: any) => ct.type === 'text');
    if (!textContent?.text) {
      return c.json({ ok: false, error: 'AI returned no text content' }, 502);
    }

    // Parse JSON response
    let rawText = textContent.text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI validation response as JSON. Try again.' },
        502,
      );
    }

    // Validate and shape the response
    const validSeverities = ['error', 'warning', 'info'];
    const validCategories = [
      'vague',
      'unmeasurable',
      'untestable',
      'too_broad',
      'ambiguous',
      'missing_detail',
    ];

    const validatedCriteria: ACCriterionValidation[] = (parsed.criteria || []).map(
      (cr: any, idx: number) => {
        const issues: ACValidationIssue[] = (cr.issues || [])
          .filter((iss: any) => iss.message && typeof iss.message === 'string')
          .map((iss: any) => ({
            criterionIndex: typeof iss.criterionIndex === 'number' ? iss.criterionIndex : idx,
            criterionText: (iss.criterionText || cr.text || criteria[idx] || '').trim(),
            severity: validSeverities.includes(iss.severity) ? iss.severity : 'warning',
            category: validCategories.includes(iss.category) ? iss.category : 'vague',
            message: iss.message.trim(),
            suggestedReplacement: iss.suggestedReplacement?.trim() || undefined,
          }));

        return {
          index: typeof cr.index === 'number' ? cr.index : idx,
          text: (cr.text || criteria[idx] || '').trim(),
          isValid:
            issues.length === 0 ||
            (cr.isValid === true && issues.every((i: any) => i.severity === 'info')),
          issues,
          suggestedReplacement: cr.suggestedReplacement?.trim() || undefined,
        };
      },
    );

    const overallScore =
      typeof parsed.overallScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.overallScore)))
        : 50;

    const response: ValidateACResponse = {
      storyId,
      overallScore,
      allValid: validatedCriteria.every((cr) => cr.isValid),
      criteria: validatedCriteria,
      summary: parsed.summary || 'Validation complete.',
    };

    return c.json({ ok: true, data: response });
  } catch (err) {
    return c.json(
      { ok: false, error: `Criteria validation failed: ${(err as Error).message}` },
      500,
    );
  }
});

// --- Story Estimation ---

// Estimate complexity for a single story
app.post('/:prdId/stories/:storyId/estimate', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = (await c.req.json()) as EstimateStoryRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const story = storyFromRow(storyRow);

  // Build context: all stories in the PRD for relative sizing
  const allStories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdId) as any[];
  const mappedStories = allStories.map(storyFromRow);

  // Build project memory context
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 30`,
      )
      .all(prdRow.workspace_path) as any[];
    if (memRows.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const m of memRows) {
        if (!grouped[m.category]) grouped[m.category] = [];
        grouped[m.category].push(`- ${m.key}: ${m.content}`);
      }
      const labels: Record<string, string> = {
        convention: 'Coding Conventions',
        decision: 'Architecture Decisions',
        preference: 'User Preferences',
        pattern: 'Common Patterns',
        context: 'Project Context',
      };
      memoryContext = '\n\n## Project Memory\n';
      for (const [cat, items] of Object.entries(grouped)) {
        memoryContext += `\n### ${labels[cat] || cat}\n${items.join('\n')}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  // Build sibling stories context for relative sizing
  let siblingContext = '';
  const otherStories = mappedStories.filter((s) => s.id !== storyId);
  if (otherStories.length > 0) {
    siblingContext = '\n\n## Other Stories in this PRD (for relative sizing)\n';
    for (const s of otherStories) {
      const acCount = s.acceptanceCriteria?.length || 0;
      const existingEstimate = s.estimate
        ? ` [Estimated: ${s.estimate.size}, ${s.estimate.storyPoints}pts]`
        : '';
      siblingContext += `- ${s.title}: ${s.description} (${acCount} criteria)${existingEstimate}\n`;
    }
  }

  const criteriaText = story.acceptanceCriteria.map((ac: any) => `- ${ac.description}`).join('\n');

  const depsCount = story.dependsOn?.length || 0;

  const systemPrompt = `You are an expert software project estimator. Your task is to provide complexity and effort estimates for user stories based on their content, acceptance criteria, and context.

ESTIMATION FRAMEWORK:
Use a combination of story points (Fibonacci: 1, 2, 3, 5, 8, 13) and t-shirt sizes (small, medium, large).

Mapping guide:
- **small** (1-2 points): Simple, well-understood tasks. Single file changes, minor UI tweaks, simple config, clear patterns to follow.
- **medium** (3-5 points): Moderate complexity. Multiple files, new components, API endpoints with some logic, database changes, moderate testing.
- **large** (8-13 points): Complex tasks. Cross-cutting concerns, new architectures, multiple integration points, significant testing, unknowns.

CONFIDENCE LEVELS:
- **high** (80-100): Story is well-defined, acceptance criteria are specific and testable, scope is clear.
- **medium** (50-79): Story is mostly clear but some ambiguity exists, some criteria could be more specific.
- **low** (0-49): Story is vague, criteria are unclear, significant unknowns or ambiguity.

FACTORS TO CONSIDER:
1. Number and complexity of acceptance criteria
2. Whether the story requires new architecture or follows existing patterns
3. Number of integration points (APIs, databases, external services)
4. UI complexity (forms, validation, state management)
5. Testing requirements (unit, integration, E2E)
6. Dependencies on other stories
7. Clarity and specificity of requirements
8. Potential for scope creep or hidden complexity
9. Whether similar work has been done before in the project

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "size": "small" | "medium" | "large",
  "storyPoints": <1 | 2 | 3 | 5 | 8 | 13>,
  "confidence": "low" | "medium" | "high",
  "confidenceScore": <number 0-100>,
  "factors": [
    {
      "factor": "<description of the factor>",
      "impact": "increases" | "decreases" | "neutral",
      "weight": "minor" | "moderate" | "major"
    }
  ],
  "reasoning": "<2-3 sentence explanation of the estimate>",
  "suggestedBreakdown": ["<sub-task 1>", "<sub-task 2>"] // only for large stories (8+ points)
}

IMPORTANT:
- Provide 3-6 factors that influenced your estimate
- Be specific in factor descriptions (not generic)
- suggestedBreakdown is ONLY for stories estimated at 8+ points
- Confidence should reflect story clarity, NOT your confidence in your own estimate
- Consider the project context and existing patterns when estimating${memoryContext}${siblingContext}`;

  const userPrompt = `Estimate the complexity of this user story:

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}

## Story to Estimate
Title: ${story.title}
Description: ${story.description}
Priority: ${story.priority}
Dependencies: ${depsCount > 0 ? `Depends on ${depsCount} other story(ies)` : 'None'}
Acceptance Criteria:
${criteriaText || '(No criteria defined)'}

Provide a complexity estimate with story points, confidence level, and key factors.`;

  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      return c.json(
        { ok: false, error: `AI estimation failed (${apiResponse.status}): ${errBody}` },
        502,
      );
    }

    const result = (await apiResponse.json()) as any;
    const textContent = result.content?.find((ct: any) => ct.type === 'text');
    if (!textContent?.text) {
      return c.json({ ok: false, error: 'AI returned no text content' }, 502);
    }

    // Parse JSON response
    let rawText = textContent.text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI estimation response as JSON. Try again.' },
        502,
      );
    }

    // Validate and normalize
    const validSizes: StorySize[] = ['small', 'medium', 'large'];
    const validPoints = [1, 2, 3, 5, 8, 13];
    const validConfidences: EstimateConfidence[] = ['low', 'medium', 'high'];

    const size: StorySize = validSizes.includes(parsed.size) ? parsed.size : 'medium';
    const storyPoints = validPoints.includes(parsed.storyPoints)
      ? parsed.storyPoints
      : size === 'small'
        ? 2
        : size === 'medium'
          ? 5
          : 8;
    const confidence: EstimateConfidence = validConfidences.includes(parsed.confidence)
      ? parsed.confidence
      : 'medium';
    const confidenceScore =
      typeof parsed.confidenceScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.confidenceScore)))
        : confidence === 'high'
          ? 85
          : confidence === 'medium'
            ? 60
            : 30;

    const factors: EstimationFactor[] = (parsed.factors || [])
      .filter((f: any) => f.factor && typeof f.factor === 'string')
      .slice(0, 6)
      .map((f: any) => ({
        factor: f.factor.trim(),
        impact: ['increases', 'decreases', 'neutral'].includes(f.impact) ? f.impact : 'neutral',
        weight: ['minor', 'moderate', 'major'].includes(f.weight) ? f.weight : 'moderate',
      }));

    const estimate: StoryEstimate = {
      storyId,
      size,
      storyPoints,
      confidence,
      confidenceScore,
      factors,
      reasoning: (parsed.reasoning || 'Estimate based on story content analysis.').trim(),
      suggestedBreakdown:
        storyPoints >= 8 && Array.isArray(parsed.suggestedBreakdown)
          ? parsed.suggestedBreakdown
              .filter((s: any) => typeof s === 'string' && s.trim())
              .map((s: string) => s.trim())
          : undefined,
      isManualOverride: false,
    };

    // Persist estimate to database
    const now = Date.now();
    db.query('UPDATE prd_stories SET estimate = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(estimate),
      now,
      storyId,
    );
    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

    return c.json({
      ok: true,
      data: { storyId, estimate },
    });
  } catch (err) {
    return c.json({ ok: false, error: `Story estimation failed: ${(err as Error).message}` }, 500);
  }
});

// Save a manual estimate override for a story
app.put('/:prdId/stories/:storyId/estimate', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = await c.req.json();

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const validSizes: StorySize[] = ['small', 'medium', 'large'];
  const validPoints = [1, 2, 3, 5, 8, 13];

  if (!validSizes.includes(body.size)) {
    return c.json({ ok: false, error: 'Invalid size. Must be small, medium, or large.' }, 400);
  }
  if (!validPoints.includes(body.storyPoints)) {
    return c.json({ ok: false, error: 'Invalid story points. Must be 1, 2, 3, 5, 8, or 13.' }, 400);
  }

  // Build the manual estimate, preserving any existing AI factors
  const existingEstimate = storyRow.estimate ? JSON.parse(storyRow.estimate) : {};

  const estimate: StoryEstimate = {
    storyId,
    size: body.size,
    storyPoints: body.storyPoints,
    confidence: existingEstimate.confidence || 'high',
    confidenceScore: existingEstimate.confidenceScore || 90,
    factors: existingEstimate.factors || [],
    reasoning: body.reasoning || existingEstimate.reasoning || 'Manual estimate.',
    suggestedBreakdown: existingEstimate.suggestedBreakdown,
    isManualOverride: true,
  };

  const now = Date.now();
  db.query('UPDATE prd_stories SET estimate = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(estimate),
    now,
    storyId,
  );
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  return c.json({ ok: true, data: { storyId, estimate } });
});

// Estimate all stories in a PRD
app.post('/:id/estimate', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as EstimatePrdRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdId) as any[];

  if (stories.length === 0) {
    return c.json({ ok: false, error: 'No stories to estimate' }, 400);
  }

  const mappedStories = stories.map(storyFromRow);

  // Filter: skip stories that already have estimates unless reEstimate is true
  const storiesToEstimate = body.reEstimate
    ? mappedStories
    : mappedStories.filter((s) => !s.estimate || s.estimate.isManualOverride === false);

  if (storiesToEstimate.length === 0) {
    // All stories already estimated — return current data
    const allEstimates = mappedStories.filter((s) => s.estimate).map((s) => s.estimate!);
    return c.json({
      ok: true,
      data: buildEstimateSummary(prdId, allEstimates),
    });
  }

  // Build context for batch estimation
  let storiesContext = '';
  for (const s of mappedStories) {
    const criteria = s.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');
    const existingEstimate =
      s.estimate && !storiesToEstimate.find((st) => st.id === s.id)
        ? ` [Already estimated: ${s.estimate.size}, ${s.estimate.storyPoints}pts]`
        : '';
    storiesContext += `\n### Story "${s.title}" (ID: ${s.id}) [${s.priority}]${existingEstimate}
${s.description}
Dependencies: ${s.dependsOn?.length || 0}
Acceptance Criteria:
${criteria || '(None)'}\n`;
  }

  // Build project memory context
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 30`,
      )
      .all(prdRow.workspace_path) as any[];
    if (memRows.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const m of memRows) {
        if (!grouped[m.category]) grouped[m.category] = [];
        grouped[m.category].push(`- ${m.key}: ${m.content}`);
      }
      const labels: Record<string, string> = {
        convention: 'Coding Conventions',
        decision: 'Architecture Decisions',
        preference: 'User Preferences',
        pattern: 'Common Patterns',
        context: 'Project Context',
      };
      memoryContext = '\n\n## Project Memory\n';
      for (const [cat, items] of Object.entries(grouped)) {
        memoryContext += `\n### ${labels[cat] || cat}\n${items.join('\n')}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  const storyIdsToEstimate = storiesToEstimate.map((s) => s.id);

  const systemPrompt = `You are an expert software project estimator. Estimate ALL stories listed below for relative sizing and complexity.

ESTIMATION FRAMEWORK:
- **small** (1-2 points): Simple, well-understood. Single file, minor changes, clear patterns.
- **medium** (3-5 points): Moderate complexity. Multiple files, new components, API endpoints with logic.
- **large** (8-13 points): Complex. Cross-cutting concerns, new architecture, many integration points, unknowns.

CONFIDENCE LEVELS:
- **high** (80-100): Well-defined, specific criteria, clear scope.
- **medium** (50-79): Mostly clear but some ambiguity.
- **low** (0-49): Vague, unclear criteria, significant unknowns.

IMPORTANT: Estimate stories RELATIVE to each other — the smallest should be "small" and the most complex "large". Not all stories need to be the same size.

Only estimate stories with these IDs: ${storyIdsToEstimate.join(', ')}

You MUST respond with ONLY a valid JSON array. No markdown, no explanation, no code fences.

Each element must have:
{
  "storyId": "<story ID>",
  "size": "small" | "medium" | "large",
  "storyPoints": <1 | 2 | 3 | 5 | 8 | 13>,
  "confidence": "low" | "medium" | "high",
  "confidenceScore": <0-100>,
  "factors": [
    { "factor": "<description>", "impact": "increases" | "decreases" | "neutral", "weight": "minor" | "moderate" | "major" }
  ],
  "reasoning": "<2-3 sentence explanation>",
  "suggestedBreakdown": ["<sub-task>"] // only for 8+ point stories
}${memoryContext}`;

  const userPrompt = `Estimate the complexity of each story in this PRD:

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}
${storiesContext}

Provide relative complexity estimates for all stories that need estimation.`;

  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      return c.json(
        { ok: false, error: `AI estimation failed (${apiResponse.status}): ${errBody}` },
        502,
      );
    }

    const result = (await apiResponse.json()) as any;
    const textContent = result.content?.find((ct: any) => ct.type === 'text');
    if (!textContent?.text) {
      return c.json({ ok: false, error: 'AI returned no text content' }, 502);
    }

    let rawText = textContent.text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsedEstimates: any[];
    try {
      parsedEstimates = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI estimation response as JSON. Try again.' },
        502,
      );
    }

    if (!Array.isArray(parsedEstimates)) {
      return c.json({ ok: false, error: 'AI returned invalid estimation format' }, 502);
    }

    const validSizes: StorySize[] = ['small', 'medium', 'large'];
    const validPoints = [1, 2, 3, 5, 8, 13];
    const validConfidences: EstimateConfidence[] = ['low', 'medium', 'high'];
    const storyIdSet = new Set(storyIdsToEstimate);

    const estimates: StoryEstimate[] = [];
    const now = Date.now();

    for (const pe of parsedEstimates) {
      if (!pe.storyId || !storyIdSet.has(pe.storyId)) continue;

      const size: StorySize = validSizes.includes(pe.size) ? pe.size : 'medium';
      const storyPoints = validPoints.includes(pe.storyPoints)
        ? pe.storyPoints
        : size === 'small'
          ? 2
          : size === 'medium'
            ? 5
            : 8;
      const confidence: EstimateConfidence = validConfidences.includes(pe.confidence)
        ? pe.confidence
        : 'medium';
      const confidenceScore =
        typeof pe.confidenceScore === 'number'
          ? Math.max(0, Math.min(100, Math.round(pe.confidenceScore)))
          : confidence === 'high'
            ? 85
            : confidence === 'medium'
              ? 60
              : 30;

      const factors: EstimationFactor[] = (pe.factors || [])
        .filter((f: any) => f.factor && typeof f.factor === 'string')
        .slice(0, 6)
        .map((f: any) => ({
          factor: f.factor.trim(),
          impact: ['increases', 'decreases', 'neutral'].includes(f.impact) ? f.impact : 'neutral',
          weight: ['minor', 'moderate', 'major'].includes(f.weight) ? f.weight : 'moderate',
        }));

      const estimate: StoryEstimate = {
        storyId: pe.storyId,
        size,
        storyPoints,
        confidence,
        confidenceScore,
        factors,
        reasoning: (pe.reasoning || 'Estimated based on story content.').trim(),
        suggestedBreakdown:
          storyPoints >= 8 && Array.isArray(pe.suggestedBreakdown)
            ? pe.suggestedBreakdown
                .filter((s: any) => typeof s === 'string' && s.trim())
                .map((s: string) => s.trim())
            : undefined,
        isManualOverride: false,
      };

      estimates.push(estimate);

      // Persist to database
      db.query('UPDATE prd_stories SET estimate = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(estimate),
        now,
        pe.storyId,
      );
    }

    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

    // Combine with existing estimates that weren't re-estimated
    const allEstimates = [
      ...estimates,
      ...mappedStories.filter((s) => s.estimate && !storyIdSet.has(s.id)).map((s) => s.estimate!),
    ];

    return c.json({
      ok: true,
      data: buildEstimateSummary(prdId, allEstimates),
    });
  } catch (err) {
    return c.json({ ok: false, error: `Bulk estimation failed: ${(err as Error).message}` }, 500);
  }
});

// --- PRD Completeness Analysis ---

// Analyze PRD content for completeness, missing sections, and gaps
app.post('/:id/completeness', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as AnalyzePrdCompletenessRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  const mappedStories = stories.map(storyFromRow);

  // Build a comprehensive view of the PRD for AI analysis
  let storiesContext = '';
  if (mappedStories.length > 0) {
    storiesContext = '\n## Existing Stories\n';
    for (const s of mappedStories) {
      const criteria = s.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');
      storiesContext += `\n### ${s.title}\n`;
      if (s.description) storiesContext += `Description: ${s.description}\n`;
      if (criteria) storiesContext += `Acceptance Criteria:\n${criteria}\n`;
      storiesContext += `Priority: ${s.priority}\n`;
      if (s.estimate)
        storiesContext += `Estimate: ${s.estimate.size} (${s.estimate.storyPoints}pts)\n`;
    }
  }

  // Get project memory for additional context
  let memoryContext = '';
  try {
    const memories = db
      .query(
        'SELECT category, key, content FROM workspace_memories WHERE workspace_path = ? ORDER BY category, key',
      )
      .all(prdRow.workspace_path) as any[];
    if (memories.length > 0) {
      memoryContext = '\n\n## Project Memory\n';
      for (const m of memories.slice(0, 10)) {
        memoryContext += `- [${m.category}] ${m.key}: ${m.content}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  const standardSections: Array<{
    name: PRDSectionName;
    label: string;
    severity: PRDSectionSeverity;
  }> = [
    { name: 'goals', label: 'Goals & Objectives', severity: 'critical' },
    { name: 'scope', label: 'Scope & Boundaries', severity: 'critical' },
    { name: 'success_metrics', label: 'Success Metrics & KPIs', severity: 'critical' },
    { name: 'constraints', label: 'Constraints & Limitations', severity: 'warning' },
    { name: 'user_personas', label: 'User Personas & Target Audience', severity: 'warning' },
    { name: 'requirements', label: 'Functional Requirements', severity: 'critical' },
    { name: 'assumptions', label: 'Assumptions', severity: 'info' },
    { name: 'risks', label: 'Risks & Mitigations', severity: 'warning' },
    { name: 'timeline', label: 'Timeline & Milestones', severity: 'info' },
    { name: 'dependencies', label: 'External Dependencies', severity: 'info' },
  ];

  // Filter to only requested sections if specified
  const sectionsToAnalyze = body.sections
    ? standardSections.filter((s) => body.sections!.includes(s.name))
    : standardSections;

  const sectionsListStr = sectionsToAnalyze
    .map((s) => `- "${s.name}" (label: "${s.label}", default_severity: "${s.severity}")`)
    .join('\n');

  const systemPrompt = `You are a PRD (Product Requirements Document) analysis expert. Your job is to evaluate the completeness and quality of a PRD by checking for standard sections, identifying gaps, and suggesting improvements.

## PRD to Analyze

### Title: ${prdRow.name}
### Description:
${prdRow.description || '(No description provided)'}
${storiesContext}
${memoryContext}

## Standard PRD Sections to Check
${sectionsListStr}

## Your Task
Analyze the PRD content above and evaluate each section. For each section:
1. Determine if it is present (even if not explicitly labeled, content may cover the section)
2. Score its quality from 0-100 (0 = completely missing, 100 = thorough and well-defined)
3. Provide specific feedback about what's missing or could be improved
4. Suggest 1-3 specific questions that would help fill any gaps

Also provide:
- An overall completeness score (0-100) weighted by section severity
- A brief summary assessment
- Top 3-5 critical questions that would most improve the PRD

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "overallScore": 75,
  "overallLabel": "Good",
  "summary": "Brief assessment of the PRD's overall completeness",
  "sections": [
    {
      "section": "goals",
      "label": "Goals & Objectives",
      "present": true,
      "severity": "critical",
      "score": 80,
      "feedback": "What's good and what's missing",
      "questions": ["Specific question to improve this section"]
    }
  ],
  "suggestedQuestions": ["Top priority question 1", "Top priority question 2"]
}

IMPORTANT:
- Be thorough but fair — content may implicitly address a section without a formal heading
- The overallLabel should be: "Excellent" (90+), "Good" (70-89), "Fair" (50-69), "Needs Work" (30-49), or "Incomplete" (<30)
- Weight critical sections more heavily in the overall score
- Questions should be specific and actionable, not generic
- Every section from the list MUST appear in the output
- Score 0 only if a section is completely absent with no related content`;

  const userPrompt = `Analyze this PRD for completeness. Check all ${sectionsToAnalyze.length} standard sections and identify any gaps, weak areas, or missing details that could cause problems during implementation.`;

  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      return c.json(
        { ok: false, error: `AI completeness analysis failed (${apiResponse.status}): ${errBody}` },
        502,
      );
    }

    const result = (await apiResponse.json()) as any;
    const textContent = result.content?.find((ct: any) => ct.type === 'text');
    if (!textContent?.text) {
      return c.json({ ok: false, error: 'AI returned no text content' }, 502);
    }

    // Parse JSON response
    let rawText = textContent.text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI completeness analysis as JSON. Try again.' },
        502,
      );
    }

    // Validate and build the response
    const overallScore =
      typeof parsed.overallScore === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.overallScore)))
        : 0;

    const overallLabel =
      typeof parsed.overallLabel === 'string'
        ? parsed.overallLabel
        : overallScore >= 90
          ? 'Excellent'
          : overallScore >= 70
            ? 'Good'
            : overallScore >= 50
              ? 'Fair'
              : overallScore >= 30
                ? 'Needs Work'
                : 'Incomplete';

    const sections: PRDSectionAnalysis[] = [];
    const parsedSections = Array.isArray(parsed.sections) ? parsed.sections : [];

    // Ensure all requested sections are represented
    for (const standardSection of sectionsToAnalyze) {
      const found = parsedSections.find((ps: any) => ps.section === standardSection.name);
      if (found) {
        sections.push({
          section: standardSection.name,
          label: standardSection.label,
          present: !!found.present,
          severity: standardSection.severity,
          score:
            typeof found.score === 'number'
              ? Math.max(0, Math.min(100, Math.round(found.score)))
              : 0,
          feedback: typeof found.feedback === 'string' ? found.feedback : 'No analysis available',
          questions: Array.isArray(found.questions)
            ? found.questions.filter((q: any) => typeof q === 'string')
            : [],
        });
      } else {
        // Section was not analyzed by AI — mark as missing
        sections.push({
          section: standardSection.name,
          label: standardSection.label,
          present: false,
          severity: standardSection.severity,
          score: 0,
          feedback: 'This section was not found in the PRD.',
          questions: [`What are the ${standardSection.label.toLowerCase()} for this project?`],
        });
      }
    }

    const suggestedQuestions = Array.isArray(parsed.suggestedQuestions)
      ? parsed.suggestedQuestions.filter((q: any) => typeof q === 'string')
      : sections
          .filter((s) => !s.present || s.score < 50)
          .flatMap((s) => s.questions)
          .slice(0, 5);

    const analysis: PRDCompletenessAnalysis = {
      prdId,
      overallScore,
      overallLabel,
      sections,
      summary:
        typeof parsed.summary === 'string' ? parsed.summary : `PRD completeness: ${overallScore}%`,
      suggestedQuestions,
      analyzedAt: Date.now(),
    };

    const response: AnalyzePrdCompletenessResponse = {
      prdId,
      analysis,
    };

    return c.json({ ok: true, data: response });
  } catch (err) {
    return c.json(
      { ok: false, error: `PRD completeness analysis failed: ${(err as Error).message}` },
      500,
    );
  }
});

// --- Sprint Plan Recommendations ---

// Generate AI-recommended sprint assignments for all stories in a PRD
app.post('/:id/sprint-plan', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as SprintPlanRequest;

  // Validate capacity
  const capacity = body.capacity;
  const capacityMode = body.capacityMode || 'points';
  if (!capacity || typeof capacity !== 'number' || capacity <= 0) {
    return c.json({ ok: false, error: 'capacity must be a positive number' }, 400);
  }

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];

  if (stories.length === 0) {
    return c.json({ ok: false, error: 'No stories in this PRD' }, 400);
  }

  const mappedStories = stories.map(storyFromRow);

  // Separate stories into plannable vs. unassignable
  const completedOrSkipped = mappedStories.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  );
  const pendingStories = mappedStories.filter(
    (s) => s.status !== 'completed' && s.status !== 'skipped',
  );
  const unestimated = pendingStories.filter((s) => !s.estimate);
  const estimatedPending = pendingStories.filter((s) => s.estimate);

  // Build the unassigned list for stories we can't plan
  const unassignedStories: SprintPlanResponse['unassignedStories'] = [];

  for (const s of completedOrSkipped) {
    unassignedStories.push({
      storyId: s.id,
      title: s.title,
      reason: `Already ${s.status}`,
    });
  }
  for (const s of unestimated) {
    unassignedStories.push({
      storyId: s.id,
      title: s.title,
      reason: 'No estimate — estimate the story first',
    });
  }

  if (estimatedPending.length === 0) {
    return c.json({
      ok: true,
      data: {
        prdId,
        sprints: [],
        totalPoints: 0,
        totalSprints: 0,
        unassignedStories,
        summary: 'No pending estimated stories to plan.',
      } satisfies SprintPlanResponse,
    });
  }

  // Build context for AI
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  // Build a list of stories for the AI to plan
  let storiesContext = '';
  for (const s of estimatedPending) {
    const deps = s.dependsOn || [];
    const depTitles = deps
      .map((depId: string) => {
        const dep = mappedStories.find((ms) => ms.id === depId);
        return dep ? `"${dep.title}" (${dep.status})` : depId;
      })
      .join(', ');
    const criteria = s.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');

    storiesContext += `
### Story: ${s.title}
- ID: ${s.id}
- Priority: ${s.priority}
- Story Points: ${s.estimate!.storyPoints}
- Size: ${s.estimate!.size}
- Status: ${s.status}
- Dependencies: ${deps.length > 0 ? depTitles : 'None'}
${s.description ? `- Description: ${s.description}` : ''}
${criteria ? `- Acceptance Criteria:\n${criteria}` : ''}
`;
  }

  // Get project memory for context
  let memoryContext = '';
  try {
    const memories = db
      .query(
        'SELECT category, key, content FROM workspace_memories WHERE workspace_path = ? ORDER BY category, key',
      )
      .all(prdRow.workspace_path) as any[];
    if (memories.length > 0) {
      memoryContext = '\n\n## Project Context\n';
      for (const m of memories.slice(0, 10)) {
        memoryContext += `- [${m.category}] ${m.key}: ${m.content}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  const systemPrompt = `You are a sprint planning expert helping to assign user stories to sprints optimally.

## Rules
1. Sprint capacity: ${capacity} ${capacityMode === 'count' ? 'stories' : 'story points'} per sprint
2. Respect dependency ordering: If story A depends on story B, B must be in an earlier sprint (or the same sprint if B is already completed)
3. Schedule high-priority and critical stories in earlier sprints when possible
4. Balance sprint workload — try to fill sprints close to capacity but never exceed it
5. Group related stories together when it makes sense (e.g., stories that share the same feature area)
6. Consider story dependencies completed in earlier sprints as resolved

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}

## Stories to Plan
${storiesContext}
${memoryContext}

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "sprints": [
    {
      "sprintNumber": 1,
      "storyIds": ["id1", "id2"],
      "storyReasons": {
        "id1": "Why this specific story is placed in this sprint",
        "id2": "Why this specific story is placed in this sprint"
      },
      "rationale": "Why these stories were grouped in this sprint"
    }
  ],
  "summary": "Overall explanation of the sprint plan strategy"
}

IMPORTANT:
- Every story ID from the input MUST appear in exactly one sprint
- Never exceed sprint capacity (${capacity} ${capacityMode === 'count' ? 'stories' : 'points'})
- A story's dependencies must be in earlier sprints or already completed
- Prioritize critical/high priority stories in earlier sprints
- Provide clear rationale for each sprint grouping
- Provide a specific reason for EACH story explaining why it was placed in that particular sprint
- sprintNumber starts at 1 and increments sequentially`;

  const userPrompt = `Plan sprints for these ${estimatedPending.length} stories with a capacity of ${capacity} ${capacityMode === 'count' ? 'stories' : 'story points'} per sprint. Respect dependencies and prioritize critical/high-priority items first.`;

  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      return c.json(
        { ok: false, error: `AI sprint planning failed (${apiResponse.status}): ${errBody}` },
        502,
      );
    }

    const result = (await apiResponse.json()) as any;
    const textContent = result.content?.find((ct: any) => ct.type === 'text');
    if (!textContent?.text) {
      return c.json({ ok: false, error: 'AI returned no text content' }, 502);
    }

    // Parse JSON response
    let rawText = textContent.text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI sprint plan response as JSON. Try again.' },
        502,
      );
    }

    // Build the story lookup for validation
    const storyMap = new Map(estimatedPending.map((s) => [s.id, s]));

    // Validate and build sprint recommendations
    const sprints: SprintRecommendation[] = [];
    const assignedIds = new Set<string>();
    let overallTotalPoints = 0;

    if (!Array.isArray(parsed.sprints)) {
      return c.json({ ok: false, error: 'AI response missing sprints array. Try again.' }, 502);
    }

    for (const ps of parsed.sprints) {
      const sprintNum = typeof ps.sprintNumber === 'number' ? ps.sprintNumber : sprints.length + 1;
      const storyIds: string[] = Array.isArray(ps.storyIds) ? ps.storyIds : [];
      const storyReasons: Record<string, string> = ps.storyReasons || {};

      const sprintStories: SprintStoryAssignment[] = [];
      let sprintPoints = 0;

      for (const sid of storyIds) {
        const story = storyMap.get(sid);
        if (!story || assignedIds.has(sid)) continue;

        assignedIds.add(sid);
        const pts = story.estimate?.storyPoints ?? 0;
        sprintPoints += pts;
        overallTotalPoints += pts;

        // Use AI-provided per-story reason if available, otherwise generate a descriptive fallback
        const aiReason = storyReasons[sid];
        const fallbackReason = `${story.priority} priority, ${pts}pts${story.dependsOn?.length ? `, depends on ${story.dependsOn.length} story(ies)` : ''}`;

        sprintStories.push({
          storyId: sid,
          title: story.title,
          storyPoints: pts,
          priority: story.priority,
          reason: aiReason || fallbackReason,
        });
      }

      if (sprintStories.length > 0) {
        sprints.push({
          sprintNumber: sprintNum,
          stories: sprintStories,
          totalPoints: sprintPoints,
          rationale: (ps.rationale || `Sprint ${sprintNum} stories`).trim(),
        });
      }
    }

    // Add any stories the AI missed to additional sprints
    for (const s of estimatedPending) {
      if (!assignedIds.has(s.id)) {
        const pts = s.estimate?.storyPoints ?? 0;

        // Find a sprint with room, or create a new one
        let placed = false;
        for (const sprint of sprints) {
          const sprintCap = capacityMode === 'count' ? sprint.stories.length : sprint.totalPoints;
          const storyWeight = capacityMode === 'count' ? 1 : pts;
          if (sprintCap + storyWeight <= capacity) {
            sprint.stories.push({
              storyId: s.id,
              title: s.title,
              storyPoints: pts,
              priority: s.priority,
              reason: 'Added to fill remaining capacity',
            });
            sprint.totalPoints += pts;
            overallTotalPoints += pts;
            placed = true;
            break;
          }
        }

        if (!placed) {
          // Create a new sprint
          overallTotalPoints += pts;
          sprints.push({
            sprintNumber: sprints.length + 1,
            stories: [
              {
                storyId: s.id,
                title: s.title,
                storyPoints: pts,
                priority: s.priority,
                reason: 'Added to overflow sprint',
              },
            ],
            totalPoints: pts,
            rationale: 'Overflow sprint for remaining stories',
          });
        }
      }
    }

    // Renumber sprints sequentially
    sprints.forEach((s, i) => {
      s.sprintNumber = i + 1;
    });

    const response: SprintPlanResponse = {
      prdId,
      sprints,
      totalPoints: overallTotalPoints,
      totalSprints: sprints.length,
      unassignedStories,
      summary: (
        parsed.summary ||
        `Planned ${estimatedPending.length} stories across ${sprints.length} sprints.`
      ).trim(),
    };

    return c.json({ ok: true, data: response });
  } catch (err) {
    return c.json({ ok: false, error: `Sprint planning failed: ${(err as Error).message}` }, 500);
  }
});

// Save a manually adjusted sprint plan (user can move stories between sprints)
app.put('/:id/sprint-plan', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = await c.req.json();

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId);
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  // Validate the body has the right shape
  if (!body.sprints || !Array.isArray(body.sprints)) {
    return c.json({ ok: false, error: 'sprints array required' }, 400);
  }

  const stories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(prdId) as any[];
  const mappedStories = stories.map(storyFromRow);
  const storyMap = new Map(mappedStories.map((s) => [s.id, s]));

  // Rebuild the sprint plan from the adjusted input
  const sprints: SprintRecommendation[] = [];
  let totalPoints = 0;

  for (const ps of body.sprints) {
    const sprintStories: SprintStoryAssignment[] = [];
    let sprintPoints = 0;

    for (const sa of ps.stories || []) {
      const story = storyMap.get(sa.storyId);
      if (!story) continue;

      const pts = story.estimate?.storyPoints ?? sa.storyPoints ?? 0;
      sprintPoints += pts;
      totalPoints += pts;

      sprintStories.push({
        storyId: sa.storyId,
        title: story.title,
        storyPoints: pts,
        priority: story.priority,
        reason: sa.reason || 'Manually assigned',
      });
    }

    if (sprintStories.length > 0) {
      sprints.push({
        sprintNumber: sprints.length + 1,
        stories: sprintStories,
        totalPoints: sprintPoints,
        rationale: ps.rationale || `Sprint ${sprints.length + 1} (manually adjusted)`,
      });
    }
  }

  const response: SprintPlanResponse = {
    prdId,
    sprints,
    totalPoints,
    totalSprints: sprints.length,
    unassignedStories: body.unassignedStories || [],
    summary: body.summary || `Manually adjusted plan with ${sprints.length} sprints.`,
  };

  return c.json({ ok: true, data: response });
});

function buildEstimateSummary(prdId: string, estimates: StoryEstimate[]): EstimatePrdResponse {
  const totalPoints = estimates.reduce((sum, e) => sum + e.storyPoints, 0);
  const averagePoints = estimates.length > 0 ? totalPoints / estimates.length : 0;
  const smallCount = estimates.filter((e) => e.size === 'small').length;
  const mediumCount = estimates.filter((e) => e.size === 'medium').length;
  const largeCount = estimates.filter((e) => e.size === 'large').length;
  const averageConfidence =
    estimates.length > 0
      ? estimates.reduce((sum, e) => sum + e.confidenceScore, 0) / estimates.length
      : 0;

  return {
    prdId,
    estimates,
    summary: {
      totalPoints,
      averagePoints: Math.round(averagePoints * 10) / 10,
      smallCount,
      mediumCount,
      largeCount,
      averageConfidence: Math.round(averageConfidence),
    },
  };
}

// =============================================
// Story Template Library
// =============================================

/** Built-in templates seeded on first load */
const BUILT_IN_TEMPLATES: Array<Omit<StoryTemplate, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'Feature',
    description: 'A new user-facing feature or capability',
    category: 'feature',
    titleTemplate: 'As a {{user_role}}, I want to {{action}} so that {{benefit}}',
    descriptionTemplate:
      'Implement a new feature that allows {{user_role}} to {{action}}.\n\n' +
      '## Context\nDescribe why this feature is needed and how it fits into the larger product.\n\n' +
      '## Scope\n- What is included in this feature\n- What is explicitly out of scope\n\n' +
      '## Technical Notes\nAny implementation guidance, API changes, or architectural considerations.',
    acceptanceCriteriaTemplates: [
      'User can {{primary_action}} from the {{location}} page',
      'System validates {{input}} before processing',
      'Success/error feedback is displayed to the user',
      'Feature is accessible via keyboard navigation',
      'Unit tests cover the core logic with >80% coverage',
    ],
    priority: 'medium',
    tags: ['feature', 'user-facing'],
    isBuiltIn: true,
  },
  {
    name: 'Bug Fix',
    description: 'Fix a defect or unexpected behavior in existing functionality',
    category: 'bug',
    titleTemplate: 'Fix: {{brief_description_of_bug}}',
    descriptionTemplate:
      '## Bug Description\nDescribe the incorrect behavior that users are experiencing.\n\n' +
      '## Steps to Reproduce\n1. Go to {{location}}\n2. Perform {{action}}\n3. Observe {{incorrect_result}}\n\n' +
      '## Expected Behavior\nDescribe what should happen instead.\n\n' +
      '## Actual Behavior\nDescribe what currently happens.\n\n' +
      '## Environment\n- Browser/OS: \n- Version: \n- User role: ',
    acceptanceCriteriaTemplates: [
      'The reported bug no longer occurs when following the reproduction steps',
      'Existing related functionality is not broken (regression check)',
      'A regression test is added to prevent this bug from recurring',
      'The fix works across supported browsers/environments',
    ],
    priority: 'high',
    tags: ['bug', 'fix', 'defect'],
    isBuiltIn: true,
  },
  {
    name: 'Technical Debt',
    description: 'Refactoring, cleanup, or infrastructure improvement',
    category: 'tech_debt',
    titleTemplate: 'Tech Debt: {{area}} - {{improvement}}',
    descriptionTemplate:
      '## Current State\nDescribe the current technical issue or suboptimal implementation.\n\n' +
      '## Problem\nExplain why this technical debt is problematic (performance, maintainability, scalability, etc.).\n\n' +
      '## Proposed Solution\nDescribe the refactoring or improvement to be made.\n\n' +
      '## Impact\n- Code quality: \n- Performance: \n- Developer experience: \n\n' +
      '## Migration Plan\nIf applicable, describe how to migrate existing data or code.',
    acceptanceCriteriaTemplates: [
      'Code is refactored according to the proposed solution',
      'All existing tests continue to pass',
      'No user-facing behavior changes (unless explicitly intended)',
      'Code review confirms improved readability/maintainability',
      'Performance benchmarks show no regression (or improvement if applicable)',
    ],
    priority: 'low',
    tags: ['tech-debt', 'refactor', 'infrastructure'],
    isBuiltIn: true,
  },
  {
    name: 'Research Spike',
    description: 'Time-boxed investigation to reduce uncertainty or evaluate options',
    category: 'spike',
    titleTemplate: 'Spike: Investigate {{topic_or_question}}',
    descriptionTemplate:
      '## Research Question\nWhat specific question(s) need to be answered?\n\n' +
      '## Background\nWhat context led to this research need? What do we already know?\n\n' +
      '## Options to Evaluate\n1. {{option_1}}\n2. {{option_2}}\n3. {{option_3}}\n\n' +
      '## Time Box\nThis spike is limited to {{duration}} of effort.\n\n' +
      '## Success Criteria\nWhat deliverables are expected from this research?',
    acceptanceCriteriaTemplates: [
      'A written summary document with findings is produced',
      'At least {{number}} options are evaluated with pros/cons',
      'A recommendation is made with clear rationale',
      'Identified risks and unknowns are documented',
      'Follow-up stories are created based on findings',
    ],
    priority: 'medium',
    tags: ['spike', 'research', 'investigation'],
    isBuiltIn: true,
  },
];

/** Seed built-in templates if they don't exist */
function seedBuiltInTemplates(): void {
  const db = getDb();
  const existing = db
    .query('SELECT COUNT(*) as count FROM story_templates WHERE is_built_in = 1')
    .get() as any;
  if (existing.count > 0) return;

  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO story_templates (id, name, description, category, title_template, description_template,
     acceptance_criteria_templates, priority, tags, is_built_in, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  );

  for (const tmpl of BUILT_IN_TEMPLATES) {
    stmt.run(
      nanoid(12),
      tmpl.name,
      tmpl.description,
      tmpl.category,
      tmpl.titleTemplate,
      tmpl.descriptionTemplate,
      JSON.stringify(tmpl.acceptanceCriteriaTemplates),
      tmpl.priority,
      JSON.stringify(tmpl.tags),
      now,
      now,
    );
  }
}

// --- Create story from template ---
app.post('/:id/stories/from-template', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');
  const body = (await c.req.json()) as CreateStoryFromTemplateRequest;

  // Verify PRD exists
  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) {
    return c.json({ ok: false, error: 'PRD not found' }, 404);
  }

  // Get the template
  seedBuiltInTemplates();
  const tmplRow = db
    .query('SELECT * FROM story_templates WHERE id = ?')
    .get(body.templateId) as any;
  if (!tmplRow) {
    return c.json({ ok: false, error: 'Template not found' }, 404);
  }

  const template = templateFromRow(tmplRow);
  const variables = body.variables || {};

  // Apply variable substitutions to template fields
  function applyVariables(text: string, vars: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return vars[key] || match; // Keep placeholder if no substitution provided
    });
  }

  const title = applyVariables(template.titleTemplate, variables);
  const description = applyVariables(template.descriptionTemplate, variables);
  const criteria = template.acceptanceCriteriaTemplates.map((ac: string) =>
    applyVariables(ac, variables),
  );

  // Create the story
  const storyId = nanoid(12);
  const now = Date.now();
  const maxSort = db
    .query('SELECT MAX(sort_order) as mx FROM prd_stories WHERE prd_id = ?')
    .get(prdId) as any;
  const sortOrder = (maxSort?.mx ?? -1) + 1;

  const acJson = JSON.stringify(
    criteria.map((desc: string, idx: number) => ({
      id: nanoid(8),
      description: desc,
      passed: false,
    })),
  );

  db.query(
    `INSERT INTO prd_stories (id, prd_id, title, description, acceptance_criteria, priority,
     depends_on, dependency_reasons, status, attempts, max_attempts, learnings, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', '{}', 'pending', 0, 3, '[]', ?, ?, ?)`,
  ).run(storyId, prdId, title, description, acJson, template.priority, sortOrder, now, now);

  return c.json(
    {
      ok: true,
      data: {
        storyId,
        story: {
          title,
          description,
          acceptanceCriteria: criteria,
          priority: template.priority,
        },
      } as CreateStoryFromTemplateResponse,
    },
    201,
  );
});

// --- Priority Recommendation ---

// Recommend priority for a single story using AI
app.post('/:prdId/stories/:storyId/priority', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const story = storyFromRow(storyRow);

  // Build context: all stories in the PRD for dependency and scope analysis
  const allStories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdId) as any[];
  const mappedStories = allStories.map(storyFromRow);

  // Build project memory context
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM workspace_memories WHERE workspace_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 20`,
      )
      .all(prdRow.workspace_path) as any[];
    if (memRows.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const m of memRows) {
        if (!grouped[m.category]) grouped[m.category] = [];
        grouped[m.category].push(`- ${m.key}: ${m.content}`);
      }
      const labels: Record<string, string> = {
        convention: 'Coding Conventions',
        decision: 'Architecture Decisions',
        preference: 'User Preferences',
        pattern: 'Common Patterns',
        context: 'Project Context',
      };
      memoryContext = '\n\n## Project Memory\n';
      for (const [cat, items] of Object.entries(grouped)) {
        memoryContext += `\n### ${labels[cat] || cat}\n${items.join('\n')}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  // Build dependency context
  let dependencyContext = '';
  const blocksStories = mappedStories.filter((s) => s.dependsOn?.includes(storyId));
  const blockedByStories = (story.dependsOn || [])
    .map((depId: string) => mappedStories.find((s) => s.id === depId))
    .filter(Boolean);

  if (blocksStories.length > 0 || blockedByStories.length > 0) {
    dependencyContext = '\n\n## Dependency Information\n';
    if (blocksStories.length > 0) {
      dependencyContext += `This story BLOCKS ${blocksStories.length} other story(ies):\n`;
      for (const s of blocksStories) {
        dependencyContext += `- "${s.title}" (${s.status})\n`;
      }
    }
    if (blockedByStories.length > 0) {
      dependencyContext += `This story is BLOCKED BY ${blockedByStories.length} other story(ies):\n`;
      for (const s of blockedByStories) {
        dependencyContext += `- "${s.title}" (${s.status})\n`;
      }
    }
  }

  // Build sibling stories context
  let siblingContext = '\n\n## Other Stories in this PRD\n';
  const otherStories = mappedStories.filter((s) => s.id !== storyId);
  for (const s of otherStories) {
    const acCount = s.acceptanceCriteria?.length || 0;
    const depsCount = s.dependsOn?.length || 0;
    const blocksCount = mappedStories.filter((ms) => ms.dependsOn?.includes(s.id)).length;
    siblingContext += `- ${s.title} (priority: ${s.priority}, status: ${s.status}, ${acCount} criteria, blocks: ${blocksCount}, blocked by: ${depsCount})\n`;
  }

  const criteriaText = story.acceptanceCriteria.map((ac: any) => `- ${ac.description}`).join('\n');

  const systemPrompt = `You are an expert product manager specializing in story prioritization. Your task is to recommend a priority level for a user story based on business value, risk factors, dependencies, and user impact.

PRIORITY LEVELS:
- **critical**: Must be done immediately. Blocks critical functionality, security vulnerabilities, data loss risks, or is a prerequisite for many other stories.
- **high**: Important and should be scheduled soon. Significant user impact, blocks other stories, addresses key business requirements, or has substantial risk.
- **medium**: Standard priority. Normal feature work, moderate user impact, few dependencies.
- **low**: Nice to have. Minor improvements, cosmetic changes, tech debt that doesn't block other work, low user impact.

FACTORS TO EVALUATE:

1. **Blocking Dependencies** (category: dependency)
   - How many stories does this story block? (more blocks = higher priority)
   - Is this story on the critical path?
   - Are there circular dependency risks?

2. **Risk Keywords** (category: risk)
   - Look for risk indicators: "security", "performance", "data loss", "migration", "breaking change", "deadline", "compliance", "authentication", "authorization"
   - Infrastructure/foundation stories that other work depends on
   - Stories with unclear requirements or high uncertainty

3. **Scope** (category: scope)
   - Number of acceptance criteria (more criteria may indicate larger scope)
   - Complexity of the story description
   - Whether the story involves cross-cutting concerns
   - Estimated effort (if available)

4. **User Impact** (category: user_impact)
   - Does this affect core user workflows?
   - How many users would be affected?
   - Is this user-facing or internal/infrastructure?
   - Does this address user pain points or feature requests?

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "suggestedPriority": "critical" | "high" | "medium" | "low",
  "confidence": <number 0-100>,
  "factors": [
    {
      "factor": "<description of the factor>",
      "category": "dependency" | "risk" | "scope" | "user_impact",
      "impact": "increases" | "decreases" | "neutral",
      "weight": "minor" | "moderate" | "major"
    }
  ],
  "explanation": "<2-3 sentence explanation of why this priority was recommended>"
}

IMPORTANT:
- Provide 3-6 factors that influenced your recommendation
- Be specific in factor descriptions (reference actual story details)
- Consider the full context: PRD description, dependencies, other stories' priorities
- A story that blocks many others should generally be higher priority
- Security and data-related stories should lean toward higher priority
- Confidence should reflect how clearly the priority can be determined from the available information${memoryContext}`;

  const userPrompt = `Recommend a priority level for this user story:

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}

## Story to Prioritize
Title: ${story.title}
Description: ${story.description}
Current Priority: ${story.priority}
Status: ${story.status}
Acceptance Criteria:
${criteriaText || '(No criteria defined)'}
${story.estimate ? `Estimate: ${story.estimate.size} (${story.estimate.storyPoints} points)` : 'No estimate yet'}
${dependencyContext}${siblingContext}

Recommend a priority level with explanation and supporting factors.`;

  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      return c.json(
        {
          ok: false,
          error: `AI priority recommendation failed (${apiResponse.status}): ${errBody}`,
        },
        502,
      );
    }

    const result = (await apiResponse.json()) as any;
    const textContent = result.content?.find((ct: any) => ct.type === 'text');
    if (!textContent?.text) {
      return c.json({ ok: false, error: 'AI returned no text content' }, 502);
    }

    // Parse JSON response
    let rawText = textContent.text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI priority response as JSON. Try again.' },
        502,
      );
    }

    // Validate and normalize
    const validPriorities: StoryPriority[] = ['critical', 'high', 'medium', 'low'];
    const validCategories = ['dependency', 'risk', 'scope', 'user_impact'];

    const suggestedPriority: StoryPriority = validPriorities.includes(parsed.suggestedPriority)
      ? parsed.suggestedPriority
      : 'medium';
    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
        : 60;

    const factors: PriorityFactor[] = (parsed.factors || [])
      .filter((f: any) => f.factor && typeof f.factor === 'string')
      .slice(0, 6)
      .map((f: any) => ({
        factor: f.factor.trim(),
        category: validCategories.includes(f.category) ? f.category : 'scope',
        impact: ['increases', 'decreases', 'neutral'].includes(f.impact) ? f.impact : 'neutral',
        weight: ['minor', 'moderate', 'major'].includes(f.weight) ? f.weight : 'moderate',
      }));

    const recommendation: PriorityRecommendation = {
      storyId,
      suggestedPriority,
      currentPriority: story.priority as StoryPriority,
      confidence,
      factors,
      explanation: (
        parsed.explanation || 'Priority recommendation based on story analysis.'
      ).trim(),
      isManualOverride: false,
    };

    // Persist recommendation to database
    const now = Date.now();
    db.query('UPDATE prd_stories SET priority_recommendation = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(recommendation),
      now,
      storyId,
    );
    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

    return c.json({
      ok: true,
      data: { storyId, recommendation } as PriorityRecommendationResponse,
    });
  } catch (err) {
    return c.json(
      { ok: false, error: `Priority recommendation failed: ${(err as Error).message}` },
      500,
    );
  }
});

// Accept/override a priority recommendation
app.put('/:prdId/stories/:storyId/priority', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = await c.req.json();

  const storyRow = db
    .query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?')
    .get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const { priority, accept } = body;
  const validPriorities: StoryPriority[] = ['critical', 'high', 'medium', 'low'];

  if (!validPriorities.includes(priority)) {
    return c.json(
      { ok: false, error: 'Invalid priority. Must be: critical, high, medium, or low' },
      400,
    );
  }

  const now = Date.now();
  const story = storyFromRow(storyRow);

  // Update the story priority
  db.query('UPDATE prd_stories SET priority = ?, updated_at = ? WHERE id = ?').run(
    priority,
    now,
    storyId,
  );

  // Update the recommendation to note the override (if one exists)
  if (story.priorityRecommendation) {
    const updatedRec: PriorityRecommendation = {
      ...story.priorityRecommendation,
      isManualOverride: !accept, // If accepting AI suggestion, it's not an override
      currentPriority: priority,
    };
    db.query('UPDATE prd_stories SET priority_recommendation = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(updatedRec),
      now,
      storyId,
    );
  }

  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

  return c.json({ ok: true });
});

// Recommend priorities for all stories in a PRD
app.post('/:id/priorities', async (c) => {
  const db = getDb();
  const prdId = c.req.param('id');

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const allStories = db
    .query('SELECT * FROM prd_stories WHERE prd_id = ? ORDER BY sort_order ASC')
    .all(prdId) as any[];

  if (allStories.length === 0) {
    return c.json({ ok: false, error: 'No stories in this PRD' }, 400);
  }

  const mappedStories = allStories.map(storyFromRow);

  // Build dependency map
  const blocksMap: Record<string, string[]> = {};
  for (const s of mappedStories) {
    for (const depId of s.dependsOn || []) {
      if (!blocksMap[depId]) blocksMap[depId] = [];
      blocksMap[depId].push(s.id);
    }
  }

  // Build context for AI
  let storiesContext = '';
  for (const s of mappedStories) {
    const acCount = s.acceptanceCriteria?.length || 0;
    const criteriaText = s.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');
    const blocksCount = blocksMap[s.id]?.length || 0;
    const blockedByCount = s.dependsOn?.length || 0;
    const blocksTitles = (blocksMap[s.id] || [])
      .map((id: string) => mappedStories.find((ms) => ms.id === id)?.title || id)
      .join(', ');

    storiesContext += `
### Story: ${s.title}
- ID: ${s.id}
- Current Priority: ${s.priority}
- Status: ${s.status}
- Description: ${s.description || '(No description)'}
- Acceptance Criteria (${acCount}):
${criteriaText || '  (None)'}
- Blocks: ${blocksCount > 0 ? `${blocksCount} stories (${blocksTitles})` : 'None'}
- Blocked By: ${blockedByCount > 0 ? `${blockedByCount} stories` : 'None'}
${s.estimate ? `- Estimate: ${s.estimate.size} (${s.estimate.storyPoints} points)` : '- No estimate yet'}
`;
  }

  // Get project memory for context
  let memoryContext = '';
  try {
    const memories = db
      .query(
        'SELECT category, key, content FROM workspace_memories WHERE workspace_path = ? ORDER BY category, key',
      )
      .all(prdRow.workspace_path) as any[];
    if (memories.length > 0) {
      memoryContext = '\n\n## Project Context\n';
      for (const m of memories.slice(0, 10)) {
        memoryContext += `- [${m.category}] ${m.key}: ${m.content}\n`;
      }
    }
  } catch {
    /* no project memory */
  }

  const systemPrompt = `You are an expert product manager specializing in story prioritization. Recommend priority levels for ALL stories in this PRD.

PRIORITY LEVELS:
- **critical**: Must be done immediately. Blocks critical functionality, security issues, data loss, prerequisite for many stories.
- **high**: Important, schedule soon. Significant user impact, blocks other stories, key business requirements.
- **medium**: Standard priority. Normal feature work, moderate impact, few dependencies.
- **low**: Nice to have. Minor improvements, cosmetic changes, non-blocking tech debt.

EVALUATION CRITERIA:
1. **Blocking Dependencies**: Stories that block many others should be higher priority
2. **Risk Keywords**: Look for "security", "performance", "data loss", "migration", "breaking change", "compliance", "auth"
3. **Scope**: Number of criteria, cross-cutting concerns, complexity
4. **User Impact**: Core workflows, user-facing vs internal, pain points

You MUST respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.

{
  "recommendations": [
    {
      "storyId": "<story ID>",
      "suggestedPriority": "critical" | "high" | "medium" | "low",
      "confidence": <number 0-100>,
      "factors": [
        {
          "factor": "<factor description>",
          "category": "dependency" | "risk" | "scope" | "user_impact",
          "impact": "increases" | "decreases" | "neutral",
          "weight": "minor" | "moderate" | "major"
        }
      ],
      "explanation": "<1-2 sentence explanation>"
    }
  ],
  "summary": "<Overall prioritization rationale>"
}

IMPORTANT:
- Include ALL story IDs from the input
- Provide 2-4 factors per story
- Be specific in factor descriptions
- Consider relative priorities: not every story should be critical or high
- Stories blocking many others should generally rank higher
- Consider the overall PRD goals when prioritizing${memoryContext}`;

  const userPrompt = `Recommend priority levels for all ${mappedStories.length} stories in this PRD:

## PRD: ${prdRow.name}
${prdRow.description || '(No description)'}

## Stories
${storiesContext}

Prioritize all stories considering dependencies, risks, scope, and user impact.`;

  try {
    const auth = getAnthropicAuth();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (auth.type === 'oauth') {
      headers['Authorization'] = `Bearer ${auth.token}`;
    } else {
      headers['x-api-key'] = auth.token;
    }

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.text().catch(() => 'Unknown error');
      return c.json(
        {
          ok: false,
          error: `AI priority recommendation failed (${apiResponse.status}): ${errBody}`,
        },
        502,
      );
    }

    const result = (await apiResponse.json()) as any;
    const textContent = result.content?.find((ct: any) => ct.type === 'text');
    if (!textContent?.text) {
      return c.json({ ok: false, error: 'AI returned no text content' }, 502);
    }

    // Parse JSON response
    let rawText = textContent.text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json(
        { ok: false, error: 'Failed to parse AI priority response as JSON. Try again.' },
        502,
      );
    }

    // Validate and build recommendations
    const validPriorities: StoryPriority[] = ['critical', 'high', 'medium', 'low'];
    const validCategories = ['dependency', 'risk', 'scope', 'user_impact'];

    const recommendations: PriorityRecommendation[] = [];
    const now = Date.now();

    for (const rec of parsed.recommendations || []) {
      const matchedStory = mappedStories.find((s) => s.id === rec.storyId);
      if (!matchedStory) continue;

      const suggestedPriority: StoryPriority = validPriorities.includes(rec.suggestedPriority)
        ? rec.suggestedPriority
        : 'medium';
      const confidence =
        typeof rec.confidence === 'number'
          ? Math.max(0, Math.min(100, Math.round(rec.confidence)))
          : 60;

      const factors: PriorityFactor[] = (rec.factors || [])
        .filter((f: any) => f.factor && typeof f.factor === 'string')
        .slice(0, 6)
        .map((f: any) => ({
          factor: f.factor.trim(),
          category: validCategories.includes(f.category) ? f.category : 'scope',
          impact: ['increases', 'decreases', 'neutral'].includes(f.impact) ? f.impact : 'neutral',
          weight: ['minor', 'moderate', 'major'].includes(f.weight) ? f.weight : 'moderate',
        }));

      const recommendation: PriorityRecommendation = {
        storyId: matchedStory.id,
        suggestedPriority,
        currentPriority: matchedStory.priority as StoryPriority,
        confidence,
        factors,
        explanation: (rec.explanation || 'Priority based on story analysis.').trim(),
        isManualOverride: false,
      };

      recommendations.push(recommendation);

      // Persist to database
      db.query(
        'UPDATE prd_stories SET priority_recommendation = ?, updated_at = ? WHERE id = ?',
      ).run(JSON.stringify(recommendation), now, matchedStory.id);
    }

    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);

    // Build summary
    const summary: PriorityRecommendationBulkResponse['summary'] = {
      criticalCount: recommendations.filter((r) => r.suggestedPriority === 'critical').length,
      highCount: recommendations.filter((r) => r.suggestedPriority === 'high').length,
      mediumCount: recommendations.filter((r) => r.suggestedPriority === 'medium').length,
      lowCount: recommendations.filter((r) => r.suggestedPriority === 'low').length,
      changedCount: recommendations.filter((r) => r.suggestedPriority !== r.currentPriority).length,
    };

    return c.json({
      ok: true,
      data: {
        prdId,
        recommendations,
        summary,
      } as PriorityRecommendationBulkResponse,
    });
  } catch (err) {
    return c.json(
      { ok: false, error: `Bulk priority recommendation failed: ${(err as Error).message}` },
      500,
    );
  }
});

// --- Row mappers ---

function prdFromRow(row: any) {
  return {
    id: row.id,
    workspacePath: row.workspace_path,
    name: row.name,
    description: row.description,
    branchName: row.branch_name,
    qualityChecks: JSON.parse(row.quality_checks || '[]'),
    externalRef: row.external_ref ? JSON.parse(row.external_ref) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storyFromRow(row: any) {
  return {
    id: row.id,
    prdId: row.prd_id || null,
    workspacePath: row.workspace_path || undefined,
    title: row.title,
    description: row.description,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria || '[]'),
    priority: row.priority,
    dependsOn: JSON.parse(row.depends_on || '[]'),
    dependencyReasons: JSON.parse(row.dependency_reasons || '{}'),
    status: row.status,
    taskId: row.task_id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    commitSha: row.commit_sha,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    learnings: JSON.parse(row.learnings || '[]'),
    estimate: row.estimate ? JSON.parse(row.estimate) : undefined,
    priorityRecommendation: row.priority_recommendation
      ? JSON.parse(row.priority_recommendation)
      : undefined,
    externalRef: row.external_ref ? JSON.parse(row.external_ref) : undefined,
    externalStatus: row.external_status || undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function templateFromRow(row: any): StoryTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    titleTemplate: row.title_template,
    descriptionTemplate: row.description_template,
    acceptanceCriteriaTemplates: JSON.parse(row.acceptance_criteria_templates || '[]'),
    priority: row.priority,
    tags: JSON.parse(row.tags || '[]'),
    isBuiltIn: !!row.is_built_in,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Auth helper ---

function getAnthropicAuth(): { token: string; type: 'api-key' | 'oauth' } {
  // 1. Check ANTHROPIC_API_KEY env var
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return { token: apiKey, type: 'api-key' };
  }

  // 2. Fall back to Claude Code OAuth credentials
  try {
    const credPath = join(homedir(), '.claude', '.credentials.json');
    const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
    const oauthToken = creds?.claudeAiOauth?.accessToken;
    if (oauthToken) {
      return { token: oauthToken, type: 'oauth' };
    }
  } catch {
    // Credentials file not found or invalid
  }

  throw new Error('No Anthropic API key found. Set ANTHROPIC_API_KEY or log in with Claude Code.');
}

export { app as prdRoutes };
