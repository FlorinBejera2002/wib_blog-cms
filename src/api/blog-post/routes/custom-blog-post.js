'use strict';

/**
 * Custom routes for blog-post review workflow.
 *
 * These routes extend the default CRUD with editorial actions.
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/blog-posts/:id/submit-for-review',
      handler: 'blog-post.submitForReview',
      config: {
        policies: [],
        middlewares: [],
        description: 'Submit a blog post for editorial review',
      },
    },
    {
      method: 'POST',
      path: '/blog-posts/:id/approve',
      handler: 'blog-post.approve',
      config: {
        policies: [],
        middlewares: [],
        description: 'Approve a blog post (editor/admin only)',
      },
    },
    {
      method: 'POST',
      path: '/blog-posts/:id/reject',
      handler: 'blog-post.reject',
      config: {
        policies: [],
        middlewares: [],
        description: 'Reject a blog post (editor/admin only)',
      },
    },
    {
      method: 'GET',
      path: '/blog-posts/by-status/:status',
      handler: 'blog-post.findByStatus',
      config: {
        policies: [],
        middlewares: [],
        description: 'Get blog posts filtered by review status',
      },
    },
  ],
};
