/**
 * Multi-channel notification routing service.
 *
 * Sends notifications through Slack, Discord, Telegram, and Email channels.
 * Integrates with event-bridge to automatically send notifications for key events.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../db/database';
import type {
  NotificationChannel,
  NotificationChannelType,
  NotificationEventType,
  WorkspaceNotificationPreferences,
  SendNotificationRequest,
  NotificationAction,
  SlackConfig,
  DiscordConfig,
  TelegramConfig,
  EmailConfig,
} from '@e/shared';
import nodemailer from 'nodemailer';

interface NotificationPayload {
  title: string;
  message: string;
  actions?: NotificationAction[];
  workspaceId?: string;
  conversationId?: string;
  storyId?: string;
}

class NotificationService {
  // --- Channel CRUD ---

  listChannels(): NotificationChannel[] {
    const db = getDb();
    const rows = db
      .query('SELECT * FROM notification_channels ORDER BY created_at DESC')
      .all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as NotificationChannelType,
      config: JSON.parse(row.config),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getChannel(id: string): NotificationChannel | null {
    const db = getDb();
    const row = db.query('SELECT * FROM notification_channels WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      type: row.type as NotificationChannelType,
      config: JSON.parse(row.config),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createChannel(name: string, type: NotificationChannelType, config: any): NotificationChannel {
    const db = getDb();
    const id = nanoid();
    const now = Date.now();

    db.query(
      `INSERT INTO notification_channels (id, name, type, config, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).run(id, name, type, JSON.stringify(config), now, now);

    return {
      id,
      name,
      type,
      config,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateChannel(
    id: string,
    updates: Partial<Pick<NotificationChannel, 'name' | 'config' | 'enabled'>>,
  ): void {
    const db = getDb();
    const now = Date.now();
    const sets: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      values.push(updates.name);
    }
    if (updates.config !== undefined) {
      sets.push('config = ?');
      values.push(JSON.stringify(updates.config));
    }
    if (updates.enabled !== undefined) {
      sets.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    values.push(now);
    values.push(id);

    db.query(`UPDATE notification_channels SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteChannel(id: string): void {
    const db = getDb();
    db.query('DELETE FROM notification_channels WHERE id = ?').run(id);
  }

  // --- Workspace Preferences ---

  getWorkspacePreferences(workspaceId: string): WorkspaceNotificationPreferences | null {
    const db = getDb();
    const row = db
      .query('SELECT * FROM workspace_notification_preferences WHERE workspace_id = ?')
      .get(workspaceId) as any;
    if (!row) return null;
    return {
      workspaceId: row.workspace_id,
      enabledEvents: JSON.parse(row.enabled_events),
      enabledChannels: JSON.parse(row.enabled_channels),
      updatedAt: row.updated_at,
    };
  }

  setWorkspacePreferences(
    workspaceId: string,
    enabledEvents: NotificationEventType[],
    enabledChannels: string[],
  ): void {
    const db = getDb();
    const now = Date.now();

    db.query(
      `INSERT INTO workspace_notification_preferences (workspace_id, enabled_events, enabled_channels, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         enabled_events = excluded.enabled_events,
         enabled_channels = excluded.enabled_channels,
         updated_at = excluded.updated_at`,
    ).run(workspaceId, JSON.stringify(enabledEvents), JSON.stringify(enabledChannels), now);
  }

  // --- Send Notifications ---

  /**
   * Send a notification through configured channels.
   * If workspaceId is provided, respects workspace preferences.
   * If channelIds are provided, uses only those channels.
   */
  async send(request: SendNotificationRequest): Promise<void> {
    const db = getDb();

    // Determine which channels to use
    let targetChannelIds: string[];
    if (request.channelIds) {
      // Explicit channel list provided
      targetChannelIds = request.channelIds;
    } else if (request.workspaceId) {
      // Use workspace preferences
      const prefs = this.getWorkspacePreferences(request.workspaceId);
      if (!prefs || !prefs.enabledEvents.includes(request.event)) {
        // Workspace doesn't want notifications for this event
        return;
      }
      targetChannelIds = prefs.enabledChannels;
    } else {
      // No workspace or channels specified — send to all enabled channels
      const allChannels = this.listChannels();
      targetChannelIds = allChannels.filter((c) => c.enabled).map((c) => c.id);
    }

    if (targetChannelIds.length === 0) return;

    // Send to each channel in parallel
    const promises = targetChannelIds.map((channelId) =>
      this.sendToChannel(
        channelId,
        {
          title: request.title,
          message: request.message,
          actions: request.actions,
          workspaceId: request.workspaceId,
          conversationId: request.conversationId,
          storyId: request.storyId,
        },
        request.event,
      ),
    );

    await Promise.allSettled(promises);
  }

  private async sendToChannel(
    channelId: string,
    payload: NotificationPayload,
    event: NotificationEventType,
  ): Promise<void> {
    const channel = this.getChannel(channelId);
    if (!channel || !channel.enabled) return;

    const db = getDb();
    const logId = nanoid();
    const now = Date.now();

    try {
      switch (channel.type) {
        case 'slack':
          await this.sendToSlack(channel.config as SlackConfig, payload);
          break;
        case 'discord':
          await this.sendToDiscord(channel.config as DiscordConfig, payload);
          break;
        case 'telegram':
          await this.sendToTelegram(channel.config as TelegramConfig, payload);
          break;
        case 'email':
          await this.sendToEmail(channel.config as EmailConfig, payload);
          break;
      }

      // Log success
      db.query(
        `INSERT INTO notification_logs (id, channel_id, event, title, message, success, sent_at, workspace_id, conversation_id, story_id)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      ).run(
        logId,
        channelId,
        event,
        payload.title,
        payload.message,
        now,
        payload.workspaceId || null,
        payload.conversationId || null,
        payload.storyId || null,
      );
    } catch (error) {
      // Log failure
      const errorMessage = error instanceof Error ? error.message : String(error);
      db.query(
        `INSERT INTO notification_logs (id, channel_id, event, title, message, success, error_message, sent_at, workspace_id, conversation_id, story_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      ).run(
        logId,
        channelId,
        event,
        payload.title,
        payload.message,
        errorMessage,
        now,
        payload.workspaceId || null,
        payload.conversationId || null,
        payload.storyId || null,
      );
      console.error(
        `[notifications] Failed to send to ${channel.type} channel ${channelId}:`,
        error,
      );
    }
  }

  private async sendToSlack(config: SlackConfig, payload: NotificationPayload): Promise<void> {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: payload.title,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: payload.message,
        },
      },
    ];

    // Add action buttons if provided
    if (payload.actions && payload.actions.length > 0) {
      blocks.push({
        type: 'actions',
        elements: payload.actions.map((action) => ({
          type: 'button',
          text: {
            type: 'plain_text',
            text: action.label,
          },
          url: action.url,
          action_id: action.id,
          style:
            action.style === 'danger'
              ? 'danger'
              : action.style === 'primary'
                ? 'primary'
                : undefined,
        })),
      } as any);
    }

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook returned ${response.status}: ${await response.text()}`);
    }
  }

  private async sendToDiscord(config: DiscordConfig, payload: NotificationPayload): Promise<void> {
    const embed = {
      title: payload.title,
      description: payload.message,
      color: 0x5865f2, // Discord blurple
      timestamp: new Date().toISOString(),
    };

    const body: any = {
      embeds: [embed],
    };

    // Add action buttons if provided (Discord components)
    if (payload.actions && payload.actions.length > 0) {
      body.components = [
        {
          type: 1, // Action row
          components: payload.actions.slice(0, 5).map((action) => ({
            type: 2, // Button
            label: action.label,
            style: action.style === 'danger' ? 4 : action.style === 'primary' ? 1 : 2,
            url: action.url,
          })),
        },
      ];
    }

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Discord webhook returned ${response.status}: ${await response.text()}`);
    }
  }

  private async sendToTelegram(
    config: TelegramConfig,
    payload: NotificationPayload,
  ): Promise<void> {
    const text = `*${payload.title}*\n\n${payload.message}`;

    const body: any = {
      chat_id: config.chatId,
      text,
      parse_mode: 'Markdown',
    };

    // Add inline keyboard for action buttons
    if (payload.actions && payload.actions.length > 0) {
      body.reply_markup = {
        inline_keyboard: [
          payload.actions.map((action) => ({
            text: action.label,
            url: action.url,
          })),
        ],
      };
    }

    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Telegram API returned ${response.status}: ${await response.text()}`);
    }
  }

  private async sendToEmail(config: EmailConfig, payload: NotificationPayload): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPassword,
      },
    });

    let html = `
      <h2>${payload.title}</h2>
      <p>${payload.message.replace(/\n/g, '<br>')}</p>
    `;

    // Add action buttons as links
    if (payload.actions && payload.actions.length > 0) {
      html += '<div style="margin-top: 20px;">';
      for (const action of payload.actions) {
        const color =
          action.style === 'danger'
            ? '#dc3545'
            : action.style === 'primary'
              ? '#007bff'
              : '#6c757d';
        html += `<a href="${action.url}" style="display: inline-block; margin-right: 10px; padding: 10px 20px; background-color: ${color}; color: white; text-decoration: none; border-radius: 4px;">${action.label}</a>`;
      }
      html += '</div>';
    }

    await transporter.sendMail({
      from: config.fromEmail,
      to: config.toEmail,
      subject: payload.title,
      html,
    });
  }

  // --- Test Send ---

  async testChannel(channelId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.sendToChannel(
        channelId,
        {
          title: 'E Notification Test',
          message:
            'This is a test notification from E. If you can see this, your channel is configured correctly!',
        },
        'agent_note_created', // Just use any event type for logging
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // --- Notification Logs ---

  getLogs(workspaceId?: string, limit = 50): any[] {
    const db = getDb();
    let query = 'SELECT * FROM notification_logs';
    const params: any[] = [];

    if (workspaceId) {
      query += ' WHERE workspace_id = ?';
      params.push(workspaceId);
    }

    query += ' ORDER BY sent_at DESC LIMIT ?';
    params.push(limit);

    return db.query(query).all(...params) as any[];
  }
}

export const notificationService = new NotificationService();
