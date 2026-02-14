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
} from '@maude/shared';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const app = new Hono();

// List PRDs (optionally filtered by projectPath)
app.get('/', (c) => {
  const db = getDb();
  const projectPath = c.req.query('projectPath');

  let rows: any[];
  if (projectPath) {
    rows = db
      .query('SELECT * FROM prds WHERE project_path = ? ORDER BY updated_at DESC')
      .all(projectPath);
  } else {
    rows = db.query('SELECT * FROM prds ORDER BY updated_at DESC').all();
  }

  return c.json({
    ok: true,
    data: rows.map(prdFromRow),
  });
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
    `INSERT INTO prds (id, project_path, name, description, branch_name, quality_checks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    prdId,
    body.projectPath,
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
  // Append a single learning without replacing
  if (body.addLearning) {
    const current = JSON.parse(existing.learnings || '[]');
    current.push(body.addLearning);
    updates.push('learnings = ?');
    values.push(JSON.stringify(current));
  }

  if (updates.length === 0) return c.json({ ok: false, error: 'No fields to update' }, 400);

  updates.push('updated_at = ?');
  values.push(Date.now());
  values.push(storyId);

  db.query(`UPDATE prd_stories SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Touch PRD updated_at
  const prdId = c.req.param('prdId');
  db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(Date.now(), prdId);

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
  const { projectPath, prdJson } = body;

  if (!projectPath || !prdJson) {
    return c.json({ ok: false, error: 'projectPath and prdJson required' }, 400);
  }

  // Parse Ralph format:
  // { project, branchName, description, userStories: [{ id, title, description, acceptanceCriteria, priority, passes }] }
  const ralph = typeof prdJson === 'string' ? JSON.parse(prdJson) : prdJson;

  const db = getDb();
  const prdId = nanoid(12);
  const now = Date.now();

  db.query(
    `INSERT INTO prds (id, project_path, name, description, branch_name, quality_checks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`,
  ).run(prdId, projectPath, ralph.project || 'Imported PRD', ralph.description || '', ralph.branchName || null, now, now);

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
      priority = rs.priority <= 1 ? 'critical' : rs.priority === 2 ? 'high' : rs.priority === 3 ? 'medium' : 'low';
    } else if (typeof rs.priority === 'string') {
      priority = rs.priority as StoryPriority;
    }

    const status = rs.passes === true ? 'completed' : 'pending';

    storyInsert.run(storyId, prdId, rs.title, rs.description || '', JSON.stringify(criteria), priority, status, i, now, now);
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
    return c.json({ ok: false, error: 'No description provided. Supply a description in the request or set one on the PRD.' }, 400);
  }

  // Build project memory context for better scoping
  let memoryContext = '';
  try {
    const memRows = db
      .query(
        `SELECT * FROM project_memories WHERE project_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 30`,
      )
      .all(prdRow.project_path) as any[];
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
  } catch { /* no project memory */ }

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

    const result = await apiResponse.json() as any;
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
      return c.json(
        { ok: false, error: 'Failed to parse AI response as JSON. Try again.' },
        502,
      );
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
          ? s.acceptanceCriteria.filter((ac: any) => typeof ac === 'string' && ac.trim()).map((ac: string) => ac.trim())
          : [],
        priority: validPriorities.includes(s.priority) ? s.priority : 'medium',
      }));

    // Ensure each story has at least 3 acceptance criteria
    for (const story of validatedStories) {
      while (story.acceptanceCriteria.length < 3) {
        story.acceptanceCriteria.push(`[Needs acceptance criterion ${story.acceptanceCriteria.length + 1}]`);
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
    return c.json(
      { ok: false, error: `Story generation failed: ${(err as Error).message}` },
      500,
    );
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
        `SELECT * FROM project_memories WHERE project_path = ? AND confidence >= 0.3 ORDER BY category, times_seen DESC LIMIT 50`,
      )
      .all(prdRow.project_path) as any[];
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
  } catch { /* no project memory */ }

  // Build stories context
  let storiesContext = '';
  if (stories.length > 0) {
    storiesContext = `\n\n## Current Stories (${stories.length})\n`;
    for (const s of stories) {
      const mapped = storyFromRow(s);
      const criteria = mapped.acceptanceCriteria.map((ac: any) => `  - ${ac.description}`).join('\n');
      storiesContext += `\n### ${mapped.title} [${mapped.status}] (${mapped.priority}) {id: ${mapped.id}}\n`;
      if (mapped.description) storiesContext += `${mapped.description}\n`;
      if (criteria) storiesContext += `Acceptance Criteria:\n${criteria}\n`;
    }
  } else {
    storiesContext = '\n\n## Current Stories\nNo stories yet — this PRD needs stories to be planned.\n';
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
    `INSERT INTO conversations (id, title, model, system_prompt, project_path, plan_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(conversationId, `[Plan] ${prdRow.name}`, model, systemPrompt, prdRow.project_path, now, now);

  const response: PlanSprintResponse = {
    conversationId,
    prdId,
    mode: body.mode,
    editMode,
  };

  return c.json({ ok: true, data: response }, 201);
});

// --- Row mappers ---

function prdFromRow(row: any) {
  return {
    id: row.id,
    projectPath: row.project_path,
    name: row.name,
    description: row.description,
    branchName: row.branch_name,
    qualityChecks: JSON.parse(row.quality_checks || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storyFromRow(row: any) {
  return {
    id: row.id,
    prdId: row.prd_id,
    title: row.title,
    description: row.description,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria || '[]'),
    priority: row.priority,
    dependsOn: JSON.parse(row.depends_on || '[]'),
    status: row.status,
    taskId: row.task_id,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    commitSha: row.commit_sha,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    learnings: JSON.parse(row.learnings || '[]'),
    sortOrder: row.sort_order,
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

  throw new Error(
    'No Anthropic API key found. Set ANTHROPIC_API_KEY or log in with Claude Code.',
  );
}

export { app as prdRoutes };
