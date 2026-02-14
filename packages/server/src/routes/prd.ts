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

// --- Story Refinement ---

// Refine a story by generating clarifying questions and incorporating answers
app.post('/:prdId/stories/:storyId/refine', async (c) => {
  const db = getDb();
  const prdId = c.req.param('prdId');
  const storyId = c.req.param('storyId');
  const body = (await c.req.json()) as RefineStoryRequest;

  const prdRow = db.query('SELECT * FROM prds WHERE id = ?').get(prdId) as any;
  if (!prdRow) return c.json({ ok: false, error: 'PRD not found' }, 404);

  const storyRow = db.query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?').get(storyId, prdId) as any;
  if (!storyRow) return c.json({ ok: false, error: 'Story not found' }, 404);

  const story = storyFromRow(storyRow);

  // Build project memory context
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

    const result = await apiResponse.json() as any;
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

    const qualityScore = typeof parsed.qualityScore === 'number'
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
          ? parsed.updatedStory.acceptanceCriteria.filter((ac: any) => typeof ac === 'string' && ac.trim()).map((ac: string) => ac.trim())
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
      ).run(updated.title, updated.description, JSON.stringify(criteria), updated.priority, now, storyId);

      db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);
    }

    return c.json({ ok: true, data: response });
  } catch (err) {
    return c.json(
      { ok: false, error: `Story refinement failed: ${(err as Error).message}` },
      500,
    );
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
  const fromStory = db.query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?').get(fromStoryId, prdId) as any;
  const toStory = db.query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?').get(toStoryId, prdId) as any;
  if (!fromStory) return c.json({ ok: false, error: `Story ${fromStoryId} not found in this PRD` }, 404);
  if (!toStory) return c.json({ ok: false, error: `Story ${toStoryId} not found in this PRD` }, 404);

  // fromStoryId depends on toStoryId (toStoryId blocks fromStoryId)
  const dependsOn: string[] = JSON.parse(fromStory.depends_on || '[]');
  if (!dependsOn.includes(toStoryId)) {
    dependsOn.push(toStoryId);
    const now = Date.now();
    db.query('UPDATE prd_stories SET depends_on = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(dependsOn), now, fromStoryId);
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

  const fromStory = db.query('SELECT * FROM prd_stories WHERE id = ? AND prd_id = ?').get(fromStoryId, prdId) as any;
  if (!fromStory) return c.json({ ok: false, error: `Story ${fromStoryId} not found in this PRD` }, 404);

  const dependsOn: string[] = JSON.parse(fromStory.depends_on || '[]');
  const filtered = dependsOn.filter((id) => id !== toStoryId);

  if (filtered.length !== dependsOn.length) {
    const now = Date.now();
    db.query('UPDATE prd_stories SET depends_on = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(filtered), now, fromStoryId);
    db.query('UPDATE prds SET updated_at = ? WHERE id = ?').run(now, prdId);
  }

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
    const criteria = s.acceptanceCriteria
      .map((ac: any) => `  - ${ac.description}`)
      .join('\n');
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

    const result = await apiResponse.json() as any;
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
      (d) => d.fromStoryId && d.toStoryId && storyIds.has(d.fromStoryId) && storyIds.has(d.toStoryId) && d.fromStoryId !== d.toStoryId,
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

    // Persist to database
    const now = Date.now();
    for (const [storyId, deps] of newDepsMap) {
      const currentRow = db.query('SELECT depends_on FROM prd_stories WHERE id = ?').get(storyId) as any;
      const currentDeps = JSON.parse(currentRow?.depends_on || '[]');
      const newDeps = Array.from(deps);

      // Only update if changed
      if (JSON.stringify(currentDeps.sort()) !== JSON.stringify(newDeps.sort())) {
        db.query('UPDATE prd_stories SET depends_on = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(newDeps), now, storyId);
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
          reason: undefined, // reason not stored in depends_on array, only in AI analysis
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
      message: `Circular dependencies detected involving stories: ${Array.from(involvedIds).map((id) => storyMap.get(id)?.title || id).join(', ')}`,
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
      const unresolvedDeps = story.dependsOn
        .filter((depId) => storyMap.has(depId) && !completedIds.has(depId));
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
