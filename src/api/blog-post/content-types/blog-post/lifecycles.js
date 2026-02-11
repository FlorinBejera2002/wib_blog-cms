'use strict';

/**
 * Blog post lifecycle hooks.
 *
 * - Auto-calculate reading time before create/update
 * - Auto-set authorName from the admin user who created the post
 * - Trigger Symfony cache invalidation webhook on publish/unpublish/update
 */

const WORDS_PER_MINUTE = 200;

/**
 * Estimate reading time from blocks content.
 * Strapi v5 blocks are JSON arrays of typed nodes.
 */
function estimateReadingTime(blocks) {
  if (!blocks || !Array.isArray(blocks)) return 1;

  let wordCount = 0;

  function extractText(node) {
    if (!node) return;
    if (typeof node === 'string') {
      wordCount += node.split(/\s+/).filter(Boolean).length;
      return;
    }
    if (node.text) {
      wordCount += node.text.split(/\s+/).filter(Boolean).length;
    }
    if (node.children && Array.isArray(node.children)) {
      node.children.forEach(extractText);
    }
  }

  blocks.forEach(extractText);

  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

/**
 * Send cache invalidation webhook to Symfony.
 */
async function invalidateSymfonyCache(slug) {
  const webhookUrl = process.env.SYMFONY_BASE_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!webhookUrl || !webhookSecret) return;

  try {
    const url = `${webhookUrl}/cms-webhook/invalidate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Strapi-Webhook-Secret': webhookSecret,
      },
      body: JSON.stringify({
        event: 'entry.update',
        model: 'blog-post',
        entry: { slug },
      }),
    });

    if (!response.ok) {
      strapi.log.warn(`Symfony cache invalidation failed: ${response.status}`);
    } else {
      strapi.log.info(`Symfony cache invalidated for slug: ${slug}`);
    }
  } catch (error) {
    strapi.log.warn(`Symfony cache invalidation error: ${error.message}`);
  }
}

module.exports = {
  beforeCreate(event) {
    const { data } = event.params;

    // Auto-calculate reading time from content blocks
    if (data.content) {
      data.readingTime = estimateReadingTime(data.content);
    }

    // Default reviewStatus to 'draft' if not set
    if (!data.reviewStatus) {
      data.reviewStatus = 'draft';
    }
  },

  beforeUpdate(event) {
    const { data } = event.params;

    // Recalculate reading time if content changed
    if (data.content) {
      data.readingTime = estimateReadingTime(data.content);
    }
  },

  async afterCreate(event) {
    const { result } = event;
    strapi.log.info(`Blog post created: "${result.title}" (ID: ${result.id})`);
  },

  async afterUpdate(event) {
    const { result } = event;

    // Invalidate Symfony cache when a post is updated
    if (result.slug) {
      await invalidateSymfonyCache(result.slug);
    }

    strapi.log.info(`Blog post updated: "${result.title}" (ID: ${result.id}, status: ${result.reviewStatus})`);
  },

  async afterDelete(event) {
    const { result } = event;

    // Invalidate all Symfony cache on delete
    if (result.slug) {
      await invalidateSymfonyCache(result.slug);
    }

    strapi.log.info(`Blog post deleted: ID ${result.id}`);
  },
};
