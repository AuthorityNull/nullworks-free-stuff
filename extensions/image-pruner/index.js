/**
 * image-pruner plugin
 * Extracts base64 images to disk with context metadata.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRUNE_TOOLS = ['browser', 'image', 'nodes', 'canvas', 'screenshot'];
const BASE64_IMAGE_REGEX = /data:image\/([^;]+);base64,([A-Za-z0-9+\/=]{100,})/g;

let pluginApi = null;
let config = null;
let imageDir = null;

function ensureImageDir() {
  if (!imageDir) {
    imageDir = process.env.IMAGE_PRUNER_DIR || '/tmp/pruned-images';
  }
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }
  return imageDir;
}

function saveImageWithContext(mimeType, base64Data, context) {
  try {
    const dir = ensureImageDir();
    const ext = mimeType === 'jpeg' ? 'jpg' : mimeType;
    const hash = crypto.createHash('md5').update(base64Data.slice(0, 1000)).digest('hex').slice(0, 8);
    const timestamp = Date.now();
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    
    // Create descriptive filename
    const toolName = context.toolName || 'unknown';
    const filename = `${dateStr}_${toolName}_${hash}.${ext}`;
    const filepath = path.join(dir, filename);
    const metapath = filepath + '.meta.json';
    
    // Save image
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filepath, buffer);
    
    // Save metadata
    const metadata = {
      savedAt: new Date().toISOString(),
      tool: context.toolName,
      toolInput: context.toolInput || null,
      session: context.sessionKey || null,
      channel: context.channel || null,
      sizeBytes: buffer.length,
      mimeType: `image/${mimeType}`,
      description: context.description || null
    };
    fs.writeFileSync(metapath, JSON.stringify(metadata, null, 2));
    
    const sizeKB = Math.round(buffer.length / 1024);
    return { filepath, metapath, sizeKB, metadata };
  } catch (err) {
    pluginApi?.logger?.warn?.(`image-pruner: Failed to save image: ${err.message}`);
    return null;
  }
}

function extractContextFromMessage(message, ctx) {
  const context = {
    toolName: message?.toolName || ctx?.toolName || 'unknown',
    sessionKey: ctx?.sessionKey || null,
    channel: ctx?.channel || null,
    toolInput: null,
    description: null
  };
  
  // Try to extract useful context from tool input stored in message
  const input = message?.input || message?.toolInput || ctx?.input;
  if (input) {
    if (typeof input === 'object') {
      // Browser: capture URL
      if (input.url || input.targetUrl) {
        context.description = `Browser: ${input.url || input.targetUrl}`;
        context.toolInput = { url: input.url || input.targetUrl, action: input.action };
      }
      // Nodes: capture command
      else if (input.command) {
        const cmd = Array.isArray(input.command) ? input.command.join(' ') : input.command;
        context.description = `Node command: ${cmd.slice(0, 100)}`;
        context.toolInput = { command: cmd, node: input.node };
      }
      // Canvas: capture action
      else if (input.action) {
        context.description = `Canvas: ${input.action}`;
        context.toolInput = { action: input.action };
      }
      // Image tool
      else if (input.prompt) {
        context.description = `Image analysis: ${input.prompt.slice(0, 100)}`;
        context.toolInput = { prompt: input.prompt };
      }
    }
  }
  
  return context;
}

function pruneImagesWithContext(text, context) {
  if (typeof text !== 'string') return text;
  
  return text.replace(BASE64_IMAGE_REGEX, (match, mimeType, base64Data) => {
    const saved = saveImageWithContext(mimeType, base64Data, context);
    if (saved) {
      const desc = context.description ? ` | ${context.description}` : '';
      return `[IMAGE SAVED: ${saved.filepath} (${saved.sizeKB}KB)${desc}]`;
    }
    return `[IMAGE PRUNED: save failed]`;
  });
}

function pruneObjectImagesWithContext(obj, context) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      const pruned = pruneImagesWithContext(val, context);
      if (pruned !== val) {
        obj[key] = pruned;
      }
    } else if (val && typeof val === 'object') {
      pruneObjectImagesWithContext(val, context);
    }
  }
}

/**
 * Handle tool_result_persist hook
 * This is SYNCHRONOUS - do not return a Promise
 * @param {Object} event - contains event.message (the full tool result message)
 * @param {Object} ctx - context with sessionKey, channel, etc.
 * @returns {Object|undefined} - { message: modifiedMessage } to replace, or undefined to leave unchanged
 */
function handleToolResult(event, ctx) {
  if (!config?.enabled) return;
  
  // event.message is the full tool result message object
  const message = event.message;
  if (!message) return;
  
  // Get tool name from message metadata or context
  const toolName = message.toolName || ctx?.toolName;
  if (!toolName || !config.pruneTools.includes(toolName)) return;
  
  const context = extractContextFromMessage(message, ctx);
  let modified = false;
  
  // Handle content - could be string or array of content blocks
  const content = message.content;
  
  if (typeof content === 'string') {
    // Simple string content - search for base64 data URIs
    const pruned = pruneImagesWithContext(content, context);
    if (pruned !== content) {
      message.content = pruned;
      modified = true;
      pluginApi?.logger?.debug?.(`image-pruner: Saved image from ${toolName} (string content)`);
    }
  } else if (Array.isArray(content)) {
    // Array of content blocks - handle each type
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      
      // Handle structured image blocks: { type: "image", source: { type: "base64", data: "..." } }
      if (block.type === 'image' && block.source?.type === 'base64') {
        const base64Data = block.source.data;
        const mimeType = block.source.mimeType?.replace('image/', '') || 'png';
        
        const saved = saveImageWithContext(mimeType, base64Data, context);
        if (saved) {
          // Replace image block with text placeholder
          block.type = 'text';
          block.text = `[IMAGE SAVED: ${saved.filepath} (${saved.sizeKB}KB)]`;
          delete block.source;
          modified = true;
          pluginApi?.logger?.debug?.(`image-pruner: Saved structured image from ${toolName}`);
        }
      }
      // Handle text blocks that may contain base64 data URIs
      else if (block.type === 'text' && typeof block.text === 'string') {
        const pruned = pruneImagesWithContext(block.text, context);
        if (pruned !== block.text) {
          block.text = pruned;
          modified = true;
          pluginApi?.logger?.debug?.(`image-pruner: Saved image from text block in ${toolName}`);
        }
      }
    }
  } else if (content && typeof content === 'object') {
    // Object content - recursively prune
    pruneObjectImagesWithContext(content, context);
    modified = true;
  }
  
  if (modified) {
    pluginApi?.logger?.info?.(`image-pruner: Pruned images from ${toolName} tool result`);
    // Return modified message to persist the changes
    return { message };
  }
  
  return undefined;
}

/**
 * Cleanup old images based on TTL
 */
function cleanupOldImages() {
  try {
    const dir = ensureImageDir();
    const files = fs.readdirSync(dir);
    const now = Date.now();
    const TTL = 30 * 60 * 1000; // 30 minutes
    let cleaned = 0;
    
    for (const file of files) {
      // Skip metadata files
      if (file.endsWith('.meta.json')) continue;
      
      const filepath = path.join(dir, file);
      try {
        const stat = fs.statSync(filepath);
        if (now - stat.mtimeMs > TTL) {
          fs.unlinkSync(filepath);
          // Also remove metadata if exists
          const metapath = filepath + '.meta.json';
          if (fs.existsSync(metapath)) {
            fs.unlinkSync(metapath);
          }
          cleaned++;
        }
      } catch (e) {
        // File may have been deleted already, ignore
      }
    }
    
    if (cleaned > 0) {
      pluginApi?.logger?.info?.(`image-pruner: Cleaned up ${cleaned} old image(s)`);
    }
  } catch (err) {
    pluginApi?.logger?.warn?.(`image-pruner: Cleanup failed: ${err.message}`);
  }
}

const plugin = {
  id: 'image-pruner',
  name: 'Image Pruner',
  description: 'Saves base64 images to disk with context metadata',
  
  register(api) {
    pluginApi = api;

    config = {
      enabled: true,
      pruneTools: PRUNE_TOOLS,
      imageDir: '/tmp/pruned-images',
      ...api.pluginConfig
    };

    if (config.imageDir) {
      imageDir = config.imageDir;
    }

    api.logger.info(`image-pruner: register() enabled=${config.enabled}`);

    if (!config.enabled) return;

    // FIXED: Use registerHook (not api.on) for hook system
    api.registerHook('tool_result_persist', handleToolResult, {
      name: 'image-pruner.tool_result_persist',
      description: 'Prune base64 images from persisted tool results and save them to disk.'
    });
    api.logger.info(`image-pruner: Active - images saved to ${imageDir} with metadata`);

    api.registerService({
      id: 'image-pruner',
      start: () => {
        ensureImageDir();
        
        // Start periodic cleanup of old images
        setInterval(() => {
          cleanupOldImages();
        }, 5 * 60 * 1000); // Every 5 minutes
        
        api.logger.info('image-pruner: Service started with TTL cleanup');
      },
      stop: () => api.logger.info('image-pruner: Stopped')
    });
  }
};

module.exports = plugin;
