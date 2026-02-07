/**
 * Bot command handling tests
 * 
 * 测试飞书插件的斜杠命令处理逻辑
 */

import { describe, it, expect } from 'vitest';

// 模拟 finalizeInboundContext 的行为
function simulateFinalizeInboundContext(ctx: {
  Body: string;
  RawBody: string;
  CommandBody: string;
  BodyForCommands?: string;
}) {
  // 这是 Gateway 的 finalizeInboundContext 逻辑
  const normalized = { ...ctx };
  normalized.BodyForCommands = normalized.BodyForCommands ?? normalized.CommandBody ?? normalized.RawBody ?? normalized.Body;
  return normalized;
}

// 模拟 Gateway 的 stripStructuralPrefixes
function stripStructuralPrefixes(text: string): string {
  return text
    .replace(/\[[^\]]+\]\s*/g, "")  // 去掉 [xxx] 格式
    .replace(/^[ \t]*[A-Za-z0-9+()\-_. ]+:\s*/gm, "")  // 去掉 "speaker: " 前缀
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 模拟命令检测逻辑
function isSlashCommand(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('/');
}

// 模拟 Gateway 的命令匹配（使用 stripStructuralPrefixes 后的文本）
function matchCommand(bodyForCommands: string): string | null {
  // Gateway 会先用 stripStructuralPrefixes 处理
  const stripped = stripStructuralPrefixes(bodyForCommands);
  
  if (!stripped.startsWith('/')) return null;
  
  const commands = ['status', 'help', 'model', 'new', 'reset', 'stop', 'commands'];
  const match = stripped.match(/^\/(\w+)/);
  if (!match) return null;
  
  const cmd = match[1].toLowerCase();
  return commands.includes(cmd) ? cmd : null;
}

describe('飞书消息命令处理', () => {
  
  describe('stripStructuralPrefixes 测试', () => {
    it('【问题】中文 speaker: 前缀不会被去掉', () => {
      // 这是 Gateway 的 bug：正则只匹配英文字符
      // 中文用户名不会被去掉，导致命令无法识别
      expect(stripStructuralPrefixes('裴总: /status')).toBe('裴总: /status'); // 不会被处理！
    });
    
    it('英文 speaker: 前缀会被去掉', () => {
      expect(stripStructuralPrefixes('John: /status')).toBe('/status');
    });
    
    it('保留纯命令', () => {
      expect(stripStructuralPrefixes('/status')).toBe('/status');
    });
    
    it('去掉 [xxx] 格式', () => {
      expect(stripStructuralPrefixes('[Feishu 2026-02-06] /status')).toBe('/status');
    });
  });
  
  describe('飞书插件当前实现', () => {
    it('CommandBody 设置为原始内容，命令应该能被识别', () => {
      // 飞书插件的实现：
      // - Body: 包装后的内容 "裴总: /status"
      // - CommandBody: 原始内容 "/status"
      const userContent = '/status';
      const speaker = '裴总';
      const messageBody = `${speaker}: ${userContent}`;
      
      const ctx = simulateFinalizeInboundContext({
        Body: messageBody,           // "裴总: /status"
        RawBody: userContent,        // "/status"
        CommandBody: userContent,    // "/status" - 这是关键！
      });
      
      // BodyForCommands 应该从 CommandBody 取值
      console.log('BodyForCommands:', ctx.BodyForCommands);
      expect(ctx.BodyForCommands).toBe('/status');
      
      // 命令应该能被识别
      const cmd = matchCommand(ctx.BodyForCommands!);
      expect(cmd).toBe('status');
    });
  });
  
  describe('当前实现（有问题）', () => {
    it('用户发送 /status，Body 被包装后命令检测应该仍然有效', () => {
      // 模拟当前飞书插件的行为
      const userContent = '/status';
      const speaker = '裴总';
      
      // 当前实现：messageBody 被包装
      const messageBody = `${speaker}: ${userContent}`;
      
      // 当前实现：Body 用包装后的，CommandBody 用原始的
      const ctx = simulateFinalizeInboundContext({
        Body: messageBody,           // "裴总: /status"
        RawBody: userContent,        // "/status"
        CommandBody: userContent,    // "/status"
      });
      
      // Gateway 应该用 BodyForCommands 来检测命令
      console.log('BodyForCommands:', ctx.BodyForCommands);
      
      // 验证 BodyForCommands 是原始命令
      expect(ctx.BodyForCommands).toBe('/status');
      
      // 验证命令能被识别
      const cmd = matchCommand(ctx.BodyForCommands!);
      expect(cmd).toBe('status');
    });
    
    it('用户发送普通消息，不应该被识别为命令', () => {
      const userContent = '你好';
      const speaker = '裴总';
      const messageBody = `${speaker}: ${userContent}`;
      
      const ctx = simulateFinalizeInboundContext({
        Body: messageBody,
        RawBody: userContent,
        CommandBody: userContent,
      });
      
      expect(ctx.BodyForCommands).toBe('你好');
      expect(matchCommand(ctx.BodyForCommands!)).toBeNull();
    });
    
    it('用户发送带参数的命令 /model sonnet', () => {
      const userContent = '/model sonnet';
      const speaker = '裴总';
      const messageBody = `${speaker}: ${userContent}`;
      
      const ctx = simulateFinalizeInboundContext({
        Body: messageBody,
        RawBody: userContent,
        CommandBody: userContent,
      });
      
      expect(ctx.BodyForCommands).toBe('/model sonnet');
      expect(matchCommand(ctx.BodyForCommands!)).toBe('model');
    });
  });
  
  describe('边界情况', () => {
    it('空消息', () => {
      const ctx = simulateFinalizeInboundContext({
        Body: '',
        RawBody: '',
        CommandBody: '',
      });
      
      expect(matchCommand(ctx.BodyForCommands!)).toBeNull();
    });
    
    it('只有空格的消息', () => {
      const ctx = simulateFinalizeInboundContext({
        Body: '   ',
        RawBody: '   ',
        CommandBody: '   ',
      });
      
      expect(matchCommand(ctx.BodyForCommands!)).toBeNull();
    });
    
    it('斜杠后面没有命令名', () => {
      const ctx = simulateFinalizeInboundContext({
        Body: '/',
        RawBody: '/',
        CommandBody: '/',
      });
      
      expect(matchCommand(ctx.BodyForCommands!)).toBeNull();
    });
    
    it('未知命令', () => {
      const ctx = simulateFinalizeInboundContext({
        Body: '/unknown',
        RawBody: '/unknown',
        CommandBody: '/unknown',
      });
      
      expect(matchCommand(ctx.BodyForCommands!)).toBeNull();
    });
  });
});
