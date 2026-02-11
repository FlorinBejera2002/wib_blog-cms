'use strict';

/**
 * blog-post controller
 *
 * Extended with custom actions for the review workflow:
 * - submitForReview: AUTHOR submits a draft for editor review
 * - approve: EDITOR/ADMIN approves a post
 * - reject: EDITOR/ADMIN rejects a post
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::blog-post.blog-post', ({ strapi }) => ({

  /**
   * Submit a blog post for review.
   * Changes reviewStatus from 'draft' to 'pending_review'.
   *
   * POST /api/blog-posts/:id/submit-for-review
   */
  async submitForReview(ctx) {
    const { id } = ctx.params;

    const entity = await strapi.entityService.findOne('api::blog-post.blog-post', id);

    if (!entity) {
      return ctx.notFound('Blog post not found');
    }

    if (entity.reviewStatus !== 'draft' && entity.reviewStatus !== 'rejected') {
      return ctx.badRequest('Only draft or rejected posts can be submitted for review');
    }

    const updated = await strapi.entityService.update('api::blog-post.blog-post', id, {
      data: {
        reviewStatus: 'pending_review',
      },
    });

    const sanitized = await this.sanitizeOutput(updated, ctx);
    return this.transformResponse(sanitized);
  },

  /**
   * Approve a blog post.
   * Changes reviewStatus from 'pending_review' to 'approved'.
   *
   * POST /api/blog-posts/:id/approve
   */
  async approve(ctx) {
    const { id } = ctx.params;

    const entity = await strapi.entityService.findOne('api::blog-post.blog-post', id);

    if (!entity) {
      return ctx.notFound('Blog post not found');
    }

    if (entity.reviewStatus !== 'pending_review') {
      return ctx.badRequest('Only posts with pending_review status can be approved');
    }

    const updated = await strapi.entityService.update('api::blog-post.blog-post', id, {
      data: {
        reviewStatus: 'approved',
      },
    });

    const sanitized = await this.sanitizeOutput(updated, ctx);
    return this.transformResponse(sanitized);
  },

  /**
   * Reject a blog post.
   * Changes reviewStatus from 'pending_review' to 'rejected'.
   *
   * POST /api/blog-posts/:id/reject
   */
  async reject(ctx) {
    const { id } = ctx.params;

    const entity = await strapi.entityService.findOne('api::blog-post.blog-post', id);

    if (!entity) {
      return ctx.notFound('Blog post not found');
    }

    if (entity.reviewStatus !== 'pending_review') {
      return ctx.badRequest('Only posts with pending_review status can be rejected');
    }

    const updated = await strapi.entityService.update('api::blog-post.blog-post', id, {
      data: {
        reviewStatus: 'rejected',
      },
    });

    const sanitized = await this.sanitizeOutput(updated, ctx);
    return this.transformResponse(sanitized);
  },

  /**
   * Get posts by review status (for editorial dashboard).
   *
   * GET /api/blog-posts/by-status/:status
   */
  async findByStatus(ctx) {
    const { status } = ctx.params;
    const validStatuses = ['draft', 'pending_review', 'approved', 'rejected'];

    if (!validStatuses.includes(status)) {
      return ctx.badRequest(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const entities = await strapi.entityService.findMany('api::blog-post.blog-post', {
      filters: { reviewStatus: status },
      sort: { updatedAt: 'desc' },
      populate: ['featuredImage', 'category', 'tags'],
      publicationState: 'preview', // Include drafts
    });

    const sanitized = await this.sanitizeOutput(entities, ctx);
    return this.transformResponse(sanitized);
  },
}));
