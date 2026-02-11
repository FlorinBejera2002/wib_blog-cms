'use strict';

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    // Seed default categories on first run
    await seedCategories(strapi);

    // Set public API permissions on first run
    await setPublicPermissions(strapi);

    strapi.log.info('WIB CMS bootstrap complete');
  },
};

/**
 * Seed the default insurance categories if they don't exist yet.
 */
async function seedCategories(strapi) {
  const categories = [
    { name: 'RCA', slug: 'rca', icon: 'fas fa-car', description: 'Asigurare de raspundere civila auto obligatorie' },
    { name: 'CASCO', slug: 'casco', icon: 'fas fa-shield-alt', description: 'Asigurare auto complexa impotriva daunelor' },
    { name: 'Calatorie', slug: 'travel', icon: 'fas fa-plane', description: 'Asigurari de calatorie in strainatate' },
    { name: 'Locuinta', slug: 'home', icon: 'fas fa-home', description: 'Asigurari pentru locuinte si proprietati' },
    { name: 'Viata', slug: 'life', icon: 'fas fa-heart', description: 'Asigurari de viata si protectie financiara' },
    { name: 'Sanatate', slug: 'health', icon: 'fas fa-heartbeat', description: 'Asigurari de sanatate private' },
    { name: 'Malpraxis', slug: 'malpraxis', icon: 'fas fa-user-md', description: 'Asigurari de malpraxis medical' },
    { name: 'CMR', slug: 'cmr', icon: 'fas fa-truck', description: 'Asigurari pentru transporturi rutiere internationale' },
    { name: 'Asistenta rutiera', slug: 'breakdown', icon: 'fas fa-wrench', description: 'Asigurari de asistenta rutiera si tractari' },
    { name: 'Accidente', slug: 'accidents', icon: 'fas fa-car-crash', description: 'Asigurari de accidente personale' },
    { name: 'General', slug: 'common', icon: 'fas fa-newspaper', description: 'Articole generale despre asigurari' },
  ];

  const existingCount = await strapi.entityService.count('api::category.category');

  if (existingCount > 0) {
    strapi.log.info(`Categories already seeded (${existingCount} found), skipping`);
    return;
  }

  strapi.log.info('Seeding default categories...');

  for (const cat of categories) {
    try {
      await strapi.entityService.create('api::category.category', {
        data: cat,
      });
      strapi.log.info(`  Created category: ${cat.name}`);
    } catch (error) {
      strapi.log.warn(`  Failed to create category "${cat.name}": ${error.message}`);
    }
  }

  strapi.log.info('Category seeding complete');
}

/**
 * Set public (unauthenticated) API permissions for read-only access.
 * This allows the Symfony frontend to read blog posts without authentication
 * when using API tokens.
 */
async function setPublicPermissions(strapi) {
  // Find the public role
  const publicRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (!publicRole) {
    strapi.log.warn('Public role not found, skipping permission setup');
    return;
  }

  // Define which actions should be publicly accessible
  const publicActions = {
    'api::blog-post.blog-post': ['find', 'findOne'],
    'api::category.category': ['find', 'findOne'],
    'api::tag.tag': ['find', 'findOne'],
  };

  for (const [controller, actions] of Object.entries(publicActions)) {
    for (const action of actions) {
      // Check if permission already exists
      const existingPermission = await strapi
        .query('plugin::users-permissions.permission')
        .findOne({
          where: {
            role: publicRole.id,
            action: `${controller}.${action}`,
          },
        });

      if (!existingPermission) {
        try {
          await strapi.query('plugin::users-permissions.permission').create({
            data: {
              role: publicRole.id,
              action: `${controller}.${action}`,
            },
          });
          strapi.log.info(`  Granted public permission: ${controller}.${action}`);
        } catch (error) {
          // Permission might already exist in a different format
          strapi.log.debug(`  Permission setup note for ${controller}.${action}: ${error.message}`);
        }
      }
    }
  }
}
